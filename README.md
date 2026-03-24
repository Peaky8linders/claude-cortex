# Claude Cortex

[![CI](https://github.com/Peaky8linders/claude-cortex/actions/workflows/ci.yml/badge.svg)](https://github.com/Peaky8linders/claude-cortex/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Plugin Version](https://img.shields.io/badge/plugin-v0.3.0-green.svg)](.claude-plugin/plugin.json)

A **Claude Code plugin** that gives Claude persistent memory, context intelligence, and session observability. Three modules working together:

| Module | Language | What it does |
|--------|----------|-------------|
| **Brainiac** | Python | Semantic knowledge graph with local embeddings, auto-linking, and intent-aware retrieval |
| **Cortex** | TypeScript | Hook processor that tracks sessions + MCP server with 4 dashboard tools |
| **ContextScore** | Python | 7-dimension context quality scoring with snapshot/recovery |

Built on research from [A-MEM](https://arxiv.org/abs/2505.10982) (NeurIPS 2025), [MAGMA](https://arxiv.org/abs/2601.07453) (2026), [SmartSearch](https://arxiv.org/abs/2603.15599) (Derehag et al. 2026), and [LCM](https://arxiv.org/abs/2602.14345) (Ehrlich 2026).

## Install as Claude Code Plugin

```bash
# From your project directory:
claude plugin add github:Peaky8linders/claude-cortex

# Or clone and install manually:
git clone https://github.com/Peaky8linders/claude-cortex.git
cd claude-cortex
pip install -e .                    # Python dependencies (brainiac + contextscore)
cd cortex && npm ci && npm run build  # TypeScript dependencies (cortex engine + MCP server)
```

After install, the plugin auto-registers:
- **7 hooks** — session tracking, context snapshots, compaction recovery
- **14 slash commands** — `/learn`, `/hypothesis`, `/cortex-status`, `/review-and-ship`, etc.
- **4 MCP tools** — token timeline, activity map, quality heatmap, graph explorer
- **1 agent** — cortex-advisor for deep graph analysis

## What You Get

### Persistent Memory Across Sessions
Claude forgets everything between sessions. Cortex doesn't. Use `/learn` at the end of a session to capture patterns, decisions, and solutions into a knowledge graph. Next session, Claude automatically searches the graph and applies what it learned.

### Session Dashboard (MCP Tools)
Query your session in real-time via 4 MCP tools:

| Tool | What it shows |
|------|--------------|
| `cortex_token_timeline` | Minute-by-minute token usage with spike detection and cost estimates |
| `cortex_activity_map` | Gantt-like timeline of which hooks, skills, and tools fired |
| `cortex_quality_heatmap` | 7-dimension radar chart of context quality (semantic relevance, redundancy, economics, etc.) |
| `cortex_graph_explorer` | Interactive force-directed graph visualization (JSON for terminal, HTML for browser) |

### Context Compaction Survival
When Claude's context window compacts, critical decisions and patterns are lost. Cortex snapshots them before compaction and re-injects them after — lossless context management.

### Autonomous Workflows
| Level | Command | What it does |
|-------|---------|-------------|
| L3 | `/run-tasks` | Execute task YAML with quality gating, each task in its own subagent |
| L4 | `/ralph-start` | Autonomous loop — Stop hook re-feeds prompt, quality-gated at score < 30 |
| L5 | `/auto-research` | Structured experiment runner with `/hypothesis` tracking and eval loops |

## Slash Commands

| Command | Purpose |
|---------|---------|
| `/learn` | Extract session learnings into graph nodes with auto-linking |
| `/hypothesis` | Track testable claims with causal edge evidence |
| `/brainiac` | Direct graph CLI: search, stats, add, consolidate |
| `/cortex-status` | Graph health: node/edge counts by type |
| `/cortex-recommend` | Actionable optimization suggestions |
| `/cortex-dashboard` | Open interactive graph visualization |
| `/cortex-graph` | Full graph dump |
| `/cortex-snapshot` | Save graph state to disk |
| `/review-and-ship` | Deep code review (3 parallel agents) + fix + test + PR |
| `/run-tasks` | Execute task list with quality gating |
| `/ralph-start` | Start autonomous loop |
| `/ralph-stop` | Stop autonomous loop |
| `/ralph-status` | Monitor active loop |
| `/auto-research` | Structured experiment runner |

## Architecture

```
claude-cortex/
├── .claude-plugin/plugin.json     Plugin manifest (auto-discovered by Claude Code)
├── mcp-config.json                MCP server registration
├── hooks/
│   ├── hooks.json                 7 hook event definitions
│   └── scripts/                   Shell handlers for each hook event
├── commands/                      14 slash command definitions (.md)
├── skills/cortex/SKILL.md         Auto-invoked cortex advisor skill
├── agents/cortex-advisor.md       Deep analysis subagent (Haiku model)
│
├── brainiac/                      Python: semantic graph engine
│   ├── graph.py                   Core data model (nodes, edges, JSON CRUD)
│   ├── embeddings.py              Local sentence-transformer (384-dim)
│   ├── linker.py                  Auto-linking (semantic, temporal, entity)
│   ├── retriever.py               Intent-aware multi-hop BFS retrieval
│   ├── consolidator.py            Propose-only: merge, abstract, prune
│   └── cli.py                     CLI entry point
│
├── cortex/                        TypeScript: hook processor + MCP server
│   ├── src/engine/                Hook processor core
│   ├── src/hooks/                 Event routing
│   ├── src/graph/                 Knowledge graph wrapper
│   ├── src/mcp/                   MCP server + 4 dashboard tools
│   └── dist/                      Pre-built output (committed for portability)
│
├── contextscore/                  Python: 7-dimension quality scoring
│   ├── src/contextscore/analyzers/  7 quality analyzers
│   ├── src/contextscore/scorer.py   Weighted aggregation
│   └── src/contextscore/snapshot/   Extract + store + recover context
│
├── dashboard/                     Self-contained HTML visualizations
└── scripts/                       tmux launcher for autonomous sessions
```

### Hook Lifecycle

```
SessionStart ──► Load graph stats, inject quality summary
     │
PostToolUse ───► Track tool events async (zero latency)
     │            ├── Write/Edit → file + subsystem tracking
     │            ├── Bash → command + test detection
     │            └── Read → compaction signal detection
     │
PreCompact ────► Snapshot decisions, entities, files to disk
PostCompact ───► Re-inject recovery pointers (lossless)
     │
Stop ──────────► Persist graph, output summary, check Ralph loop
```

## Knowledge Graph

### Node Types
| Type | Prefix | Purpose |
|------|--------|---------|
| Pattern | `pat-` | Reusable approaches that work |
| Antipattern | `anti-` | What NOT to do, with evidence |
| Workflow | `wf-` | Effective Claude Code workflows |
| Hypothesis | `hyp-` | Testable claims being validated |
| Solution | `sol-` | Proven debugging solutions |
| Decision | `dec-` | Architecture decisions with rationale |

### Edge Types
| Type | Meaning | Creation |
|------|---------|----------|
| `semantic` | Conceptually related | Auto: cosine similarity >= 0.7 |
| `temporal` | Learned in sequence | Auto: same project, 7-day window |
| `causal` | X led to discovering Y | Manual: via `/learn` |
| `entity` | Share project/domain | Auto: tag overlap >= 2 |

## Development

```bash
# TypeScript (cortex engine + MCP server)
cd cortex && npm ci && npm run build && npx vitest run

# Python (brainiac graph engine)
pip install -e . && pytest tests/ --ignore=tests/shell -v

# Python (contextscore)
cd contextscore && pip install -e . && pytest tests/ -v

# Shell tests (hooks + autonomy scripts)
bash tests/shell/run_all.sh
```

## Design Principles

- **JSON persistence, not SQLite** — zero deps, graph stays under 200KB
- **Async hooks for PostToolUse** — zero latency impact on Claude's tool loop
- **Sync hooks for context injection** — SessionStart and PostCompact must complete before Claude continues
- **Propose-only consolidation** — never auto-merge or auto-delete graph nodes
- **Pre-built dist/ committed** — plugin works without requiring `npm install`
- **No database, no Docker, no daemon** — one install is the entire setup

## License

MIT
