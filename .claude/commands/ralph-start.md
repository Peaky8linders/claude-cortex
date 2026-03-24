---
name: ralph-start
description: Start an autonomous Ralph Wiggum loop — Claude works, tries to exit, Stop hook re-feeds the prompt with Cortex quality gating
user_invocable: true
---

# /ralph-start — Activate Autonomous Loop

You are activating a Ralph Wiggum autonomous loop. When Claude tries to exit, the Stop hook will re-feed the task prompt, creating a continuous work loop that persists across iterations.

## Input

The user provides:
1. **Task prompt** (required): What to work on autonomously
2. **--max-iterations N** (optional): Maximum loop iterations (default: 50)
3. **--scope DIR** (optional): Directory to freeze edits to

## Activation Protocol

### Step 1: Parse Arguments
Extract:
- `prompt`: The task description (everything that isn't a flag)
- `max_iterations`: From `--max-iterations N` or default 50
- `scope`: From `--scope DIR` or empty

### Step 2: Create Loop File
Write the loop configuration to `~/.claude/knowledge/.ralph-active`:

```bash
cat > ~/.claude/knowledge/.ralph-active << 'RALPH'
{
  "prompt": "THE_TASK_PROMPT",
  "max_iterations": 50,
  "iteration": 0,
  "scope": "DIRECTORY_OR_EMPTY",
  "started_at": "ISO_TIMESTAMP",
  "started_by": "session"
}
RALPH
```

Use python3 with `json.dumps` for safe serialization (handles quotes, backslashes, newlines):
```bash
python3 << 'PYEOF'
import json, datetime, os
data = {
    "prompt": "THE_PROMPT",
    "max_iterations": MAX_ITER,
    "iteration": 0,
    "scope": "SCOPE_OR_EMPTY",
    "started_at": datetime.datetime.now().isoformat()
}
ralph_path = os.path.join(os.environ.get("HOME", os.path.expanduser("~")), ".claude", "knowledge", ".ralph-active")
with open(ralph_path, "w") as f:
    json.dump(data, f, indent=2)
PYEOF
```

Replace `THE_PROMPT`, `MAX_ITER`, and `SCOPE_OR_EMPTY` with the actual values. Use a heredoc (`<< 'PYEOF'`) so that the prompt text is never interpolated by the shell — only parsed by Python's JSON serializer.

### Step 3: Activate Freeze (if scope provided)
If the user specified `--scope`, activate `/freeze` for that directory to prevent edits outside the boundary.

### Step 4: Search Knowledge Graph
Before starting work, search for relevant context:
```bash
cd ~/.claude/knowledge && python -m brainiac search "TASK_PROMPT"
```

### Step 5: Confirm and Begin
Output:
```
[Ralph] Loop activated.
  Task: {prompt}
  Scope: {scope or "entire project"}
  Max iterations: {max_iterations}
  Quality gate: halts at score < 30

Starting iteration 1. The loop will continue automatically when you finish each iteration.
To stop: /ralph-stop
```

### Step 6: Start Working
Begin working on the task immediately. When you're done with one iteration's worth of work, commit your changes and the session will naturally end — the Stop hook will re-feed the prompt for the next iteration.

## Safety
- Quality score < 30 = automatic halt
- Max iterations enforced (default 50)
- Git push is NEVER automated
- `/ralph-stop` can halt at any time
- Each iteration's decisions persisted to graph

## Examples
```
/ralph-start "Fix all TODO comments in brainiac/" --max-iterations 10 --scope brainiac/
/ralph-start "Refactor the analyzer module to use dataclasses" --scope contextscore/analyzers/
/ralph-start "Add comprehensive test coverage to cortex hooks" --max-iterations 20
```
