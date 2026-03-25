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
  GRAPH_MSG="[Cortex] Graph loaded: ${NODES} nodes, ${EDGES} edges. Use /cortex-status for details."
else
  GRAPH_MSG="[Cortex] No knowledge graph found. Use /learn after substantial work to start building it."
fi

# Surface a usage tip from previous session analysis or rotate a random one
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TIPS_DB="$SCRIPT_DIR/usage-tips.json"
TIP_MSG=""
if [ -f "$KNOWLEDGE_DIR/active-tip.json" ]; then
  # Use the previously detected tip
  TIP_MSG=$(python3 -c "
import json, sys
try:
    with open(sys.argv[1]) as f:
        tip = json.load(f)
    print(f'[Usage Tip] {tip[\"title\"]}: {tip[\"short\"]}')
except Exception:
    pass
" "$KNOWLEDGE_DIR/active-tip.json" 2>/dev/null || true)
elif [ -f "$TIPS_DB" ]; then
  # No active tip — pick a random one for fresh sessions
  TIP_MSG=$(python3 -c "
import json, random, sys
try:
    with open(sys.argv[1]) as f:
        tips = json.load(f)['tips']
    tip = random.choice(tips)
    print(f'[Usage Tip] {tip[\"title\"]}: {tip[\"short\"]}')
except Exception:
    pass
" "$TIPS_DB" 2>/dev/null || true)
fi

# Combine graph status + usage tip
if [ -n "$TIP_MSG" ]; then
  FULL_MSG="${GRAPH_MSG}\n${TIP_MSG}"
else
  FULL_MSG="${GRAPH_MSG}"
fi

echo "{\"additionalContext\": \"${FULL_MSG}\"}"
