#!/usr/bin/env bash
# Ralph Wiggum loop logic — called by on-stop.sh
# Checks if autonomous loop is active, quality gate passes, and iteration limit not reached
# Returns JSON with additionalContext to re-feed the prompt, or empty if loop should stop
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KNOWLEDGE_DIR="$HOME/.claude/knowledge"
RALPH_FILE="$KNOWLEDGE_DIR/.ralph-active"
RALPH_CACHE="$KNOWLEDGE_DIR/.ralph-search-cache"
RALPH_LOG="$KNOWLEDGE_DIR/ralph-errors.log"

# Exit silently if loop not active
if [ ! -f "$RALPH_FILE" ]; then
  exit 0
fi

# Single python3 call to read all loop state + check gates + build output
export RALPH_SCRIPT_DIR="$SCRIPT_DIR"
python3 << 'PYEOF'
import json, os, subprocess, sys
from datetime import datetime

knowledge_dir = os.path.join(os.environ.get("HOME", os.path.expanduser("~")), ".claude", "knowledge")
ralph_file = os.path.join(knowledge_dir, ".ralph-active")
ralph_cache = os.path.join(knowledge_dir, ".ralph-search-cache")
ralph_log = os.path.join(knowledge_dir, "ralph-errors.log")

def log_error(msg):
    with open(ralph_log, "a") as f:
        f.write(f"[{datetime.now().isoformat()}] {msg}\n")

try:
    with open(ralph_file) as f:
        state = json.load(f)
except (json.JSONDecodeError, FileNotFoundError) as e:
    log_error(f"Failed to read .ralph-active: {e}")
    sys.exit(0)

prompt = state.get("prompt", "")
iteration = state.get("iteration", 0)
max_iterations = state.get("max_iterations", 50)
scope = state.get("scope", "")
reset_strategy = state.get("reset_strategy", "compact")
if reset_strategy not in ("compact", "reset"):
    log_error(f"Unknown reset_strategy '{reset_strategy}', falling back to 'compact'")
    reset_strategy = "compact"

# Check iteration limit
if iteration >= max_iterations:
    print(f"[Ralph] Iteration limit reached ({iteration}/{max_iterations}). Stopping loop.")
    os.remove(ralph_file)
    if os.path.exists(ralph_cache):
        os.remove(ralph_cache)
    sys.exit(0)

# Check quality gate via shared quality-check.sh
quality_script = os.path.join(os.environ.get("RALPH_SCRIPT_DIR", "."), "quality-check.sh")
try:
    result = subprocess.run(["bash", quality_script], capture_output=True, text=True, timeout=10)
    quality_score = int(result.stdout.strip()) if result.stdout.strip().isdigit() else 70
except Exception as e:
    log_error(f"Quality check failed: {e}")
    quality_score = 70

if quality_score < 40:
    print(f"[Ralph] Quality gate triggered (composite: {quality_score}). Halting loop at iteration {iteration}.")
    os.remove(ralph_file)
    if os.path.exists(ralph_cache):
        os.remove(ralph_cache)
    sys.exit(0)

# Increment iteration counter
state["iteration"] = iteration + 1
with open(ralph_file, "w") as f:
    json.dump(state, f, indent=2)

next_iteration = iteration + 1

# Get git diff summary (last iteration's changes)
try:
    result = subprocess.run(
        ["git", "diff", "--stat", "HEAD~1"],
        capture_output=True, text=True, timeout=5
    )
    git_summary = "\n".join(result.stdout.strip().split("\n")[-5:]) if result.stdout.strip() else "No recent changes"
except Exception:
    git_summary = "No recent changes"

# Get graph recommendations — cached after first iteration
graph_recs = "No graph context available"
if os.path.exists(ralph_cache):
    # Reuse cached search results
    try:
        with open(ralph_cache) as f:
            graph_recs = f.read().strip() or graph_recs
    except Exception:
        pass
else:
    # First iteration: run search and cache
    try:
        result = subprocess.run(
            ["python3", "-m", "brainiac", "search", prompt],
            capture_output=True, text=True, timeout=30,
            cwd=knowledge_dir
        )
        if result.stdout.strip():
            graph_recs = "\n".join(result.stdout.strip().split("\n")[:10])
            with open(ralph_cache, "w") as f:
                f.write(graph_recs)
    except Exception as e:
        log_error(f"Graph search failed: {e}")

# Build handoff artifact for reset strategy (inline, no subprocess)
handoff = ""
if reset_strategy == "reset":
    try:
        nodes_path = os.path.join(knowledge_dir, "graph", "nodes.json")
        if os.path.exists(nodes_path):
            with open(nodes_path) as f:
                nodes = json.load(f)
            decisions = [n for n in nodes if n.get("type") == "decision"][:5]
            patterns = [n for n in nodes if n.get("type") == "pattern"][:5]
            items = []
            for d in decisions:
                items.append(f"  - [decision] {d.get('content', '')[:80]}")
            for p in patterns:
                items.append(f"  - [pattern] {p.get('content', '')[:80]}")
            handoff = "\n".join(items) if items else "No decisions or patterns recorded yet."
        else:
            handoff = "No graph data available."
    except Exception as e:
        log_error(f"Handoff artifact build failed: {e}")
        handoff = "Handoff unavailable — check ralph-errors.log"

# Build re-feed context as proper JSON
if reset_strategy == "reset":
    # Clean slate with structured handoff — no accumulated context
    context = (
        f"[Ralph Loop] Iteration {next_iteration}/{max_iterations} | Quality: {quality_score}/100\n"
        f"Strategy: CONTEXT RESET — clean slate with handoff artifact\n\n"
        f"TASK: {prompt}\n"
        f"SCOPE: {scope or 'entire project'}\n\n"
        f"HANDOFF FROM PREVIOUS ITERATION:\n"
        f"Files changed:\n{git_summary}\n\n"
        f"Key decisions and patterns:\n{handoff}\n\n"
        f"GRAPH CONTEXT:\n{graph_recs}\n\n"
        f"INSTRUCTIONS:\n"
        f"1. Read the git log to understand what was done: git log --oneline -5\n"
        f"2. Read any files you need context on — do NOT assume you remember them\n"
        f"3. Identify remaining work toward the task goal\n"
        f"4. Make progress and commit your changes\n"
        f"5. If the task is FULLY COMPLETE, run: /ralph-stop\n"
        f"6. Otherwise, just finish your work — the loop will continue automatically\n\n"
        f"Do NOT push to remote. Accumulated commits will be reviewed after the loop ends."
    )
else:
    # Standard compaction strategy — carry forward context
    context = (
        f"[Ralph Loop] Iteration {next_iteration}/{max_iterations} | Quality: {quality_score}/100\n\n"
        f"You are in an autonomous Ralph Wiggum loop. Continue working on the task below.\n\n"
        f"TASK: {prompt}\n"
        f"SCOPE: {scope or 'entire project'}\n\n"
        f"CHANGES FROM LAST ITERATION:\n{git_summary}\n\n"
        f"GRAPH CONTEXT:\n{graph_recs}\n\n"
        f"INSTRUCTIONS:\n"
        f"1. Review what was done in the previous iteration (git log, git diff)\n"
        f"2. Identify remaining work\n"
        f"3. Make progress on the task\n"
        f"4. Commit your changes with descriptive messages\n"
        f"5. If the task is FULLY COMPLETE, run: /ralph-stop\n"
        f"6. Otherwise, just finish your work — the loop will continue automatically\n\n"
        f"Do NOT push to remote. Accumulated commits will be reviewed after the loop ends."
    )

# Output valid JSON using json.dumps for proper escaping
output = json.dumps({"additionalContext": context})
print(output)

PYEOF
