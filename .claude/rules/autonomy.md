# Autonomy & Safety Rules

These rules apply unconditionally to all autonomy features.

## Quality Gate
- Score < 30 = automatic halt (applies to Ralph loop, run-tasks, auto-research)
- Score from `python -m brainiac quality` or fallback to 70

## Ralph Wiggum Loop
- State file: `~/.claude/knowledge/.ralph-active`
- Max iterations default: 50
- Stop hook checks: loop file exists, quality >= 30, iteration < max
- Git push is NEVER automated — accumulated commits reviewed manually

## Run-Tasks
- Max 20 tasks per run
- Each subagent runs in isolated context
- Failed tasks are skipped, not retried
- `/freeze` scopes edits if task has a `scope` field

## Auto-Research
- Each variation runs on its own git branch (`experiment/{name}`)
- Pre-experiment state stashed and restored
- Max 10 variations per experiment
- Results persisted in graph even if interrupted

## General Safety
- All consolidation is propose-only — never auto-merge or auto-delete
- Destructive bash commands blocked in settings.json deny list
- Git push blocked — user reviews and pushes manually
