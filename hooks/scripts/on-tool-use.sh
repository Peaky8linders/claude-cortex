#!/usr/bin/env bash
# PostToolUse: Update graph with tool event (write/bash/read)
set -euo pipefail

PLUGIN_DATA="${CLAUDE_PLUGIN_DATA:-$HOME/.claude/cortex-data}"
mkdir -p "$PLUGIN_DATA"

EVENT_TYPE="${1:-unknown}"

# Pipe stdin (hook event JSON) through the engine
cat | node "$(dirname "$0")/../scripts/cortex-engine.js" ingest --type "$EVENT_TYPE" 2>>"$PLUGIN_DATA/cortex.log" || true
