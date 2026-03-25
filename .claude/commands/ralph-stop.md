---
name: ralph-stop
description: Stop the autonomous Ralph Wiggum loop and show session summary
user_invocable: true
---

# /ralph-stop — Halt Autonomous Loop

You are stopping a Ralph Wiggum autonomous loop.

## Protocol

### Step 1: Check Loop State
Read the loop file:
```bash
cat ~/.claude/knowledge/.ralph-active 2>/dev/null
```

If no loop file exists, report: "No active Ralph loop found."

### Step 2: Read Loop Stats
Extract iteration count, start time, and task from the loop file.

### Step 3: Remove Loop File and Cached State
```bash
rm -f ~/.claude/knowledge/.ralph-active
rm -f ~/.claude/knowledge/.ralph-search-cache
```

If the loop was started with `--scope`, deactivate the freeze:
```
/unfreeze
```

### Step 4: Generate Summary
Show:
```
[Ralph] Loop stopped after {iteration} iterations.
  Task: {prompt}
  Started: {started_at}
  Duration: {calculated_duration}

Commits made during loop:
{git log --oneline from start time}

Recommend:
- Review accumulated commits: git log --oneline
- Push when ready: git push
- Capture learnings: /learn
```

### Step 5: Show Git Summary
```bash
git log --oneline --since="STARTED_AT"
git diff --stat HEAD~{iteration_count} 2>/dev/null || git diff --stat
```

### Step 6: Suggest Next Steps
- `/learn` if 3+ iterations completed (substantial work)
- Review and push commits
- Run full test suite to verify everything still passes
