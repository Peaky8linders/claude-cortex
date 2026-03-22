Dump the full Cortex knowledge graph for inspection.

1. Load the graph data:
   ```bash
   cd ~/.claude/knowledge && python -m brainiac stats
   ```
2. Read and display the graph nodes with their connections:
   - For each node: ID, type, keywords, project, confidence, connection count
   - For each edge: source → target, relation type, weight
3. Present as a structured overview showing the full knowledge topology

Use the Explore agent to read `~/.claude/knowledge/graph/nodes.json` and `~/.claude/knowledge/graph/edges.json` directly if the brainiac CLI is not available.
