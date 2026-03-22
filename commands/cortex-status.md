Show the current Cortex knowledge graph status.

Run the cortex engine status command to get the current state:
```bash
cd ~/.claude/knowledge && python -m brainiac stats
```

Then present a formatted status block showing:
1. Quality score and letter grade
2. Node count by type (patterns, antipatterns, workflows, hypotheses, solutions, decisions)
3. Edge count by relation type (semantic, temporal, causal, entity)
4. Most connected nodes (top 5)
5. Any active recommendations from consolidation

If the brainiac engine is not available, check for graph data at `${CLAUDE_PLUGIN_DATA:-$HOME/.claude/cortex-data}/graph.json` and report its contents.
