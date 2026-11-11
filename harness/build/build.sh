#!/bin/bash
# Build the PostHog MCP server (services/mcp, Hono/Node runtime) from source at the pinned SHA.
#   build/build.sh baseline   unmodified upstream at POSTHOG_SHA
#   build/build.sh fixed      the same SHA plus every experiment-patches/bugfix/*.patch, in the order of experiment-patches/bugfix/SERIES (name order if absent).
#                             A patch that does not apply is recorded in BUILD.json (patches_not_applied) and skipped, never edited.
#   build/build.sh usability  the research build: exactly what `fixed` applies (experiment-patches/bugfix/ in experiment-patches/bugfix/SERIES order), then the
#                             combined usability series experiment-patches/usability/*.patch in experiment-patches/usability/SERIES order
#                             (the usability series of this repository). Same skip-and-record rule. `baseline` and
#                             `fixed` build exactly as before; nothing below changes for them.
# Output: build/out/<name>/hono-server.mjs (+ .map) and build/out/<name>/BUILD.json (hashes).
# Each build gets its own source copy and its own dependency install under build/work/<name>/.
set -euo pipefail
NAME="${1:-}"
case "$NAME" in baseline|fixed|usability) ;; *) echo "usage: build/build.sh baseline|fixed|usability" >&2; exit 2;; esac
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/build/PIN"
SRC="$ROOT/src/posthog"
WORK="$ROOT/build/work/$NAME"
OUT="$ROOT/build/out/$NAME"
# The patch series live at the top of this repository (experiment-patches/), each directory with a SERIES file that
# fixes the order. PATCH_DIR / USABILITY_PATCH_DIR override them.
PATCH_DIR="${PATCH_DIR:-$ROOT/../experiment-patches/bugfix}"
USABILITY_PATCH_DIR="${USABILITY_PATCH_DIR:-$ROOT/../experiment-patches/usability}"
export PATH="/opt/homebrew/bin:$PATH"

[ -d "$SRC/.git" ] || { echo "missing clone at $SRC (see README: clone step)" >&2; exit 2; }
HEAD_SHA="$(git -C "$SRC" rev-parse HEAD)"
[ "$HEAD_SHA" = "$POSTHOG_SHA" ] || { echo "src/posthog is at $HEAD_SHA, pin is $POSTHOG_SHA: refusing" >&2; exit 2; }
if [ -n "$(git -C "$SRC" status --porcelain --untracked-files=no)" ]; then echo "src/posthog has local modifications: refusing" >&2; exit 2; fi

PATCHES=()
if [ "$NAME" = fixed ] || [ "$NAME" = usability ]; then
  if [ -f "$PATCH_DIR/SERIES" ]; then
    while IFS= read -r l; do l="${l%%#*}"; l="$(echo "$l" | tr -d '[:space:]')"; [ -z "$l" ] && continue
      [ -f "$PATCH_DIR/$l" ] || { echo "experiment-patches/bugfix/SERIES names $l, which is not in experiment-patches/bugfix/: refusing" >&2; exit 2; }
      PATCHES+=("$PATCH_DIR/$l"); done < "$PATCH_DIR/SERIES"
    for p in "$PATCH_DIR"/*.patch; do grep -qxF "$(basename "$p")" <(sed 's/#.*//; s/[[:space:]]//g' "$PATCH_DIR/SERIES") || { echo "experiment-patches/bugfix/$(basename "$p") is not listed in experiment-patches/bugfix/SERIES: refusing" >&2; exit 2; }; done
  else
    while IFS= read -r p; do PATCHES+=("$p"); done < <(find "$PATCH_DIR" -maxdepth 1 -name '*.patch' -type f | LC_ALL=C sort)
  fi
  if [ "${#PATCHES[@]}" -eq 0 ]; then echo "no patches yet (looked in $PATCH_DIR)" >&2; exit 3; fi
fi
USABILITY_PATCHES=()
if [ "$NAME" = usability ]; then
  [ -f "$USABILITY_PATCH_DIR/SERIES" ] || { echo "experiment-patches/usability/SERIES is missing: the usability series needs an explicit order" >&2; exit 2; }
  while IFS= read -r l; do l="${l%%#*}"; l="$(echo "$l" | tr -d '[:space:]')"; [ -z "$l" ] && continue
    [ -f "$USABILITY_PATCH_DIR/$l" ] || { echo "experiment-patches/usability/SERIES names $l, which is not in experiment-patches/usability/: refusing" >&2; exit 2; }
    USABILITY_PATCHES+=("$USABILITY_PATCH_DIR/$l"); done < "$USABILITY_PATCH_DIR/SERIES"
  for p in "$USABILITY_PATCH_DIR"/*.patch; do grep -qxF "$(basename "$p")" <(sed 's/#.*//; s/[[:space:]]//g' "$USABILITY_PATCH_DIR/SERIES") || { echo "experiment-patches/usability/$(basename "$p") is not listed in experiment-patches/usability/SERIES: refusing" >&2; exit 2; }; done
  [ "${#USABILITY_PATCHES[@]}" -gt 0 ] || { echo "no usability patches (looked in $USABILITY_PATCH_DIR)" >&2; exit 3; }
  PATCHES+=("${USABILITY_PATCHES[@]}")
fi

echo "== $NAME: fresh source copy at $POSTHOG_SHA"
rm -rf "$WORK" "$OUT"; mkdir -p "$WORK" "$OUT"
# tracked files only, exactly as committed (no node_modules, no dist, no untracked files)
# (the clone is sparse: entries flagged S by ls-files -t are outside the sparse checkout and are skipped)
git -C "$SRC" ls-files -t -z | perl -0 -ne 'print substr($_, 2) unless /^S /' | (cd "$SRC" && rsync -a --from0 --files-from=- ./ "$WORK/")

# The work copy gets its own throwaway git repository BEFORE any patch is applied. Without it, `git -C "$WORK" apply`
# runs inside the enclosing posthog-audit repository, treats build/work/<name> as a subdirectory of it, and silently
# ignores every path outside that subdirectory: each patch "applies" and nothing changes (found 2026-11-10, see LEDGER).
# It is also what the root "prepare" script (husky) needs. Never pushed, never committed to.
(cd "$WORK" && git init -q .)
[ "$(git -C "$WORK" rev-parse --show-toplevel)" = "$(cd "$WORK" && pwd -P)" ] || { echo "work copy is not its own git top level: refusing" >&2; exit 4; }
APPLIED='[]'; SKIPPED='[]'
if [ "$NAME" = fixed ] || [ "$NAME" = usability ]; then
  for p in "${PATCHES[@]}"; do
    b="$(basename "$p")"
    files=(); while IFS=$'\t' read -r _a _d f; do files+=("$f"); done < <(git -C "$WORK" apply --numstat "$p" 2>/dev/null)
    before="$(cd "$WORK" && for f in "${files[@]}"; do [ -f "$f" ] && shasum -a 256 "$f" || echo "missing $f"; done)"
    if git -C "$WORK" apply --check "$p" 2>/dev/null; then git -C "$WORK" apply "$p"; how="root"
    elif git -C "$WORK" apply --check --directory=services/mcp "$p" 2>/dev/null; then git -C "$WORK" apply --directory=services/mcp "$p"; how="services/mcp"
    else
      why="$( (git -C "$WORK" apply --check "$p" 2>&1 || true) | head -5 | tr '\n' ' ')"
      echo "NOT APPLIED: patch $b does not apply to $POSTHOG_SHA (after the patches before it): $why" >&2
      SKIPPED="$(python3 -I -B -c 'import json,sys,hashlib;a=json.loads(sys.argv[1]);a.append({"file":sys.argv[2],"sha256":hashlib.sha256(open(sys.argv[3],"rb").read()).hexdigest(),"reason":sys.argv[4]});print(json.dumps(a))' "$SKIPPED" "$b" "$p" "$why")"
      continue
    fi
    after="$(cd "$WORK" && for f in "${files[@]}"; do [ -f "$f" ] && shasum -a 256 "$f" || echo "missing $f"; done)"
    if [ "${#files[@]}" -eq 0 ] || [ "$before" = "$after" ]; then echo "patch $b reported success but changed no file: refusing" >&2; exit 4; fi
    echo "applied $b (relative to $how; ${#files[@]} file(s) changed)"
    APPLIED="$(python3 -I -B -c 'import json,sys,hashlib,re;a=json.loads(sys.argv[1]);t=open(sys.argv[3],"rb").read();m=re.match(rb"From ([0-9a-f]{40}) ",t);s=re.search(rb"^Subject: (?:\[PATCH[^\]]*\] )?(.*(?:\n .*)*)",t,re.M);a.append({"file":sys.argv[2],"sha256":hashlib.sha256(t).hexdigest(),"applied_relative_to":sys.argv[4],"commit":m.group(1).decode() if m else None,"subject":re.sub(r"\s+"," ",s.group(1).decode()) if s else None});print(json.dumps(a))' "$APPLIED" "$b" "$p" "$how")"
  done
  [ "$APPLIED" = '[]' ] && { echo "no patch applied: refusing to build a '$NAME' bundle identical to baseline" >&2; exit 4; }
fi

echo "== $NAME: install dependencies (pnpm, frozen lockfile, filter @posthog/mcp...)"
cd "$WORK"
# (the throwaway .git made above also serves the root "prepare" script, husky)
CI=1 HUSKY=0 pnpm install --frozen-lockfile --filter '@posthog/mcp...' --config.engine-strict=false > "$OUT/pnpm-install.log" 2>&1 || { tail -30 "$OUT/pnpm-install.log" >&2; echo "pnpm install failed" >&2; exit 5; }

echo "== $NAME: bundle the Hono entry (scripts/build-hono.ts, the same step as services/mcp/Dockerfile)"
cd "$WORK/services/mcp"
pnpm exec tsx scripts/build-hono.ts > "$OUT/build-hono.log" 2>&1 || { tail -30 "$OUT/build-hono.log" >&2; echo "bundle failed" >&2; exit 6; }
cp dist/hono-server.mjs dist/hono-server.mjs.map "$OUT/"

python3 -I -B - "$WORK" "$OUT" "$NAME" "$POSTHOG_SHA" "$APPLIED" "$SKIPPED" ${USABILITY_PATCHES[@]+"${USABILITY_PATCHES[@]}"} <<'PY'
import hashlib, json, os, subprocess, sys, time
work, out, name, sha, applied, skipped = sys.argv[1:7]
usability = {os.path.basename(p) for p in sys.argv[7:]}
h = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
# tree hash: sha256 over "sha256  relpath" lines of every source file of the server (after patching)
lines = []
for base in ("services/mcp/src", "services/mcp/scripts", "services/mcp/definitions", "services/mcp/schema", "packages/llm-normalizer/src", "products"):
    for d, dirs, fs in os.walk(os.path.join(work, base)):
        dirs[:] = sorted(x for x in dirs if x not in ("node_modules", "dist"))
        for f in sorted(fs):
            p = os.path.join(d, f)
            if os.path.islink(p): continue
            lines.append("%s  %s" % (h(p), os.path.relpath(p, work)))
lines.sort(key=lambda l: l.split("  ", 1)[1])
tree = hashlib.sha256(("\n".join(lines) + "\n").encode()).hexdigest()
ver = lambda *c: subprocess.run(c, capture_output=True, text=True).stdout.strip()
b = {"build": name, "posthog_repo": "PostHog/posthog", "posthog_sha": sha, "server_dir": "services/mcp",
     "patches": json.loads(applied), "patches_not_applied": json.loads(skipped), "entry": "hono-server.mjs", "entry_sha256": h(os.path.join(out, "hono-server.mjs")),
     "entry_bytes": os.path.getsize(os.path.join(out, "hono-server.mjs")), "source_tree_sha256": tree, "source_tree_files": len(lines),
     "node": ver("node", "--version"), "pnpm": ver("pnpm", "--version"), "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
     "note": "UI apps (public/ui-apps) are not built: they are static assets for clients that render MCP Apps and are not used by the benchmark."}
if name == "usability":
    # which series each applied (or skipped) patch came from: the bug-fix patches of `fixed`, then the usability series
    for p in b["patches"] + b["patches_not_applied"]:
        p["series"] = "usability" if p["file"] in usability else "bugfix"
    b["patch_series"] = {"bugfix": "experiment-patches/bugfix/ in experiment-patches/bugfix/SERIES order (exactly what build/build.sh fixed applies)",
                         "usability": "experiment-patches/usability/ in experiment-patches/usability/SERIES order (the usability series of this repository)"}
json.dump(b, open(os.path.join(out, "BUILD.json"), "w"), indent=2, sort_keys=True); open(os.path.join(out, "BUILD.json"), "a").write("\n")
print("built %s  entry_sha256=%s  source_tree_sha256=%s  patches=%d  not_applied=%d" % (name, b["entry_sha256"], tree, len(b["patches"]), len(b["patches_not_applied"])))
for o in ("baseline", "fixed", "usability"):
    other = os.path.join(os.path.dirname(out), o, "BUILD.json")
    if o != name and os.path.exists(other) and json.load(open(other))["entry_sha256"] == b["entry_sha256"]:
        print("WARNING: this bundle is byte-identical to the %s build's bundle: the patches change nothing that ends up in the server" % o)
PY
