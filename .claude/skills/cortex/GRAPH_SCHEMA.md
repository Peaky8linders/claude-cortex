# Knowledge Graph Schema

## Node Types

| Type | ID Prefix | Purpose | Example |
|------|-----------|---------|---------|
| pattern | `pat-` | Reusable approach that works | "Use score-adaptive truncation for retrieval" |
| antipattern | `anti-` | Approach that fails, with evidence | "Raw dict access on graph nodes causes KeyError" |
| workflow | `wf-` | Claude Code workflow or agent config | "Parallel review agents for /review-and-ship" |
| hypothesis | `hyp-` | Testable claim, tracks evidence | "Higher embedding dims improve retrieval" |
| solution | `sol-` | Debugging solution for error class | "ImportError in brainiac: reinstall with pip -e" |
| decision | `dec-` | Architecture decision with rationale | "JSON persistence over SQLite for zero deps" |

## Edge Types

| Type | Auto/Manual | Criteria |
|------|-------------|----------|
| semantic | Auto | Cosine similarity >= 0.7 between embeddings |
| temporal | Auto | Same project, created within 7-day window |
| entity | Auto | 2+ shared projects or tags |
| causal | Manual | Created via `/learn` — "A caused B" or "A led to B" |

## Node Fields
```json
{
  "id": "pat-abc123",
  "type": "pattern",
  "content": "The actual knowledge text",
  "keywords": ["retrieval", "truncation"],
  "projects": ["claude-cortex"],
  "tags": ["performance", "graph"],
  "confidence": "high",
  "created": "2026-03-15T10:00:00Z",
  "updated": "2026-03-20T14:30:00Z"
}
```

## Edge Fields
```json
{
  "source": "pat-abc123",
  "target": "dec-def456",
  "relation": "semantic",
  "weight": 0.85,
  "created": "2026-03-15T10:00:00Z"
}
```

## Conventions
- All consolidation is propose-only — never auto-merge
- Embeddings: all-MiniLM-L6-v2 (384-dim), stored in embeddings.npz
- Graph persisted as JSON in `~/.claude/knowledge/graph/`
- Total graph size target: <200KB
