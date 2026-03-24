---
paths:
  - "brainiac/**"
---
# Brainiac Rules (Python — Semantic Graph Engine)

## Style
- Python 3.10+, type hints on all public functions
- No raw dicts for node/edge data — use MemoryNode/Edge dataclasses from `graph.py`
- Node IDs use type prefixes: `pat-`, `anti-`, `wf-`, `hyp-`, `sol-`, `dec-`
- Embeddings stored separately from node JSON (embeddings.npz)

## Architecture
- `graph.py` is the core — JSON-backed CRUD, never add SQLite or external deps
- `linker.py` auto-links: semantic (cosine >= 0.7), temporal (7-day), entity (shared tags)
- `retriever.py` does intent-aware multi-hop BFS with score-adaptive truncation
- `consolidator.py` is propose-only — NEVER auto-merge or auto-delete

## CLI Conventions
- Entry point: `cli.py` via `python -m brainiac`
- Exit code 1 for errors, print to stdout for results
- All commands must work from `~/.claude/knowledge/` as cwd

## Testing
- Tests live in `brainiac/tests/`
- Run: `cd brainiac && python -m pytest tests/ -v`
- Install first: `pip install -e .`
