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

If no loop file exists, report: "No active Ralph loop."

### Step 2: Read State and Compute Metrics
From `.ralph-active`, extract:
- `prompt`: The task being worked on
- `iteration`: Current iteration number
- `max_iterations`: Maximum allowed
- `scope`: Directory boundary (if any)
- `started_at`: When the loop was activated

### Step 3: Get Quality Score
```bash
cd ~/.claude/knowledge && python -m brainiac quality
```

### Step 4: Get Git Activity Since Loop Start
```bash
git log --oneline --since="STARTED_AT"
git diff --stat
```

### Step 5: Check Error Log
```bash
cat ~/.claude/knowledge/ralph-errors.log 2>/dev/null | tail -5
```

### Step 6: Display Dashboard
```
┌─────────────────────────────────────────┐
│         RALPH LOOP STATUS               │
├─────────────────────────────────────────┤
│ Task:       {prompt}                    │
│ Scope:      {scope or "entire project"} │
│ Iteration:  {iteration}/{max_iterations}│
│ Quality:    {score}/100                 │
│ Started:    {started_at}                │
│ Elapsed:    {duration}                  │
│ Commits:    {commit_count} since start  │
│ Files:      {files_changed} modified    │
├─────────────────────────────────────────┤
│ Recent commits:                         │
│   {git log --oneline last 5}            │
├─────────────────────────────────────────┤
│ Errors: {error_count} (last 5 shown)    │
│   {error log tail}                      │
└─────────────────────────────────────────┘
```

### Step 7: Health Assessment
Based on the metrics, provide a brief assessment:
- **Healthy**: Quality >= 50, no errors, steady commits
- **Warning**: Quality 30-50, or errors present, or no commits in last iteration
- **Critical**: Quality < 30 (will halt on next iteration)

Do NOT modify any files. This is read-only.
