#!/usr/bin/env bash
# Usage tip detector: Analyzes session journal for anti-patterns, writes active tip
# Called periodically from on-tool-use.sh (every 10 tool calls)
# Output: writes ~/.claude/knowledge/active-tip.json for consumption by sync hooks
set -euo pipefail

KNOWLEDGE_DIR="$HOME/.claude/knowledge"
JOURNAL="$KNOWLEDGE_DIR/session-journal.jsonl"
TIP_FILE="$KNOWLEDGE_DIR/active-tip.json"
TIPS_DB="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}/hooks/scripts/usage-tips.json"

# Bail if no journal or tips DB
[ -f "$JOURNAL" ] || exit 0
[ -f "$TIPS_DB" ] || exit 0

export TIPS_DB_PATH="$TIPS_DB"

python3 << 'PYEOF'
import json, os, time
from datetime import datetime, timezone

knowledge_dir = os.path.join(os.environ.get("HOME", os.path.expanduser("~")), ".claude", "knowledge")
journal_path = os.path.join(knowledge_dir, "session-journal.jsonl")
tip_file = os.path.join(knowledge_dir, "active-tip.json")
tips_db_path = os.environ.get("TIPS_DB_PATH", "")

if not tips_db_path or not os.path.exists(tips_db_path):
    raise SystemExit(0)

# Load tips database
with open(tips_db_path) as f:
    tips_data = json.load(f)
tips = tips_data["tips"]

# Load journal entries for current session
entries = []
try:
    with open(journal_path) as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    entries.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
except Exception:
    raise SystemExit(0)

if not entries:
    raise SystemExit(0)

# Find current session entries (last session_start boundary)
session_entries = []
for i in range(len(entries) - 1, -1, -1):
    session_entries.insert(0, entries[i])
    if entries[i].get("type") == "session_start":
        break

now = time.time()
event_count = len(session_entries)

# Count by type
writes = [e for e in session_entries if e.get("type") == "write"]
reads = [e for e in session_entries if e.get("type") == "read"]
bashes = [e for e in session_entries if e.get("type") == "bash"]

# Estimate session age in minutes
if session_entries:
    try:
        first_ts = datetime.fromisoformat(session_entries[0]["ts"].replace("Z", "+00:00"))
        age_min = (datetime.now(timezone.utc) - first_ts).total_seconds() / 60
    except Exception:
        age_min = 0
else:
    age_min = 0

# Total tokens
total_tokens = sum(e.get("tokens_est", 0) for e in session_entries)

# Large reads (>4000 tokens)
large_reads = [e for e in reads if e.get("tokens_est", 0) > 4000]

# Large writes (>2000 tokens)
large_writes = [e for e in writes if e.get("tokens_est", 0) > 2000]

# Score each tip based on current session signals
scored_tips = []
for tip in tips:
    score = 0.0
    signal = tip.get("signal", {})
    trigger = tip.get("trigger", "")

    if trigger == "high_message_count" and event_count > signal.get("journal_events_gt", 999):
        score = 0.8

    elif trigger == "large_write" and large_writes:
        score = 0.7

    elif trigger == "large_read" and large_reads:
        score = 0.6

    elif trigger == "long_session" and event_count > signal.get("journal_events_gt", 999) and age_min > signal.get("session_age_min", 999):
        score = 0.9

    elif trigger == "session_start" and signal.get("always_eligible"):
        score = signal.get("weight", 0.1)

    elif trigger == "simple_task_heavy_model":
        model = session_entries[-1].get("model", "") if session_entries else ""
        if "opus" in model.lower() and event_count < 5:
            score = 0.5

    if score > 0:
        scored_tips.append((score, tip))

if not scored_tips:
    raise SystemExit(0)

# Pick the highest scoring tip, but avoid repeating the last shown tip
scored_tips.sort(key=lambda x: x[0], reverse=True)

last_tip_id = ""
try:
    if os.path.exists(tip_file):
        with open(tip_file) as f:
            last_tip_id = json.load(f).get("tip_id", "")
except Exception:
    pass

# Pick first tip that isn't the last shown one
selected = None
for score, tip in scored_tips:
    if tip["id"] != last_tip_id:
        selected = (score, tip)
        break

if not selected:
    selected = scored_tips[0]  # Fall back to top if all are same

score, tip = selected

# Write active tip
result = {
    "tip_id": tip["id"],
    "title": tip["title"],
    "short": tip["short"],
    "detail": tip["detail"],
    "category": tip["category"],
    "relevance_score": round(score, 2),
    "detected_at": datetime.now(timezone.utc).isoformat(),
    "session_events": event_count,
    "session_tokens": total_tokens,
}

with open(tip_file, "w") as f:
    json.dump(result, f, indent=2)

PYEOF
