#!/usr/bin/env bash
# Usage tip detector: Analyzes session journal for anti-patterns, writes active tip
# Called periodically from on-tool-use.sh (every 10 tool calls)
# Output: writes ~/.claude/knowledge/active-tip.json for consumption by sync hooks
set -euo pipefail

KNOWLEDGE_DIR="$HOME/.claude/knowledge"
JOURNAL="$KNOWLEDGE_DIR/session-journal.jsonl"
TIP_FILE="$KNOWLEDGE_DIR/active-tip.json"

# Bail if no journal; tips DB path is validated by Python, but we
# ensure a default-only path exists before exporting it.
[ -f "$JOURNAL" ] || exit 0

# If TIPS_DB_PATH is not already provided, derive it from CLAUDE_PLUGIN_ROOT
# and ensure that file exists before proceeding.
if [ -z "${TIPS_DB_PATH:-}" ]; then
  TIPS_DB="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}/hooks/scripts/usage-tips.json"
  [ -f "$TIPS_DB" ] || exit 0
  export TIPS_DB_PATH="$TIPS_DB"
fi
python3 << 'PYEOF'
import json, os, time
from datetime import datetime, timezone

knowledge_dir = os.path.join(os.environ.get("HOME", os.path.expanduser("~")), ".claude", "knowledge")
journal_path = os.path.join(knowledge_dir, "session-journal.jsonl")
tip_file = os.path.join(knowledge_dir, "active-tip.json")
tips_db_path = os.environ.get("TIPS_DB_PATH", "")

# Find tips DB
plugin_root = os.environ.get("CLAUDE_PLUGIN_ROOT", "")
if not tips_db_path:
    for candidate in [
        os.path.join(plugin_root, "hooks", "scripts", "usage-tips.json") if plugin_root else "",
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "usage-tips.json") if "__file__" in dir() else "",
    ]:
        if candidate and os.path.exists(candidate):
            tips_db_path = candidate
            break

# Fallback: try relative to script location via env
if not tips_db_path:
    # Try common locations
    for d in [os.path.dirname(os.path.realpath("/proc/self/fd/0")) if os.path.exists("/proc/self/fd/0") else ""]:
        pass
    # Final fallback: search near knowledge dir
    import glob
    candidates = glob.glob(os.path.join(os.path.expanduser("~"), ".claude", "**", "usage-tips.json"), recursive=True)
    if candidates:
        tips_db_path = candidates[0]

if not tips_db_path or not os.path.exists(tips_db_path):
    raise SystemExit(0)

# Load tips database
with open(tips_db_path) as f:
    tips_data = json.load(f)
tips = tips_data["tips"]

# Load only current session entries by reading from the end of the journal.
# This avoids loading the entire (potentially large) file into memory on every
# invocation — important because this hook fires every ~10 tool calls.
session_entries = []
try:
    with open(journal_path, "rb") as f:
        # Seek to end, then read backwards in chunks to find session_start
        f.seek(0, 2)
        file_size = f.tell()
        if file_size == 0:
            raise SystemExit(0)
        chunk_size = 8192
        remainder = b""
        found_boundary = False
        pos = file_size
        while pos > 0 and not found_boundary:
            read_size = min(chunk_size, pos)
            pos -= read_size
            f.seek(pos)
            chunk = f.read(read_size) + remainder
            lines = chunk.split(b"\n")
            # First element may be a partial line — save as remainder
            remainder = lines[0]
            # Process complete lines in reverse
            for raw in reversed(lines[1:]):
                raw = raw.strip()
                if not raw:
                    continue
                try:
                    entry = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                session_entries.insert(0, entry)
                if entry.get("type") == "session_start":
                    found_boundary = True
                    break
        # Handle the very first line of the file (remainder)
        if not found_boundary and remainder.strip():
            try:
                entry = json.loads(remainder.strip())
                session_entries.insert(0, entry)
            except json.JSONDecodeError:
                pass
except Exception:
    raise SystemExit(0)

if not session_entries:
    raise SystemExit(0)

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

    elif trigger == "rapid_sessions":
        # Many events in a short session duration
        # Uses configuration keys if present, with safe defaults.
        min_events = signal.get("journal_events_gt", 3)
        max_age_min = signal.get("session_age_max", 10)
        if event_count > min_events and age_min < max_age_min:
            score = signal.get("weight", 0.4)

    elif trigger == "self_reference_query" and signal.get("always_eligible"):
        # Simple opt-in tip controlled by config; no specialized detection here.
        score = signal.get("weight", 0.3)
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
