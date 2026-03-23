#!/usr/bin/env bash
# Stop: Show graph summary + check Ralph Wiggum loop
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KNOWLEDGE_DIR="$HOME/.claude/knowledge"

# Check Ralph Wiggum loop first — if active, re-feed takes priority
RALPH_FILE="$KNOWLEDGE_DIR/.ralph-active"
if [ -f "$RALPH_FILE" ]; then
  RALPH_LOG="$KNOWLEDGE_DIR/ralph-errors.log"
  RALPH_OUTPUT=$("$SCRIPT_DIR/ralph-loop.sh" 2>>"$RALPH_LOG" || echo "")
  if [ -n "$RALPH_OUTPUT" ]; then
    echo "$RALPH_OUTPUT"
    # Clean up cache if loop ended (ralph-loop.sh removed .ralph-active)
    if [ ! -f "$RALPH_FILE" ]; then
      rm -f "$KNOWLEDGE_DIR/.ralph-search-cache"
    fi
    exit 0
  fi
  # ralph-loop.sh returned empty but didn't clean up — error state
  if [ -f "$RALPH_FILE" ]; then
    echo "[Ralph] WARNING: Loop script returned no output but .ralph-active still exists. Check $RALPH_LOG" >> "$RALPH_LOG"
    echo "[Ralph] Loop error detected. Check ~/.claude/knowledge/ralph-errors.log for details."
  fi
  rm -f "$KNOWLEDGE_DIR/.ralph-search-cache"
fi

# Normal stop: show 1-line graph summary
if [ -f "$KNOWLEDGE_DIR/graph/nodes.json" ]; then
  NODES=$(python3 -c "import json; print(len(json.load(open('$KNOWLEDGE_DIR/graph/nodes.json'))))" 2>/dev/null || echo "?")
  JOURNAL="$KNOWLEDGE_DIR/session-journal.jsonl"
  EVENTS=$(wc -l < "$JOURNAL" 2>/dev/null | tr -d ' ' || echo "0")
  echo "[Cortex] Session: ${EVENTS} events tracked, ${NODES} nodes in graph. Run /learn to capture insights."
fi
