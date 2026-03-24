---
paths:
  - "cortex/**"
---
# Cortex Rules (TypeScript — Hook Processor + MCP Dashboard)

## Style
- TypeScript strict mode — no unused variables, no implicit any
- Use interfaces for data shapes, not raw objects
- Async/await, no callbacks

## Architecture
- Hook processor receives Claude Code lifecycle events (7 event types)
- MCP server exposes dashboard tools (token_timeline, activity_map, quality_heatmap, graph_explorer)
- Context Hub integration wired into HookProcessor for chub tracking
- Async hooks for PostToolUse (must not add latency), sync for SessionStart/PostCompact

## Build & Test
- Build: `cd cortex && npm run build`
- Test: `cd cortex && npm test`
- Output: `cortex/dist/` (committed for plugin portability)

## MCP Server
- Entry: `cortex/dist/mcp/server.js`
- Env: `CORTEX_KNOWLEDGE_DIR` points to `~/.claude/knowledge`
