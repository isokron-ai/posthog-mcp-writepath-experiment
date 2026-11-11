#!/bin/bash
# Entry point for benchmark runs. Exports the Anthropic API key from the first line of the key file (by path; the value is
# never printed or logged) and starts the driver. All arguments go to bench/run_bench.py (--dry-run N, --only, ...).
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT" || exit 2
eval "$(python3 -I -B "$ROOT/lib/target.py" --shell)" || exit 2
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
case " $* " in *" --simulate-costs "*) exec python3 -I -B bench/run_bench.py "$@";; esac
KEYFILE="${ANTHROPIC_KEY_FILE/#\~/$HOME}"
[ -r "$KEYFILE" ] || { echo "Anthropic key file $ANTHROPIC_KEY_FILE not readable: refusing" >&2; exit 2; }
ANTHROPIC_API_KEY="$(head -n1 "$KEYFILE")"; export ANTHROPIC_API_KEY
[ -n "$ANTHROPIC_API_KEY" ] || { echo "Anthropic key file is empty: refusing" >&2; exit 2; }
unset CLAUDE_CODE_OAUTH_TOKEN
exec python3 -I -B bench/run_bench.py "$@"
