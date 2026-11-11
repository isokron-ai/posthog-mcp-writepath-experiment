#!/bin/bash
# Verify the two RFC 3161 timestamp tokens of the r3 freeze against the sha256 of the original (unpublished) manifest.
# usage: ./verify.sh [CA bundle]      default CA bundle: /etc/ssl/cert.pem, else /etc/ssl/certs/ca-certificates.crt
# Needs OpenSSL 3 or later. For each token it checks, at the time the token was issued:
#   1. the token's CMS signature and certificate chain up to a root in the CA bundle, for the time-stamping purpose;
#   2. that the hash inside the token (the message imprint) is the manifest's sha256 in MANIFEST.json.sha256;
#   3. OpenSSL's own `openssl ts -verify`. It passed for both tokens with macOS's /etc/ssl/cert.pem and OpenSSL 4.1. With
#      a CA bundle that builds Sectigo's chain through a different root, OpenSSL can reject the Sectigo token at its
#      ESS signing-certificate check although steps 1 and 2 pass; for Sectigo, steps 1 and 2 are then the check.
set -euo pipefail
cd "$(dirname "$0")"
CA="${1:-}"
[ -n "$CA" ] || for c in /etc/ssl/cert.pem /etc/ssl/certs/ca-certificates.crt; do [ -r "$c" ] && { CA="$c"; break; }; done
[ -r "$CA" ] || { echo "no CA bundle found; pass one as the first argument" >&2; exit 2; }
HASH="$(cut -d' ' -f1 MANIFEST.json.sha256)"
AT=1794351189   # 2026-11-10T22:53:09Z, the time in both tokens
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
fail=0
for t in sectigo digicert; do
  tsr="manifest.$t.tsr"
  echo "== $t: $(openssl ts -reply -in "$tsr" -text 2>/dev/null | grep -E '^Time stamp:' || true)"
  openssl ts -reply -in "$tsr" -token_out -out "$TMP/$t.der" 2>/dev/null
  if openssl cms -verify -inform DER -in "$TMP/$t.der" -CAfile "$CA" -purpose timestampsign -attime "$AT" -binary \
       -out "$TMP/$t.tstinfo" >/dev/null 2>"$TMP/$t.err"; then echo "  1. signature and chain: OK"
  else echo "  1. signature and chain: FAILED ($(tail -1 "$TMP/$t.err"))"; fail=1; fi
  imprint="$(openssl asn1parse -inform DER -in "$TMP/$t.tstinfo" 2>/dev/null | grep -m1 -E 'OCTET STRING +\[HEX DUMP\]' | sed 's/.*://' | tr 'A-F' 'a-f')"
  if [ "$imprint" = "$HASH" ]; then echo "  2. imprint = $HASH: OK"; else echo "  2. imprint $imprint != $HASH: FAILED"; fail=1; fi
  untrusted="$TMP/$t.certs.pem"; openssl pkcs7 -inform DER -in "$TMP/$t.der" -print_certs -out "$untrusted" 2>/dev/null
  if openssl ts -verify -digest "$HASH" -in "$tsr" -CAfile "$CA" -untrusted "$untrusted" -attime "$AT" >/dev/null 2>&1; then
    echo "  3. openssl ts -verify: OK"
  else echo "  3. openssl ts -verify: not passed (possible for Sectigo with some CA bundles, see the header)"; [ "$t" = sectigo ] || fail=1; fi
done
[ "$fail" = 0 ] && echo "both tokens verify against $HASH" || { echo "verification FAILED" >&2; exit 1; }
