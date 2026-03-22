#!/usr/bin/env bash
# SessionStart: Load graph stats, inject quality summary into Claude's context
set -euo pipefail

KNOWLEDGE_DIR="$HOME/.claude/knowledge"

if [ -f "$KNOWLEDGE_DIR/graph/nodes.json" ]; then
  # Count nodes and edges for a quick summary
  NODES=$(python3 -c "import json; print(len(json.load(open('$KNOWLEDGE_DIR/graph/nodes.json'))))" 2>/dev/null || echo "?")
  EDGES=$(python3 -c "import json; print(len(json.load(open('$KNOWLEDGE_DIR/graph/edges.json'))))" 2>/dev/null || echo "?")
  echo "{\"additionalContext\": \"[Cortex] Graph loaded: ${NODES} nodes, ${EDGES} edges. Use /cortex-status for details.\"}"
else
  echo '{"additionalContext": "[Cortex] No knowledge graph found. Use /learn after substantial work to start building it."}'
fi
