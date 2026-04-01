---
description: Generate session cost report with cache efficiency analysis
user_invocable: true
---

Generate a cost efficiency report for the current session.

Use the `cortex_token_timeline` MCP tool with the current session, then analyze and present:

1. **Session Cost Summary** — total tokens, total estimated cost, breakdown by model
2. **Cache Efficiency** — session type (startup/resume), first-turn vs average token ratio, cache miss detection, estimated savings from caching
3. **Cost Recommendations** — actionable suggestions based on cache behavior:
   - Whether resume sessions are costing extra due to cache misses
   - Optimal session length based on historical data
   - Sentinel risk if discussing Claude Code internals
4. **Historical Trend** — last 5 sessions: cost, tokens, cache efficiency, session type
5. **Optimization Tips** — based on observed patterns:
   - Batch small tasks into fewer sessions for better cache utilization
   - Start fresh (not resume) for small quick tasks
   - Use `npx @anthropic-ai/claude-code` if sentinel risk detected

Format as a clear table with a summary section and actionable next steps.
