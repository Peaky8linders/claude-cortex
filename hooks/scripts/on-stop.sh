#!/usr/bin/env bash
# Stop: Show graph summary + cache cost efficiency + check Ralph Wiggum loop
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KNOWLEDGE_DIR="$HOME/.claude/knowledge"

# Sanitize values to prevent JSON injection (strip quotes, backslashes, control chars)
sanitize() { echo "$1" | tr -cd 'a-zA-Z0-9_-' | head -c 100; }

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

# Normal stop: log session end + show 1-line graph summary
JOURNAL="$KNOWLEDGE_DIR/session-journal.jsonl"
EVENTS=$(wc -l < "$JOURNAL" 2>/dev/null | tr -d ' ' || echo "0")
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
SESSION_ID=$(sanitize "${CLAUDE_SESSION_ID:-$$}")
MODEL=$(sanitize "${CLAUDE_MODEL:-unknown}")
echo "{\"type\":\"session_end\",\"ts\":\"$TIMESTAMP\",\"sid\":\"$SESSION_ID\",\"total_events\":$EVENTS,\"model\":\"$MODEL\"}" >> "$JOURNAL" 2>/dev/null || true

# Single Python invocation: compute cost summary + node count + cleanup old files
TURNS_FILE="$KNOWLEDGE_DIR/session-${SESSION_ID}-turns.jsonl"
SUMMARY_MSG=$(python3 -c "
import json, sys, os, glob

knowledge_dir = sys.argv[1]
turns_path = sys.argv[2]
events_count = sys.argv[3]

parts = []

# 1. Cost + cache efficiency from per-turn data
cost_msg = ''
if os.path.isfile(turns_path):
    try:
        entries = []
        with open(turns_path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entries.append(json.loads(line))
                except (json.JSONDecodeError, KeyError):
                    pass

        if entries:
            turns = {}
            for e in entries:
                pid = e.get('prompt_id', 'unknown')
                turns.setdefault(pid, 0)
                turns[pid] += e.get('tokens_est', 0)

            turn_list = list(turns.values())
            total_tokens = sum(turn_list)
            total_turns = len(turn_list)
            cost = total_tokens * (3 * 0.7 + 15 * 0.3) / 1_000_000

            miss_count = 0
            efficiency = 100
            if total_turns >= 2:
                first = turn_list[0]
                avg_rest = sum(turn_list[1:]) / len(turn_list[1:])
                if avg_rest > 0 and first / avg_rest > 3.0:
                    miss_count = 1
                efficiency = round((total_turns - 1 - miss_count) / max(1, total_turns - 1) * 100)

            miss_str = f', {miss_count} miss detected' if miss_count > 0 else ''
            cost_msg = f'\${cost:.4f} est, cache efficiency: {efficiency}%{miss_str}'
    except Exception:
        pass

# 2. Node count
nodes = '?'
nodes_path = os.path.join(knowledge_dir, 'graph', 'nodes.json')
if os.path.isfile(nodes_path):
    try:
        with open(nodes_path) as f:
            nodes = str(len(json.load(f)))
    except Exception:
        pass

# 3. Cleanup old per-session files (keep last 10)
for suffix in ['-turns.jsonl', '-type']:
    pattern = os.path.join(knowledge_dir, f'session-*{suffix}')
    files = sorted(glob.glob(pattern), key=os.path.getmtime, reverse=True)
    for old in files[10:]:
        try:
            os.remove(old)
        except OSError:
            pass

# 4. Build output
if nodes != '?':
    if cost_msg:
        print(f'[Cortex] Session: {events_count} events, {cost_msg}, {nodes} nodes in graph. Run /learn to capture insights.')
    else:
        print(f'[Cortex] Session: {events_count} events tracked, {nodes} nodes in graph. Run /learn to capture insights.')
" "$KNOWLEDGE_DIR" "$TURNS_FILE" "$EVENTS" 2>/dev/null || true)

if [ -n "$SUMMARY_MSG" ]; then
  echo "$SUMMARY_MSG"
fi
