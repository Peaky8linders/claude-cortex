Open the Cortex knowledge graph dashboard in the browser.

The dashboard provides two interactive visualizations:

1. **Architecture Graph** — Claude Code hooks lifecycle with 16 events, 8 skills, 4 handler types
2. **Insights Graph** — Session knowledge graph with force-directed layout, timeline, and optimization recommendations

To open the dashboard:

```bash
# Open the architecture graph
start "" "D:/Claude Projects/claude-cortex/dashboard/architecture.html"
```

Or for the insights graph:
```bash
start "" "D:/Claude Projects/claude-cortex/dashboard/insights.html"
```

Both are self-contained HTML files with embedded React (via CDN) — no build step needed.

If the user asks for a specific visualization, open just that one. If they say "dashboard" without specifying, open both.
