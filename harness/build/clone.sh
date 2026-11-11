#!/bin/bash
# Economical clone of PostHog/posthog at the pinned SHA: blobless, sparse (the MCP server and what its bundle needs).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; . "$ROOT/build/PIN"
DEST="$ROOT/src/posthog"
if [ ! -d "$DEST/.git" ]; then
  mkdir -p "$ROOT/src"
  git clone --filter=blob:none --no-checkout "$POSTHOG_REPO" "$DEST"
fi
cd "$DEST"
git sparse-checkout init --no-cone
git sparse-checkout set \
  '/services/mcp/' '/package.json' '/pnpm-workspace.yaml' '/pnpm-lock.yaml' '/tsconfig*.json' '/turbo.json' \
  '/packages/' '/tools/openapi-codegen/' '/patches/' \
  '/products/posthog_ai/skills/querying-posthog-data/' '/products/ai_observability/backend/prompts/' \
  '/products/*/mcp/' '/products/*/package.json' \
  '/products/notebooks/notebook-widget-catalog.json' '/products/notebooks/notebookResultPreview*'
git cat-file -e "$POSTHOG_SHA^{commit}" 2>/dev/null || git fetch --filter=blob:none origin "$POSTHOG_SHA"
git checkout -q --detach "$POSTHOG_SHA"
echo "src/posthog at $(git rev-parse HEAD)"
