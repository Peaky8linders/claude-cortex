Save a snapshot of the current knowledge graph state.

1. Run brainiac stats to capture current metrics
2. Run brainiac render to regenerate all markdown views
3. Create a timestamped snapshot:
   ```bash
   TIMESTAMP=$(date +%Y%m%d_%H%M%S)
   mkdir -p ~/.claude/knowledge/snapshots
   cp ~/.claude/knowledge/graph/nodes.json ~/.claude/knowledge/snapshots/nodes_${TIMESTAMP}.json
   cp ~/.claude/knowledge/graph/edges.json ~/.claude/knowledge/snapshots/edges_${TIMESTAMP}.json
   ```
4. Keep only the last 10 snapshots (delete older ones)
5. Report the snapshot path and stats (node count, edge count, timestamp)
