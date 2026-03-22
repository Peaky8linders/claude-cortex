Generate actionable optimization recommendations from the Cortex knowledge graph.

Run consolidation analysis:
```bash
cd ~/.claude/knowledge && python -m brainiac consolidate
```

Then analyze the results and present recommendations sorted by priority:

1. **Merge candidates** (>0.9 similarity) — nodes that should be combined to reduce redundancy
2. **Abstraction candidates** (3+ similar nodes) — clusters that need a higher-level summary node
3. **Stale nodes** (60+ days, few connections) — knowledge that may be outdated

For each recommendation, provide:
- Priority level (critical / optimize / suggest)
- Specific action to take
- Estimated impact (token savings, clarity improvement)

Also check the current project's CLAUDE.md for any conventions that could be captured as patterns but aren't in the graph yet.
