#!/usr/bin/env bash
# SessionStart: Load graph stats, detect resume sessions, inject quality summary + cache warnings
set -euo pipefail

KNOWLEDGE_DIR="$HOME/.claude/knowledge"
JOURNAL="$KNOWLEDGE_DIR/session-journal.jsonl"
mkdir -p "$KNOWLEDGE_DIR"

# Sanitize values to prevent JSON injection (strip quotes, backslashes, control chars)
sanitize() { echo "$1" | tr -cd 'a-zA-Z0-9_-' | head -c 100; }

# Parse stdin JSON for session type (startup, resume, compact, clear)
STDIN_DATA=$(cat /dev/stdin 2>/dev/null || echo "{}")
SESSION_TYPE=$(echo "$STDIN_DATA" | python3 -c "import json,sys; print(json.load(sys.stdin).get('source','startup'))" 2>/dev/null || echo "startup")
SESSION_TYPE=$(sanitize "$SESSION_TYPE")

# Log session start boundary to journal (v3: adds session_type field)
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
SESSION_ID=$(sanitize "${CLAUDE_SESSION_ID:-$$}")
MODEL=$(sanitize "${CLAUDE_MODEL:-unknown}")
echo "{\"type\":\"session_start\",\"ts\":\"$TIMESTAMP\",\"sid\":\"$SESSION_ID\",\"model\":\"$MODEL\",\"session_type\":\"$SESSION_TYPE\"}" >> "$JOURNAL" 2>/dev/null || true

# Persist session type for downstream hooks (on-tool-use.sh, on-stop.sh)
echo "$SESSION_TYPE" > "$KNOWLEDGE_DIR/session-${SESSION_ID}-type" 2>/dev/null || true

# Propagate session type to CLAUDE_ENV_FILE for downstream bash commands
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export CLAUDE_SESSION_TYPE=\"$SESSION_TYPE\"" >> "$CLAUDE_ENV_FILE" 2>/dev/null || true
fi

# Build graph status message
if [ -f "$KNOWLEDGE_DIR/graph/nodes.json" ]; then
  # Count nodes and edges via sys.argv to avoid shell injection in Python string
  NODES=$(python3 -c "import json,sys; print(len(json.load(open(sys.argv[1]))))" "$KNOWLEDGE_DIR/graph/nodes.json" 2>/dev/null || echo "?")
  EDGES=$(python3 -c "import json,sys; print(len(json.load(open(sys.argv[1]))))" "$KNOWLEDGE_DIR/graph/edges.json" 2>/dev/null || echo "?")
  GRAPH_MSG="[Cortex] Graph loaded: ${NODES} nodes, ${EDGES} edges. Use /cortex-status for details."
else
  GRAPH_MSG="[Cortex] No knowledge graph found. Use /learn after substantial work to start building it."
fi

# Cache cost warning for resume sessions
CACHE_MSG=""
if [ "$SESSION_TYPE" = "resume" ]; then
  # Estimate previous session size from journal to compute cache miss cost
  PREV_TOKENS=$(python3 -c "
import json, sys
journal_path = sys.argv[1]
sid = sys.argv[2]
try:
    total = 0
    with open(journal_path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                if entry.get('sid') == sid and entry.get('tokens_est', 0) > 0:
                    total += entry['tokens_est']
            except (json.JSONDecodeError, KeyError):
                pass
    print(total)
except Exception:
    print(0)
" "$JOURNAL" "$SESSION_ID" 2>/dev/null || echo "0")

  if [ "$PREV_TOKENS" -gt 0 ] 2>/dev/null; then
    # Estimate cache miss cost: full context rebuild at input pricing
    # Sonnet: $3/MTok input, so cache miss = prev_tokens * $3/1M
    MISS_COST=$(python3 -c "import sys; print(f'{int(sys.argv[1]) * 3 / 1_000_000:.4f}')" "$PREV_TOKENS" 2>/dev/null || echo "0.05")
    CACHE_MSG="[Cache] Resume detected: first API call will likely rebuild the full prompt cache (~${PREV_TOKENS} tokens, ~\$${MISS_COST} one-time cost). Subsequent turns cache normally."
  else
    CACHE_MSG="[Cache] Resume detected: first API call will likely be a full cache miss. Subsequent turns cache normally."
  fi
fi

# Surface a usage tip from previous session analysis or rotate a random one
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TIPS_DB="$SCRIPT_DIR/usage-tips.json"
TIP_MSG=""
if [ -f "$KNOWLEDGE_DIR/active-tip.json" ]; then
  # Use the previously detected tip
  TIP_MSG=$(python3 -c "import json, sys; \
try: \
    open_file = open(sys.argv[1]); \
    tip = json.load(open_file); \
    open_file.close(); \
    print(f'[Usage Tip] {tip[\"title\"]}: {tip[\"short\"]}'); \
except Exception: \
    pass" "$KNOWLEDGE_DIR/active-tip.json" 2>/dev/null || true)
elif [ -f "$TIPS_DB" ]; then
  # No active tip — pick a random one for fresh sessions
  TIP_MSG=$(python3 -c "import json, random, sys; \
try: \
    open_file = open(sys.argv[1]); \
    tips = json.load(open_file)['tips']; \
    open_file.close(); \
    tip = random.choice(tips); \
    print(f'[Usage Tip] {tip[\"title\"]}: {tip[\"short\"]}'); \
except Exception: \
    pass" "$TIPS_DB" 2>/dev/null || true)
fi

# Combine graph status + cache warning + usage tip
FULL_MSG="${GRAPH_MSG}"
if [ -n "$CACHE_MSG" ]; then
  FULL_MSG="${FULL_MSG}"$'\n'"${CACHE_MSG}"
fi
if [ -n "$TIP_MSG" ]; then
  FULL_MSG="${FULL_MSG}"$'\n'"${TIP_MSG}"
fi

python3 -c 'import json,sys; print(json.dumps({"additionalContext": sys.stdin.read()}))' <<< "$FULL_MSG"
