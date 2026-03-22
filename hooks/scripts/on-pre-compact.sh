#!/usr/bin/env bash
# PreCompact: Snapshot graph state before compaction
set -euo pipefail

KNOWLEDGE_DIR="$HOME/.claude/knowledge"
SNAPSHOTS="$KNOWLEDGE_DIR/snapshots"
mkdir -p "$SNAPSHOTS"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)

if [ -f "$KNOWLEDGE_DIR/graph/nodes.json" ]; then
  cp "$KNOWLEDGE_DIR/graph/nodes.json" "$SNAPSHOTS/nodes_${TIMESTAMP}.json"
  cp "$KNOWLEDGE_DIR/graph/edges.json" "$SNAPSHOTS/edges_${TIMESTAMP}.json" 2>/dev/null || true

  # Keep only last 10 snapshots
  ls -t "$SNAPSHOTS"/nodes_*.json 2>/dev/null | tail -n +11 | xargs rm -f 2>/dev/null || true
  ls -t "$SNAPSHOTS"/edges_*.json 2>/dev/null | tail -n +11 | xargs rm -f 2>/dev/null || true
fi
