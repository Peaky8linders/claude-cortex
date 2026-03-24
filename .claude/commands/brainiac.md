---
description: Direct interface to the Brainiac knowledge graph CLI
user_invocable: true
---

# /brainiac — Query and Manage the Knowledge Graph

You interact with the Brainiac knowledge graph engine. The graph stores all cross-project learnings as interconnected nodes with semantic, temporal, causal, and entity edges.

## System Location
- Engine: `~/.claude/knowledge/brainiac/`
- Graph data: `~/.claude/knowledge/graph/` (nodes.json, edges.json, embeddings.npz)
- Views: `~/.claude/knowledge/views/` (auto-generated markdown)

## Command

Parse the user's message after `/brainiac` and run the appropriate command.

**Important**: Only accept these known subcommands: `search`, `stats`, `add`, `link`, `consolidate`, `render`, `quality`. Reject any other input to prevent command injection.

```bash
cd ~/.claude/knowledge && python -m brainiac <subcommand> [args]
```

## Available Operations

If no arguments provided, show this help:

- `search "QUERY"` — Semantic search across all nodes
- `stats` — Graph overview (node counts, edge counts, quality)
- `add <type> "content"` — Add node (types: pattern, antipattern, workflow, hypothesis, solution, decision)
- `link <id1> <id2> <relation>` — Link nodes (relations: semantic, temporal, causal, entity)
- `consolidate` — Find merge/prune candidates
- `render` — Regenerate markdown views
- `quality` — Get quality score (0-100)

## When to Use
- Before starting work: search for relevant patterns or solutions
- During debugging: search for known solutions
- When making architecture decisions: search for prior decisions
- When reviewing: check antipatterns
- Periodically: run consolidate to keep the graph healthy
