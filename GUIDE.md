# Cortex — Quick Start Guide

Cortex is a knowledge graph that makes Claude Code smarter across sessions. It remembers patterns, tracks decisions, and warns you about known pitfalls — automatically.

## How It Works

```
Your work ──→ Hooks capture events ──→ Graph builds silently
                                            │
                 ┌──────────────────────────┘
                 ▼
        /cortex-status  ──→  See what the graph knows
        /cortex-recommend ──→  Get optimization suggestions
        /learn            ──→  Capture insights from this session
        /cortex-dashboard ──→  Visualize the graph interactively
```

## Daily Workflow

### 1. Start working — Cortex loads automatically
When you start a Claude Code session, the SessionStart hook loads graph stats into context. You'll see something like:

```
[Cortex] Graph loaded: 18 nodes, 28 edges. Use /cortex-status for details.
```

Claude silently checks for relevant patterns and antipatterns for your task.

### 2. Work normally — hooks track events silently
Every file edit, bash command, and read is journaled. This costs you nothing — all PostToolUse hooks are async with zero latency impact.

### 3. Check your graph health anytime

**`/cortex-status`** — Quick overview:
- Node count by type (patterns, antipatterns, decisions, etc.)
- Edge count by relation (semantic, temporal, causal, entity)
- Most connected nodes

**`/cortex-recommend`** — Actionable improvements:
- Merge candidates (nodes with >90% similarity)
- Abstraction candidates (3+ related nodes needing a summary)
- Stale nodes (60+ days old with few connections)

**`/cortex-graph`** — Full dump for deep inspection.

### 4. Capture what you learned

At the end of a substantial session (5+ files changed, bugs fixed, new patterns discovered), run:

**`/learn`** — Extracts reusable insights and saves them as graph nodes with auto-linking.

Types of knowledge you can capture:
| Type | Prefix | Example |
|------|--------|---------|
| Pattern | `pat-` | "Single source of truth for domain data" |
| Antipattern | `anti-` | "Never mock compliance logic in tests" |
| Workflow | `wf-` | "Test before AND after making changes" |
| Decision | `dec-` | "Module isolation over shared state" |
| Solution | `sol-` | "SQLite FK enforcement requires PRAGMA" |
| Hypothesis | `hyp-` | "Splitting App.jsx will reduce bug rate" |

### 5. Survive compaction

When Claude's context gets compacted, Cortex injects a recovery block:
- Active decisions (with "DO NOT reverse" warning)
- Current file list
- Unresolved errors

This is the **killer feature** — it solves the #1 Claude Code pain point: "Claude gets dumber after compaction."

## Data Visualization

### Architecture Dashboard
Open with `/cortex-dashboard` or directly:
```bash
start "" "D:/Claude Projects/claude-cortex/dashboard/architecture.html"
```

Shows the complete Claude Code hook lifecycle:
- **16 hook events** with connections showing data flow
- **Click any node** to see: description, handler types, matcher values, example use
- **Phase grouping**: Session, Conversation Loop, Tool Execution, Multi-Agent, Maintenance
- **Dashed borders** indicate hooks that can block (PreToolUse, PermissionRequest, Stop)

### Insights Dashboard
```bash
start "" "D:/Claude Projects/claude-cortex/dashboard/insights.html"
```

Three views:
- **Graph** — Force-directed layout of all knowledge nodes. Filter by type (product, decision, research, bug fix, concept, tool, person, metric). Click nodes to see connections.
- **Timeline** — Phase-by-phase build history showing how the system evolved.
- **Insights** — Eng review outcomes and optimization recommendations.

## Commands Reference

| Command | What it does |
|---------|-------------|
| `/cortex-status` | Graph health: nodes, edges, types, connections |
| `/cortex-recommend` | Optimization suggestions: merge, abstract, prune |
| `/cortex-snapshot` | Save graph state to disk (keeps last 10) |
| `/cortex-graph` | Full graph dump for inspection |
| `/cortex-dashboard` | Open interactive visualization in browser |
| `/learn` | Capture session insights as graph nodes |
| `/hypothesis` | Track testable claims with evidence |

## CLI Reference (for manual graph operations)

```bash
cd ~/.claude/knowledge

# Search the graph semantically
python -m brainiac search "how to handle OCR failures"

# View graph stats
python -m brainiac stats

# Add a new pattern
python -m brainiac add pattern "Always validate CF documents before creating listings"

# Add a manual causal edge
python -m brainiac link pat-001 anti-001 causal

# Find optimization candidates
python -m brainiac consolidate

# Regenerate markdown views
python -m brainiac render
```

## Tips

1. **Don't over-capture** — 1-2 high-quality learnings per session beats 10 vague ones
2. **Use hypotheses** — Track claims you want to test ("will X improve Y?") and validate with evidence
3. **Run consolidate weekly** — Merge duplicate nodes, prune stale ones, keep the graph lean
4. **Check antipatterns before architecture decisions** — The graph remembers past mistakes so you don't repeat them
5. **Let compaction guard work** — Don't fight compaction, let Cortex recover your critical context automatically
