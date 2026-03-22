#!/usr/bin/env bash
# SessionStart: Load graph from disk, inject quality score + top recommendations
set -euo pipefail

PLUGIN_DATA="${CLAUDE_PLUGIN_DATA:-$HOME/.claude/cortex-data}"
mkdir -p "$PLUGIN_DATA"

GRAPH_FILE="$PLUGIN_DATA/graph.json"

if [ -f "$GRAPH_FILE" ]; then
  # Read graph and compute summary
  node "$(dirname "$0")/../scripts/cortex-engine.js" status --brief < /dev/null 2>"$PLUGIN_DATA/cortex.log" || true
else
  echo '{"additionalContext": "[Cortex] New session — knowledge graph will build as you work."}'
fi
