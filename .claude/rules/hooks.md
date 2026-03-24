---
paths:
  - "hooks/**"
---
# Hook Script Rules (Shell — Claude Code Lifecycle)

## Conventions
- All scripts in `hooks/scripts/` are bash
- Exit 0 on success, exit 1 on error
- Async hooks (PostToolUse) must not block — keep under 10s
- Sync hooks (SessionStart, PostCompact, Stop) can inject context via stdout JSON

## Context Injection Format
Sync hooks output JSON to inject context:
```json
{"additionalContext": "text to inject into Claude's context"}
```

## Event Wiring (hooks.json)
- SessionStart: load graph, inject quality score
- PostToolUse (Write|Edit|MultiEdit): track file edits
- PostToolUse (Bash): track commands, tests, commits
- PostToolUse (Read|Search): track reads, detect compaction signals
- PreCompact: snapshot graph state to disk
- PostCompact: inject lossless recovery pointers
- Stop: persist graph, output summary, check Ralph loop

## Safety
- Never modify user files from hooks — hooks are observers
- ralph-loop.sh is the only hook that re-feeds prompts
- quality-check.sh returns 0-100 score, falls back to 70 on error
