#!/usr/bin/env bash
# PostToolUse: Log tool event to session journal (async, no latency impact)
set -euo pipefail

KNOWLEDGE_DIR="$HOME/.claude/knowledge"
JOURNAL="$KNOWLEDGE_DIR/session-journal.jsonl"
mkdir -p "$KNOWLEDGE_DIR"

EVENT_TYPE="${1:-unknown}"
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
TIMESTAMP_EPOCH=$(date +%s 2>/dev/null || echo "0")

# Capture tool name and estimate tokens from stdin size
# Sanitize all values to prevent JSON injection (strip quotes, backslashes, control chars)
sanitize() { echo "$1" | tr -d '"\\\n\r\t$`(){}!' | head -c 100; }
TOOL_NAME=$(sanitize "${CLAUDE_TOOL_NAME:-unknown}")
SESSION_ID=$(sanitize "${CLAUDE_SESSION_ID:-$$}")
SAFE_TYPE=$(sanitize "$EVENT_TYPE")
MODEL=$(sanitize "${CLAUDE_MODEL:-unknown}")
# Prompt correlation: same-second events within a session belong to the same prompt turn
PROMPT_ID="${SESSION_ID}-${TIMESTAMP_EPOCH}"
# Read stdin to estimate token cost (4 chars ≈ 1 token)
INPUT_SIZE=$(cat /dev/stdin 2>/dev/null | wc -c | tr -d ' ' || echo "0")
TOKENS_EST=$(( INPUT_SIZE / 4 ))

# Append enriched event to session journal (v2: adds model, prompt_id for Dynatrace-style correlation)
echo "{\"type\":\"$SAFE_TYPE\",\"ts\":\"$TIMESTAMP\",\"tool\":\"$TOOL_NAME\",\"sid\":\"$SESSION_ID\",\"tokens_est\":$TOKENS_EST,\"event\":\"PostToolUse\",\"model\":\"$MODEL\",\"prompt_id\":\"$PROMPT_ID\"}" >> "$JOURNAL" 2>/dev/null || true

# Usage tip detection: run every 10 tool calls (async, non-blocking)
COUNTER_FILE="$KNOWLEDGE_DIR/session-${SESSION_ID}-posttooluse-count"
EVENT_COUNT=0
if [ -f "$COUNTER_FILE" ]; then
  EVENT_COUNT=$(cat "$COUNTER_FILE" 2>/dev/null || echo "0")
fi
# Ensure EVENT_COUNT is numeric; reset to 0 if not
case "$EVENT_COUNT" in
  ''|*[!0-9]*)
    EVENT_COUNT=0
    ;;
esac
EVENT_COUNT=$(( EVENT_COUNT + 1 ))
echo "$EVENT_COUNT" > "$COUNTER_FILE" 2>/dev/null || true

if [ $(( EVENT_COUNT % 10 )) -eq 0 ]; then
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  export TIPS_DB_PATH="$SCRIPT_DIR/usage-tips.json"
  bash "$SCRIPT_DIR/on-usage-tip.sh" 2>/dev/null &
fi
