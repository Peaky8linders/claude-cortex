# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Commands

```bash
pip install -e .                                    # Install in dev mode
python -m brainiac stats                            # Graph overview
python -m brainiac search "query"                   # Semantic search
python -m brainiac add <type> "content"             # Add node (pattern|antipattern|workflow|hypothesis|solution|decision)
python -m brainiac link <id1> <id2> <relation>      # Manual edge (semantic|temporal|causal|entity)
python -m brainiac consolidate                      # Find merge/prune candidates
python -m brainiac render                           # Regenerate markdown views
python -m brainiac migrate                          # Import from markdown files
```

## Architecture

Graph-based self-learning memory system for Claude Code, inspired by A-MEM and MAGMA research.

### Core Modules (`brainiac/`)
| Module | Purpose |
|--------|---------|
| `graph.py` | Core data model: MemoryNode, Edge, BrainiacGraph (JSON-backed CRUD) |
| `embeddings.py` | Local sentence-transformer embeddings (all-MiniLM-L6-v2, 384-dim) |
| `linker.py` | Auto-linking: semantic (cosine >= 0.7), temporal (7-day window), entity (shared tags) |
| `retriever.py` | Intent-aware multi-hop BFS retrieval with edge-type weighting |
| `consolidator.py` | Propose-only memory evolution: merge, abstract, prune candidates |
| `renderer.py` | Graph-to-markdown view generation + INDEX.md stats sync |
| `cli.py` | CLI entry point for all operations |

### Data Storage
- `graph/nodes.json` — Node data (gitignored, runtime)
- `graph/edges.json` — Edge data (gitignored, runtime)
- `graph/embeddings.npz` — Compressed numpy embeddings (gitignored, runtime)

### Edge Types
- **semantic** — Cosine similarity >= 0.7 (auto)
- **temporal** — Same project, within 7 days (auto)
- **entity** — 2+ shared projects/tags (auto)
- **causal** — Manual only, via `/learn` skill

### Claude Code Skills (`commands/`)
- `/learn` — Extract session learnings into graph nodes
- `/brainiac` — Query and manage the knowledge graph
- `/hypothesis` — Track testable claims with evidence

## Dependencies

- `sentence-transformers >= 2.2.0` — Local embedding model
- `numpy >= 1.24.0` — Vector operations

## Conventions

- All consolidation operations are propose-only — never auto-merge or auto-delete
- Node IDs use type prefixes: `pat-`, `anti-`, `wf-`, `hyp-`, `sol-`, `dec-`
- Embeddings stored separately from node JSON for efficiency
- CLI uses exit code 1 for errors, print to stdout for results
