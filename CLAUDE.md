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

### Cortex (TypeScript — hook processor + knowledge graph)
```bash
cd cortex && npm install && npm run build           # Build cortex engine
cd cortex && npm test                               # Run 48 tests
```

### OpenBrain (TypeScript — L1→L4 pipeline + MCP)
```bash
cd openbrain && npm install && npm run build         # Build openbrain
cd openbrain && npm test                             # Run 27 tests
```

### ContextScore Claude Code (TypeScript — analyzers + snapshot)
```bash
cd contextscore-cc && npm install && npm run build   # Build contextscore
cd contextscore-cc && npm test                       # Run 41 tests
```

### ContextScore Python (Original MVP)
```bash
cd contextscore && pip install -e .                  # Install
cd contextscore && pytest tests/ -v                  # Run 71 tests
```

## Architecture

### Cortex Ecosystem (4 products, 187 tests)

| Product | Language | Purpose | Tests |
|---------|----------|---------|-------|
| `brainiac/` | Python | Semantic embedding engine, graph persistence, CLI | via brainiac CLI |
| `cortex/` | TypeScript | Hook processor, knowledge graph engine, Context Hub integration | 48 |
| `openbrain/` | TypeScript | L1→L4 pipeline, MCP server (8 tools), CLI (6 commands) | 27 |
| `contextscore-cc/` | TypeScript | 7 analyzers for context quality scoring, snapshot/recovery | 41 |
| `contextscore/` | Python | Original ContextScore MVP with HTTP API + React dashboard | 71 |

### Plugin Structure (Claude Code integration)
```
.claude-plugin/plugin.json   — Plugin manifest
hooks/hooks.json             — Auto-loaded hook wiring (7 events)
hooks/scripts/               — Shell scripts → cortex-engine.js
skills/cortex/SKILL.md       — Auto-invoked cortex advisor
agents/cortex-advisor.md     — Deep analysis subagent (Haiku model)
commands/                    — Slash commands (/cortex-status, /cortex-recommend, etc.)
```

### Brainiac Core Modules (`brainiac/`)
| Module | Purpose |
|--------|---------|
| `graph.py` | Core data model: MemoryNode, Edge, BrainiacGraph (JSON-backed CRUD) |
| `embeddings.py` | Local sentence-transformer embeddings (all-MiniLM-L6-v2, 384-dim) |
| `linker.py` | Auto-linking: semantic (cosine >= 0.7), temporal (7-day window), entity (shared tags) |
| `retriever.py` | Intent-aware multi-hop BFS retrieval with edge-type weighting |
| `consolidator.py` | Propose-only memory evolution: merge, abstract, prune candidates |
| `renderer.py` | Graph-to-markdown view generation + INDEX.md stats sync |
| `cli.py` | CLI entry point for all operations |

### Hook Wiring (7 events)
| Event | Matcher | What Cortex Does | Async |
|-------|---------|------------------|-------|
| SessionStart | startup\|resume | Load graph, inject quality score + recs | No (context injection) |
| PostToolUse | Write\|Edit\|MultiEdit | Update file/tool nodes, extract decisions | Yes |
| PostToolUse | Bash | Track commands, detect tests/commits | Yes |
| PostToolUse | Read\|Search | Track file reads, detect compaction signals | Yes |
| PreCompact | auto\|manual | Snapshot decisions, entities, files to disk | No (must complete) |
| PostCompact | * | Inject recovery: decisions, active files, errors | No (context injection) |
| Stop | * | Persist graph, output 1-line summary | No (must output) |

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

## Key Design Decisions

- **JSON persistence, not SQLite** — Zero deps, graph is <200KB
- **Async hooks for PostToolUse** — Must not add latency to Claude's tool loop
- **Sync hooks for SessionStart/PostCompact** — Context injection requires sync
- **Subagent for deep analysis** — Isolates token cost from main context
- **No database, no Docker, no daemon** — One install must be the entire setup

## Conventions

- All consolidation operations are propose-only — never auto-merge or auto-delete
- Node IDs use type prefixes: `pat-`, `anti-`, `wf-`, `hyp-`, `sol-`, `dec-`
- Embeddings stored separately from node JSON for efficiency
- CLI uses exit code 1 for errors, print to stdout for results
- Core thesis: **coherence > capacity** — quality of context matters more than quantity
