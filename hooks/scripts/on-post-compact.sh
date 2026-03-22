#!/usr/bin/env bash
# PostCompact: Inject recovery context — decisions (DO NOT reverse), active files, resolved errors
set -euo pipefail

PLUGIN_DATA="${CLAUDE_PLUGIN_DATA:-$HOME/.claude/cortex-data}"

if [ -f "$PLUGIN_DATA/graph.json" ]; then
  # Generate recovery context from the latest snapshot
  node "$(dirname "$0")/../scripts/cortex-engine.js" recover 2>>"$PLUGIN_DATA/cortex.log" || true
else
  echo '{"additionalContext": "[Cortex] No graph state available for recovery."}'
fi
