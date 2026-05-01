---
paths:
  - "hooks/**"
  - ".claude/settings*.json"
---
# Session Config Rules (Claude Code env vars + settings.json)

Cortex's thesis is **coherence > capacity**. The Claude Code harness exposes env
vars that directly affect coherence — set wrong, they cause autocompact loops
that destroy cache and waste tokens.

## Antipattern: autocompact thrashing

Symptom (shown in chat by the harness):
> Autocompact is thrashing: the context refilled to the limit within 3 turns
> of the previous compact, 3 times in a row.

Root cause — these two env vars set together in `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_DISABLE_1M_CONTEXT": "1",
    "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE": "80"
  }
}
```

- `CLAUDE_CODE_DISABLE_1M_CONTEXT=1` — forces the 200K window instead of 1M
- `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=80` — triggers compaction at 80% (~160K)

A single large tool result (file read, MCP query, agent output) can refill past
160K within a turn. The compactor fires, the next turn does the same, the loop
trips the harness's 3-in-a-row safety and the user is told to `/clear`.

## Safe baselines

- Leave both env vars **unset** unless you have a specific reason
- The default compact threshold (~95) with the 1M window gives ~950K of working
  room before compaction
- If you must set `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`, keep it ≥ 90 and pair it
  with the 1M window (don't set `CLAUDE_CODE_DISABLE_1M_CONTEXT`)

## Detection

`hooks/scripts/on-session-start.sh` checks for this combination at SessionStart
and surfaces a warning via `additionalContext` so users see the diagnosis the
moment a session opens with the antipattern still in place.
