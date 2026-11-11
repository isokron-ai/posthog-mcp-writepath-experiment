#!/bin/bash
# Dedicated local Redis for the MCP server's session state (loopback only). usage: server/redis.sh up|down|flush|status
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; eval "$(python3 -I -B "$ROOT/lib/target.py" --shell)" || exit 2
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
case "${1:-}" in
  up)
    if ! docker ps --format '{{.Names}}' | grep -qx "$REDIS_CONTAINER"; then
      docker rm -f "$REDIS_CONTAINER" >/dev/null 2>&1 || true
      docker run -d --name "$REDIS_CONTAINER" -p "127.0.0.1:${REDIS_PORT}:6379" "$REDIS_IMAGE" redis-server --save '' --appendonly no >/dev/null
    fi
    for i in $(seq 1 40); do docker exec "$REDIS_CONTAINER" redis-cli ping 2>/dev/null | grep -q PONG && { echo "redis up on 127.0.0.1:$REDIS_PORT"; exit 0; }; sleep 0.25; done
    echo "redis did not come up" >&2; exit 1;;
  flush) docker exec "$REDIS_CONTAINER" redis-cli flushall >/dev/null && echo flushed;;
  down) docker rm -f "$REDIS_CONTAINER" >/dev/null 2>&1 || true; echo "redis down";;
  status) docker ps --format '{{.Names}} {{.Status}} {{.Ports}}' | grep "^$REDIS_CONTAINER " || { echo "redis not running"; exit 1; };;
  *) echo "usage: server/redis.sh up|down|flush|status" >&2; exit 2;;
esac
