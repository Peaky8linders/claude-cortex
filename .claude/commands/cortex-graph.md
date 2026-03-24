---
description: Dump the full Cortex knowledge graph topology for inspection
user_invocable: true
---

Dump the full Cortex knowledge graph for inspection.

1. Run graph stats:
   ```bash
   cd ~/.claude/knowledge && python -m brainiac stats
   ```
2. Read and display the graph nodes with their connections:
- For each node: ID, type, keywords, project, confidence, connection count
- For each edge: source -> target, relation type, weight

Use the Explore agent to read `~/.claude/knowledge/graph/nodes.json` and `~/.claude/knowledge/graph/edges.json` directly if needed for the full topology view.
