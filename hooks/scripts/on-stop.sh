#!/usr/bin/env bash
# Stop: Show 1-line graph summary
set -euo pipefail

KNOWLEDGE_DIR="$HOME/.claude/knowledge"

if [ -f "$KNOWLEDGE_DIR/graph/nodes.json" ]; then
  NODES=$(python3 -c "import json; print(len(json.load(open('$KNOWLEDGE_DIR/graph/nodes.json'))))" 2>/dev/null || echo "?")
  JOURNAL="$KNOWLEDGE_DIR/session-journal.jsonl"
  EVENTS=$(wc -l < "$JOURNAL" 2>/dev/null | tr -d ' ' || echo "0")
  echo "[Cortex] Session: ${EVENTS} events tracked, ${NODES} nodes in graph. Run /learn to capture insights."
fi
