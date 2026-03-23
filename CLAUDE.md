# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Commands

### Brainiac (Python — semantic graph engine)
```bash
pip install -e .                                    # Install in dev mode
python -m brainiac stats                            # Graph overview
python -m brainiac search "query"                   # Semantic search
python -m brainiac add <type> "content"             # Add node
python -m brainiac link <id1> <id2> <relation>      # Manual edge
python -m brainiac consolidate                      # Find merge/prune candidates
python -m brainiac render                           # Regenerate markdown views
python -m brainiac migrate                          # Import from markdown files
```

### Cortex (TypeScript — hook processor + knowledge graph + MCP dashboard)
```bash
cd cortex && npm install && npm run build           # Build cortex engine
cd cortex && npm test                               # Run tests
```

### MCP Dashboard Tools (exposed via cortex-dashboard MCP server)
The following tools are available in Claude Code sessions when the plugin is installed:
- `cortex_token_timeline` — Token consumption time-series with spike detection
- `cortex_activity_map` — Gantt-like skill/hook/tool activation timeline
- `cortex_quality_heatmap` — 7-dimension context quality radar (bridges to Python contextscore)
- `cortex_graph_explorer` — Interactive knowledge graph (JSON terminal + HTML browser modes)

### ContextScore (Python — analyzers + snapshot + HTTP API)
```bash
cd contextscore && pip install -e .                  # Install
cd contextscore && pytest tests/ -v                  # Run tests
```

## Architecture

### Cortex Ecosystem (3 products)

| Product | Language | Purpose | Tests |
|---------|----------|---------|-------|
| `brainiac/` | Python | Semantic embedding engine, graph persistence, CLI | 45 |
| `cortex/` | TypeScript | Hook processor, knowledge graph engine, MCP dashboard server, Context Hub integration | 50 |
| `contextscore/` | Python | 7 analyzers, snapshot/recovery, HTTP API | 88 |

### Plugin Structure (Claude Code integration)
```
.claude-plugin/plugin.json   — Plugin manifest
mcp-config.json              — MCP server registration (cortex-dashboard)
hooks/hooks.json             — Auto-loaded hook wiring (7 events)
hooks/scripts/               — Shell scripts → cortex-engine.js
skills/cortex/SKILL.md       — Auto-invoked cortex advisor
agents/cortex-advisor.md     — Deep analysis subagent (Haiku model)
commands/                    — Slash commands:
  /cortex-status             — Graph health: nodes, edges, types
  /cortex-recommend          — Optimization suggestions
  /cortex-snapshot           — Save graph state to disk
  /cortex-graph              — Full graph dump
  /cortex-dashboard          — Interactive visualization
  /learn                     — Capture session insights
  /hypothesis                — Track testable claims
  /brainiac                  — Direct graph CLI wrapper
  /review-and-ship           — Deep review → fix → test → PR pipeline
  /run-tasks                 — Looping subagent runner: execute task list autonomously
  /ralph-start               — Start Ralph Wiggum autonomous loop with quality gate
  /ralph-stop                — Stop Ralph loop, show session summary
  /ralph-status              — Monitor active Ralph loop (read-only dashboard)
  /auto-research             — Structured experiment runner with hypothesis tracking
```

### ContextScore Modules (`contextscore/`)
| Module | Purpose |
|--------|---------|
| `analyzers/` | 7 analyzers: semantic relevance, redundancy, distractors, density, fragmentation, structure, economics |
| `scorer.py` | Weighted aggregation across 7 quality dimensions |
| `snapshot/extractor.py` | Extract decisions, entities, files, patterns, errors from session context |
| `snapshot/store.py` | JSON persistence for snapshots in `.claude/context-snapshots/` |
| `snapshot/recovery.py` | Format recovery prompt for post-compaction injection |
| `middleware.py` | Request/response pipeline with quality gating |
| `api/server.py` | FastAPI HTTP server for external scoring |
| `models.py` | Data models: Severity, IssueCause, CAUSE_CATALOG, snapshot dataclasses |

### Brainiac Core Modules (`brainiac/`)
| Module | Purpose |
|--------|---------|
| `graph.py` | Core data model: MemoryNode, Edge, BrainiacGraph (JSON-backed CRUD) |
| `embeddings.py` | Local sentence-transformer embeddings (all-MiniLM-L6-v2, 384-dim) |
| `linker.py` | Auto-linking: semantic (cosine >= 0.7), temporal (7-day window), entity (shared tags) |
| `retriever.py` | Intent-aware multi-hop BFS retrieval + re-ranking + score-adaptive truncation |
| `consolidator.py` | Propose-only memory evolution: merge, abstract, prune candidates |
| `renderer.py` | Graph-to-markdown view generation + INDEX.md stats sync |
| `cli.py` | CLI entry point for all operations |

### Hook Wiring (7 events)
| Event | Matcher | What Cortex Does | Async |
|-------|---------|------------------|-------|
| SessionStart | startup\|resume | Load graph, inject quality score + recs | No (context injection) |
| PostToolUse | Write\|Edit\|MultiEdit | Update file/tool nodes, extract decisions, detect stale API patterns | Yes |
| PostToolUse | Bash | Track commands, detect tests/commits, Context Hub chub tracking | Yes |
| PostToolUse | Read\|Search | Track file reads, detect compaction signals | Yes |
| PreCompact | auto\|manual | Snapshot decisions, entities, files to disk | No (must complete) |
| PostCompact | * | Inject lossless pointers: decisions, patterns, hypotheses | No (context injection) |
| Stop | * | Persist graph, output summary, check Ralph loop | No (must output) |

### Edge Types
- **semantic** — Cosine similarity >= 0.7 (auto)
- **temporal** — Same project, within 7 days (auto)
- **entity** — 2+ shared projects/tags (auto)
- **causal** — Manual only, via `/learn` skill

### Research Foundations
- **A-MEM** (NeurIPS 2025) — Zettelkasten-style atomic notes + dynamic linking
- **MAGMA** (2026) — Multi-graph with intent-aware routing + typed edges
- **Talisman** — Context as credence good, context rot, 80% token reduction via graphs
- **Sequoia** — Services-as-software thesis: sell work, not tools
- **SmartSearch** (Derehag et al. 2026) — Ranking > retrieval; score-adaptive truncation; 8.5x token reduction
- **LCM** (Ehrlich 2026) — Lossless Context Management; hierarchical DAG; +4.5 over Claude Code on OOLONG

## Key Design Decisions

- **JSON persistence, not SQLite** — Zero deps, graph is <200KB
- **Python canonical for scoring** — contextscore (Python) is the single source of truth for analyzers, snapshot/recovery, and HTTP API
- **Async hooks for PostToolUse** — Must not add latency to Claude's tool loop
- **Sync hooks for SessionStart/PostCompact** — Context injection requires sync
- **Context Hub integration** — ContextHubIntegration wired into HookProcessor for chub command tracking and stale API detection
- **Subagent for deep analysis** — Isolates token cost from main context
- **No database, no Docker, no daemon** — One install must be the entire setup

## Conventions

- All consolidation operations are propose-only — never auto-merge or auto-delete
- Node IDs use type prefixes: `pat-`, `anti-`, `wf-`, `hyp-`, `sol-`, `dec-`
- Embeddings stored separately from node JSON for efficiency
- CLI uses exit code 1 for errors, print to stdout for results
- Core thesis: **coherence > capacity** — quality of context matters more than quantity

## Autonomy System

### Levels
| Level | Skill | What It Does |
|-------|-------|-------------|
| L1 | Smart permissions | `settings.json` allow/deny lists — no `--dangerously-skip-permissions` needed |
| L3 | `/run-tasks` | Reads task YAML, spawns each as subagent, commits results, quality-gated |
| L4 | `/ralph-start` | Stop hook re-feeds prompt, creating autonomous loop with Cortex quality gate |
| L5 | `/auto-research` | Structured experiment runner with `/hypothesis` tracking and eval loops |

### Safety (Moderate Risk Profile)
- **Quality gate**: Halts at Cortex quality score < 30
- **Freeze boundary**: `/freeze` scopes edits to specified directory
- **Git push blocked**: Accumulated commits reviewed manually
- **Iteration cap**: Ralph loop defaults to 50 max iterations
- **Bash guard**: Destructive commands blocked in `settings.json` deny list

### tmux Runtime
```bash
./scripts/tmux-launch.sh                              # Interactive
./scripts/tmux-launch.sh "session" tasks.yaml          # Task runner
./scripts/tmux-launch.sh "session" --ralph "PROMPT"    # Ralph loop
```

### Ralph Wiggum Loop Architecture
```
Stop hook fires → ralph-loop.sh checks:
  1. Loop file exists? (~/.claude/knowledge/.ralph-active)
  2. Quality score >= 30?
  3. Iteration < max?
  → YES to all: re-feed prompt with git diff + graph context
  → NO to any: halt, output reason, clean up
```
