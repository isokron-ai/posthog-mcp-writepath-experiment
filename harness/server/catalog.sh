#!/bin/bash
# Record what the agent will see from one build: initialize + tools/list through the proxy -> catalog/<build>-<mode>.json.
# Read-only by default (no tool is called). usage: TARGET=cloud|selfhosted server/catalog.sh baseline|fixed|usability [smoke.py args...]
#   -> $CATALOG_DIR/<build>-<mode>.json; extra arguments go to server/smoke.py (--exec, --read-call, --write-roundtrip N12).
# Afterwards prints where every connection of the MCP server went (the [egress] lines; TARGET=selfhosted only) and the
# upstreams in the proxy capture.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"; eval "$(python3 -I -B "$ROOT/lib/target.py" --shell)" || exit 2
BUILD="${1:-}"; case "$BUILD" in baseline|fixed|usability) ;; *) echo "usage: server/catalog.sh baseline|fixed|usability [smoke args]" >&2; exit 2;; esac; shift
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
mkdir -p logs "$CATALOG_DIR"; TS="$(date -u +%Y%m%dT%H%M%SZ)"
python3 -I -B -c "import sys; sys.path.insert(0,'lib'); import lock; lock.acquire('catalog $BUILD')"
trap 'kill ${PP:-} ${SP:-} 2>/dev/null || true; python3 -I -B -c "import sys; sys.path.insert(0,\"lib\"); import lock; lock.release()"' EXIT
server/redis.sh up >/dev/null
server/start-server.sh "$BUILD" > "logs/catalog-$BUILD-$TS.server.log" 2>&1 & SP=$!
for i in $(seq 1 120); do curl -s -m 2 "http://127.0.0.1:$MCP_SERVER_PORT/readyz" >/dev/null 2>&1 && break; sleep 0.5; done
ARGS=(--listen "$MCP_PROXY_PORT" --upstream "http://127.0.0.1:$MCP_SERVER_PORT" --key-file "$POSTHOG_KEY_FILE" --project-id "$POSTHOG_PROJECT_ID" --mode "$MCP_MODE" --target "$TARGET" --capture "logs/catalog-$BUILD-$TS.capture.jsonl")
[ -n "${MCP_FEATURES:-}" ] && ARGS+=(--features "$MCP_FEATURES")
node server/mcp-proxy.mjs "${ARGS[@]}" > "logs/catalog-$BUILD-$TS.proxy.log" 2>&1 & PP=$!
sleep 1
python3 -I -B server/smoke.py --port "$MCP_PROXY_PORT" --out "$CATALOG_DIR/$BUILD-$MCP_MODE.json" "$@"
shasum -a 256 "$CATALOG_DIR/$BUILD-$MCP_MODE.json"
kill "$PP" "$SP" 2>/dev/null || true; wait "$SP" 2>/dev/null || true; PP=; SP=
python3 -I -B - "logs/catalog-$BUILD-$TS.server.log" "logs/catalog-$BUILD-$TS.capture.jsonl" <<'PY'
import collections, json, sys
c = collections.Counter()
for l in open(sys.argv[1], errors="replace"):
    if l.startswith("[egress] "):
        j = json.loads(l[9:]); c["%s %s:%s" % (j["event"], j.get("host", ""), j.get("port", ""))] += 1 if j["event"] in ("allowed", "refused", "refused_dns") else 0
print("server connections: " + (", ".join("%s x%d" % kv for kv in sorted(c.items()) if kv[1]) or "no [egress] lines (TARGET=cloud runs without the guard)"))
u = collections.Counter(json.loads(l).get("upstream") for l in open(sys.argv[2]))
print("proxy capture upstreams: " + ", ".join("%s x%d" % kv for kv in u.items()))
PY
