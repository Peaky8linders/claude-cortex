#!/usr/bin/env bash
# PostToolUse: Log tool event to session journal (async, no latency impact)
set -euo pipefail

KNOWLEDGE_DIR="$HOME/.claude/knowledge"
JOURNAL="$KNOWLEDGE_DIR/session-journal.jsonl"
mkdir -p "$KNOWLEDGE_DIR"

EVENT_TYPE="${1:-unknown}"
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Append event to session journal (consumed by /learn at session end)
echo "{\"type\":\"$EVENT_TYPE\",\"ts\":\"$TIMESTAMP\"}" >> "$JOURNAL" 2>/dev/null || true
