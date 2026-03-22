# Cortex — Your Claude Code Nervous System

Live knowledge graph, context intelligence, and optimization engine.
Plugs directly into Claude Code via hooks. Zero infra.

## Quick Test (2 minutes)

```bash
# 1. Install and build
npm install && npx tsc

# 2. Run all 48 tests
npx vitest run

# 3. Ingest the sample session
node dist/cli.js ingest .cortex/events/session.jsonl

# 4. See the status dashboard
node dist/cli.js status

# 5. Get recommendations
node dist/cli.js recommend

# 6. Export graph JSON
node dist/cli.js graph --json > graph-export.json

# 7. Save a snapshot
node dist/cli.js snapshot
```

## Install into Claude Code

```bash
node dist/cli.js install-hooks
```

Adds async hooks to 7 lifecycle events. Zero latency impact.

## Commands

| Command | What it does |
|---------|-------------|
| `cortex status` | Live metrics + quality score |
| `cortex recommend` | Actionable optimizations |
| `cortex graph --json` | Export full knowledge graph |
| `cortex snapshot` | Save context before compaction |
| `cortex ingest <file>` | Analyze a session log |
| `cortex install-hooks` | Wire into Claude Code |

## Context Hub Integration

Detects stale APIs, tracks chub doc usage, auto-generates annotations.

## React Dashboard

`cortex_insights_graph.jsx` — standalone artifact with Graph, Timeline, and Insights views.

## 48 Tests Passing

```
✓ cortex.test.ts  (30 tests) — graph, metrics, hooks, simulation
✓ chub.test.ts    (18 tests) — hallucination detection, annotations
```

MIT License
