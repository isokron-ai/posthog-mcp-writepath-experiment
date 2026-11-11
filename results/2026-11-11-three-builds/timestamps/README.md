# RFC 3161 timestamps of the measured series' freeze

Before the first measured run of series `usability-3build-20261110-r3`, the harness wrote a manifest of the frozen
harness (sha256 of every harness file, the three bundle hashes, the run plan with its order seed, the model id and tool
versions) and had its sha256 timestamped by two independent time-stamping authorities, Sectigo and DigiCert, on
10 November 2026 at 22:53:09 UTC.

| File | What it is |
| --- | --- |
| `MANIFEST.json.sha256` | The sha256 of the original manifest: `ba28998491b76e9dd48faa52ef9c77f130c07721a34e2c584876a525090ac872`, byte-identical to the file written at the freeze |
| `manifest.tsq` | The timestamp request (that hash, a nonce, certificate requested) |
| `manifest.sectigo.tsr`, `manifest.digicert.tsr` | The two timestamp responses, as returned |
| `verify.sh` | Checks both tokens against the hash; see below |

**The original manifest is not published.** It also records the local test instance's organization id, project id,
key-file path and self-host directory. A redacted copy, [`../MANIFEST.public.json`](../MANIFEST.public.json), has those
four fields replaced and therefore does not hash to `ba289984…`. Every other field of the redacted copy (harness file
hashes, build hashes, plan, order seed, versions) is as frozen, and the bundle hashes in it match the builds anyone can
reproduce from this repository.

What the tokens prove: that a document with sha256 `ba289984…` existed at 22:53:09 UTC on 10 November 2026, before the
first measured run started (23:26:40 UTC). The header of [`../ANALYSIS.md`](../ANALYSIS.md) carries the same hash. The
tokens do not let you check the redacted fields yourself.

## Verify

```sh
./verify.sh                      # uses /etc/ssl/cert.pem or /etc/ssl/certs/ca-certificates.crt
./verify.sh /path/to/ca-bundle.pem
```

By hand, for one token (OpenSSL 3 or later):

```sh
H=ba28998491b76e9dd48faa52ef9c77f130c07721a34e2c584876a525090ac872
openssl ts -reply -in manifest.digicert.tsr -text                     # status, time, TSA, message imprint
openssl ts -reply -in manifest.digicert.tsr -token_out -out t.der
openssl pkcs7 -inform DER -in t.der -print_certs -out chain.pem        # the TSA certificates carried in the token
openssl ts -verify -digest $H -in manifest.digicert.tsr -CAfile /etc/ssl/cert.pem -untrusted chain.pem -attime 1794351189
```

`-attime 1794351189` (22:53:09 UTC) checks the certificates as they were when the token was issued, so the check keeps
working after the TSA certificates expire. If `openssl ts -verify` rejects the Sectigo token at its ESS check with your
CA bundle, `verify.sh` also verifies the token's CMS signature and chain with `openssl cms -verify -purpose
timestampsign` and compares the message imprint with the hash.
