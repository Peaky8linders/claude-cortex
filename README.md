# Claude Brainiac

A graph-based self-learning memory system for Claude Code. Turns flat knowledge files into an interconnected knowledge graph with semantic embeddings, typed relationships, and intent-aware retrieval.

Built on research from:
- **A-MEM** (NeurIPS 2025) — Zettelkasten-style atomic notes with dynamic linking
- **MAGMA** (2026) — Multi-graph architecture with intent-aware routing
- **Graph-Based Agent Memory Survey** (2026) — Hybrid knowledge + experience graph lifecycle

## Features

- **Knowledge Graph** — Nodes with 7 A-MEM fields, 4 MAGMA edge types (semantic, temporal, causal, entity)
- **Local Embeddings** — `all-MiniLM-L6-v2` (384-dim) for zero-API-cost semantic search
- **Auto-Linking** — New nodes automatically linked via cosine similarity, temporal proximity, and shared entities
- **Intent-Aware Retrieval** — Query intent detection (what/why/when/who/how) weights graph traversal
- **Memory Evolution** — Merge similar nodes, abstract clusters, prune stale entries
- **Markdown Views** — Auto-generated human-readable views from graph state
- **Claude Code Integration** — `/learn`, `/hypothesis`, `/brainiac` skills for seamless workflow

## Installation

```bash
pip install -e .
```

Or install dependencies directly:
```bash
pip install sentence-transformers numpy
```

## Quick Start

### 1. Set up the knowledge directory

```bash
mkdir -p ~/.claude/knowledge/graph
```

### 2. Copy the engine

```bash
cp -r brainiac/ ~/.claude/knowledge/brainiac/
```

### 3. Migrate existing markdown knowledge (optional)

If you have existing knowledge files in `~/.claude/knowledge/patterns/`, etc.:

```bash
cd ~/.claude/knowledge && python -m brainiac migrate
```

### 4. Start using it

```bash
# Search the knowledge graph
cd ~/.claude/knowledge && python -m brainiac search "testing patterns"

# Add a new node
python -m brainiac add pattern "Always run full test suite before and after changes to catch regressions"

# View graph stats
python -m brainiac stats

# Find consolidation opportunities
python -m brainiac consolidate

# Regenerate markdown views
python -m brainiac render
```

## Architecture

```
~/.claude/knowledge/
├── brainiac/              # Graph engine (Python package)
│   ├── graph.py           # Core: nodes, edges, CRUD, queries
│   ├── embeddings.py      # Local sentence-transformer embeddings
│   ├── linker.py          # Auto-linking: semantic, temporal, causal, entity
│   ├── consolidator.py    # Memory evolution: merge, abstract, prune
│   ├── retriever.py       # Intent-aware multi-hop retrieval
│   ├── renderer.py        # Graph -> markdown view generation
│   └── cli.py             # CLI entry point
├── graph/                 # Graph data store
│   ├── nodes.json         # All memory nodes
│   ├── edges.json         # All relationship edges
│   └── embeddings.npz     # Compressed embedding vectors
└── views/                 # Auto-generated markdown views
```

### Node Structure (A-MEM inspired)

Each memory node has 7 core fields:

| Field | Description |
|-------|------------|
| `id` | Unique identifier (e.g., `pat-001`, `hyp-003`) |
| `content` | Core knowledge text |
| `timestamp` | ISO 8601 creation time |
| `keywords` | Auto-extracted key concepts |
| `tags` | Category tags (type, projects, domain) |
| `context` | Semantic description for linking |
| `embedding` | 384-dim vector for similarity search |

### Edge Types (MAGMA-inspired)

| Type | Meaning | Creation |
|------|---------|----------|
| `semantic` | Conceptually related | Auto: cosine similarity > 0.7 |
| `temporal` | Learned in sequence | Auto: timestamp proximity + same project |
| `causal` | X led to discovering Y | Manual: via `/learn` |
| `entity` | Share project/domain | Auto: tag overlap |

### Intent-Aware Retrieval

Queries are classified by intent, which weights edge traversal:

| Intent | Trigger Words | Prioritized Edges |
|--------|--------------|-------------------|
| `what` | default | semantic, entity |
| `why` | reason, cause, because | causal, temporal |
| `when` | timeline, before, after | temporal, causal |
| `who` | project, team, where | entity, semantic |
| `how` | approach, method, technique | semantic, causal |

## Claude Code Integration

### Skills (copy to `~/.claude/commands/`)

- **`/brainiac`** — Direct graph queries: search, stats, consolidate
- **`/learn`** — Extract session learnings into graph nodes with auto-linking
- **`/hypothesis`** — Track testable claims with causal edge evidence

### Global CLAUDE.md

Add to `~/.claude/CLAUDE.md`:

```markdown
## Brainiac Knowledge Graph

You have a persistent, cross-project knowledge graph at `~/.claude/knowledge/`.

### Quick reference
cd ~/.claude/knowledge && python -m brainiac search "query"    # semantic search
cd ~/.claude/knowledge && python -m brainiac stats              # graph overview
cd ~/.claude/knowledge && python -m brainiac consolidate        # find merge/prune candidates
cd ~/.claude/knowledge && python -m brainiac add <type> "text"  # add node
```

## How It Works

```
Session Start -> Search graph for relevant patterns
     |
Session Work -> Track patterns, errors, solutions
     |
Session End -> /learn proposes entries -> User approves -> Graph nodes created
     |                                                         |
     |                                          Auto-link (semantic + temporal + entity)
     |                                                         |
Next Session -> Richer graph -> Better search results -> Better decisions
```

## Node Types

| Type | Prefix | Purpose |
|------|--------|---------|
| `pattern` | `pat-` | Reusable approaches that work |
| `antipattern` | `anti-` | What NOT to do, with evidence |
| `workflow` | `wf-` | Effective Claude Code workflows |
| `hypothesis` | `hyp-` | Testable claims being validated |
| `solution` | `sol-` | Proven debugging solutions |
| `decision` | `dec-` | Architecture decisions with rationale |

## License

MIT
