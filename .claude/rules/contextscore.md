---
paths:
  - "contextscore/**/*.py"
  - "contextscore/**"
---
# ContextScore Rules (Python — 7 Analyzers + Snapshot + HTTP API)

## Style
- Python 3.10+, type hints everywhere
- Use dataclasses from `models.py` — Severity, IssueCause, CAUSE_CATALOG
- ContextScore is the single source of truth for quality scoring (not cortex)

## Architecture
- 7 analyzers: semantic relevance, redundancy, distractors, density, fragmentation, structure, economics
- `scorer.py` does weighted aggregation across all 7 dimensions
- `snapshot/extractor.py` extracts decisions, entities, files, patterns, errors
- `snapshot/store.py` persists to `.claude/context-snapshots/` as JSON
- `snapshot/recovery.py` formats recovery prompts for post-compaction injection
- `api/server.py` is FastAPI — external scoring endpoint

## Testing
- Run: `cd contextscore && pytest tests/ -v`
- Install: `cd contextscore && pip install -e .`
- 88 tests — keep coverage high
