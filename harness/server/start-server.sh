#!/bin/bash
# Start one build of the PostHog MCP server (Hono/Node bundle) on loopback, pointed at the PostHog of the selected TARGET.
# usage: TARGET=cloud|selfhosted server/start-server.sh baseline|fixed|usability     (runs in the foreground; the caller backgrounds it)
# The server holds no PostHog credential: every request carries its own Authorization header (added by server/mcp-proxy.mjs).
# TARGET=selfhosted additionally preloads server/local-runtime.mjs: loopback-only egress guard (every outgoing connection is
# logged as an "[egress]" line on stderr, anything not loopback is refused) and the pinned skills archives served on loopback.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
eval "$(python3 -I -B "$ROOT/lib/target.py" --shell)" || exit 2
BUILD="${1:-}"; case "$BUILD" in baseline|fixed|usability) ;; *) echo "usage: start-server.sh baseline|fixed|usability" >&2; exit 2;; esac
BUNDLE="$ROOT/build/out/$BUILD/hono-server.mjs"
[ -f "$BUNDLE" ] || { echo "no build at $BUNDLE (run build/build.sh $BUILD)" >&2; exit 2; }
WANT="$(python3 -I -B -c 'import json,sys;print(json.load(open(sys.argv[1]))["entry_sha256"])' "$ROOT/build/out/$BUILD/BUILD.json")"
GOT="$(shasum -a 256 "$BUNDLE" | cut -d' ' -f1)"
[ "$WANT" = "$GOT" ] || { echo "bundle hash $GOT does not match BUILD.json $WANT: refusing" >&2; exit 2; }
export PATH="/opt/homebrew/bin:$PATH"
EXTRA_ENV=(); PRELOAD=()
if [ "$TARGET" = selfhosted ]; then
  case "$POSTHOG_HOST" in http://127.0.0.1:*|http://localhost:*) ;; *) echo "TARGET=selfhosted but POSTHOG_HOST=$POSTHOG_HOST is not loopback: refusing" >&2; exit 2;; esac
  PRELOAD=(--import "$ROOT/server/local-runtime.mjs")
  EXTRA_ENV=(MCP_ASSETS_PORT="$MCP_ASSETS_PORT" MCP_EGRESS_LOG="${MCP_EGRESS_LOG:-}"
             POSTHOG_MCP_SKILLS_URL="http://127.0.0.1:${MCP_ASSETS_PORT}/skills.zip"
             POSTHOG_MCP_LOCAL_SKILLS_URL="http://127.0.0.1:${MCP_ASSETS_PORT}/skills-mcp-resources.zip")
fi
echo "start-server: target=$TARGET build=$BUILD api_base=$POSTHOG_HOST" >&2
# A clean environment: no analytics key (the server then captures no analytics), no Anthropic or PostHog credentials.
exec env -i PATH="$PATH" HOME="$HOME" \
  PORT="$MCP_SERVER_PORT" HOST=127.0.0.1 \
  REDIS_URL="redis://127.0.0.1:${REDIS_PORT}" \
  POSTHOG_API_BASE_URL="$POSTHOG_HOST" \
  MCP_APPS_BASE_URL="http://127.0.0.1:${MCP_SERVER_PORT}" \
  MCP_SIGNED_STATE_KEY="$(openssl rand -hex 32)" \
  ${EXTRA_ENV[@]+"${EXTRA_ENV[@]}"} \
  node ${PRELOAD[@]+"${PRELOAD[@]}"} "$BUNDLE"
