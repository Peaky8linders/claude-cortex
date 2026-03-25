#!/usr/bin/env bash
# SessionStart: Load graph stats, inject quality summary into Claude's context
set -euo pipefail

KNOWLEDGE_DIR="$HOME/.claude/knowledge"
JOURNAL="$KNOWLEDGE_DIR/session-journal.jsonl"
mkdir -p "$KNOWLEDGE_DIR"

# Sanitize values to prevent JSON injection (strip quotes, backslashes, control chars)
sanitize() { echo "$1" | tr -d '"\\\n\r\t$`(){}!' | head -c 100; }

# Log session start boundary to journal (v2: adds model field)
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
SESSION_ID=$(sanitize "${CLAUDE_SESSION_ID:-$$}")
MODEL=$(sanitize "${CLAUDE_MODEL:-unknown}")
echo "{\"type\":\"session_start\",\"ts\":\"$TIMESTAMP\",\"sid\":\"$SESSION_ID\",\"model\":\"$MODEL\"}" >> "$JOURNAL" 2>/dev/null || true

if [ -f "$KNOWLEDGE_DIR/graph/nodes.json" ]; then
  # Count nodes and edges via sys.argv to avoid shell injection in Python string
  NODES=$(python3 -c "import json,sys; print(len(json.load(open(sys.argv[1]))))" "$KNOWLEDGE_DIR/graph/nodes.json" 2>/dev/null || echo "?")
  EDGES=$(python3 -c "import json,sys; print(len(json.load(open(sys.argv[1]))))" "$KNOWLEDGE_DIR/graph/edges.json" 2>/dev/null || echo "?")
  echo "{\"additionalContext\": \"[Cortex] Graph loaded: ${NODES} nodes, ${EDGES} edges. Use /cortex-status for details.\"}"
else
  echo '{"additionalContext": "[Cortex] No knowledge graph found. Use /learn after substantial work to start building it."}'
fi
