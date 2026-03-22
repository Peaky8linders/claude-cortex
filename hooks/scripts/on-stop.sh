#!/usr/bin/env bash
# Stop: Persist graph, output 1-line summary
set -euo pipefail

PLUGIN_DATA="${CLAUDE_PLUGIN_DATA:-$HOME/.claude/cortex-data}"

if [ -f "$PLUGIN_DATA/graph.json" ]; then
  node "$(dirname "$0")/../scripts/cortex-engine.js" summary 2>>"$PLUGIN_DATA/cortex.log" || true
fi
