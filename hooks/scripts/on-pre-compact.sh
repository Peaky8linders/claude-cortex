#!/usr/bin/env bash
# PreCompact: Snapshot all decisions, entities, active files, error resolutions to disk
set -euo pipefail

PLUGIN_DATA="${CLAUDE_PLUGIN_DATA:-$HOME/.claude/cortex-data}"
mkdir -p "$PLUGIN_DATA/snapshots"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Save current graph as snapshot
if [ -f "$PLUGIN_DATA/graph.json" ]; then
  cp "$PLUGIN_DATA/graph.json" "$PLUGIN_DATA/snapshots/${TIMESTAMP}.json"

  # Keep only last 10 snapshots
  ls -t "$PLUGIN_DATA/snapshots/"*.json 2>/dev/null | tail -n +11 | xargs rm -f 2>/dev/null || true
fi

# Output snapshot confirmation for Claude's context
node "$(dirname "$0")/../scripts/cortex-engine.js" snapshot --pre-compact 2>>"$PLUGIN_DATA/cortex.log" || true
