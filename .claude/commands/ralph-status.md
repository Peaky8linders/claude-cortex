---
name: ralph-status
description: Show current Ralph Wiggum loop status without modifying it — iteration count, quality score, elapsed time, commits
user_invocable: true
---

# /ralph-status — Monitor Autonomous Loop

Show the current state of an active Ralph Wiggum loop without modifying it.

## Protocol

### Step 1: Check Loop State
```bash
cat ~/.claude/knowledge/.ralph-active 2>/dev/null
```

If no loop file exists, report: "No active Ralph loop." and stop.

If loop is active, extract from `.ralph-active`:
- `prompt`: The task being worked on
- `iteration`: Current iteration number
- `max_iterations`: Maximum allowed
- `scope`: Directory boundary (if any)
- `started_at`: When the loop was activated

### Display Dashboard
```
+------------------------------------------+
|         RALPH LOOP STATUS                |
+------------------------------------------+
| Task:       {prompt}                     |
| Scope:      {scope or "entire project"}  |
| Iteration:  {iteration}/{max_iterations} |
| Quality:    {score}/100                  |
| Started:    {started_at}                 |
| Elapsed:    {duration}                   |
| Commits:    {commit_count} since start   |
| Files:      {files_changed} modified     |
+------------------------------------------+
```

### Health Assessment
- **Healthy**: Quality >= 50, no errors, steady commits
- **Warning**: Quality 40-50, or errors present, or no commits in last iteration
- **Critical**: Quality < 40 (will halt on next iteration)

Do NOT modify any files. This is read-only.
