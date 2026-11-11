#!/bin/bash
# Download the two skills archives the MCP server loads at start-up (sources in PROVENANCE.json) and compare them with
# SHA256SUMS, the copies served during the measured runs. skills-mcp-resources.zip is a fixed release (v1.62.0);
# skills.zip is re-published under the same tag, so a fresh download may differ: this script says so and leaves
# SHA256SUMS alone. server/local-runtime.mjs serves only files that match SHA256SUMS.
set -euo pipefail
cd "$(dirname "$0")"
curl -fsSL -o skills.zip https://github.com/PostHog/posthog/releases/download/agent-skills-latest/skills.zip
curl -fsSL -o skills-mcp-resources.zip https://github.com/PostHog/context-mill/releases/download/v1.62.0/skills-mcp-resources.zip
while read -r want name; do
  got="$(shasum -a 256 "$name" | cut -d' ' -f1)"
  if [ "$got" = "$want" ]; then echo "$name: matches the measured copy"
  else echo "$name: DIFFERS from the measured copy ($got). Record it in SHA256SUMS only as a disclosed deviation."; fi
done < SHA256SUMS
