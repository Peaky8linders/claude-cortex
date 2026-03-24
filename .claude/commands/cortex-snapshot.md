---
description: Save a timestamped snapshot of the current knowledge graph state
user_invocable: true
---

Save a snapshot of the current knowledge graph state.

1. Run brainiac stats to capture current metrics:
   ```bash
   cd ~/.claude/knowledge && python -m brainiac stats
   ```
2. Run brainiac render to regenerate all markdown views:
   ```bash
   cd ~/.claude/knowledge && python -m brainiac render
   ```
3. Create a timestamped snapshot:
   ```bash
   TIMESTAMP=$(date +%Y%m%d_%H%M%S)
   mkdir -p ~/.claude/knowledge/snapshots
   cp ~/.claude/knowledge/graph/nodes.json ~/.claude/knowledge/snapshots/nodes_${TIMESTAMP}.json
   cp ~/.claude/knowledge/graph/edges.json ~/.claude/knowledge/snapshots/edges_${TIMESTAMP}.json
   ```
3. Keep only the last 10 snapshots (delete older ones)
4. Report the snapshot path and stats (node count, edge count, timestamp)
