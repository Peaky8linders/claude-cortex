# /brainiac — Query and Manage the Knowledge Graph

You interact with the Brainiac knowledge graph engine. The graph stores all cross-project learnings as interconnected nodes with semantic, temporal, causal, and entity edges.

## System Location
- Engine: `~/.claude/knowledge/brainiac/`
- Graph data: `~/.claude/knowledge/graph/` (nodes.json, edges.json, embeddings.npz)
- Views: `~/.claude/knowledge/views/` (auto-generated markdown)

## Available Operations

Parse the user's intent and run the appropriate command using Bash:

### Search the knowledge graph
```bash
python -c "import sys; sys.path.insert(0, '$HOME/.claude/knowledge'); from brainiac.cli import *; graph = BrainiacGraph(); cmd_search(graph, 'QUERY')"
```
Or: `cd ~/.claude/knowledge && python -m brainiac search "QUERY"`

### Show graph stats
`cd ~/.claude/knowledge && python -m brainiac stats`

### Add a new node
`cd ~/.claude/knowledge && python -m brainiac add <type> "<content>"`
Types: pattern, antipattern, workflow, hypothesis, solution, decision

### Link two nodes
`cd ~/.claude/knowledge && python -m brainiac link <id1> <id2> <relation>`
Relations: semantic, temporal, causal, entity

### Find consolidation opportunities
`cd ~/.claude/knowledge && python -m brainiac consolidate`

### Regenerate markdown views
`cd ~/.claude/knowledge && python -m brainiac render`

## When to Use
- Before starting work: search for relevant patterns or solutions
- During debugging: search for known solutions
- When making architecture decisions: search for prior decisions
- When reviewing: check antipatterns
- Periodically: run consolidate to keep the graph healthy
