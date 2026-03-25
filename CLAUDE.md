# CLAUDE.md

## Commands

```bash
# Brainiac (Python — semantic graph engine)
pip install -e .                                    # Install in dev mode
cd ~/.claude/knowledge && python -m brainiac stats  # Graph overview
cd ~/.claude/knowledge && python -m brainiac search "query"

# Cortex (TypeScript — hook processor + MCP dashboard)
cd cortex && npm install && npm run build
cd cortex && npm test

# ContextScore (Python — analyzers + snapshot + HTTP API)
cd contextscore && pip install -e .
cd contextscore && pytest tests/ -v
```

## Architecture

| Product | Language | Purpose |
|---------|----------|---------|
| `brainiac/` | Python | Semantic embedding engine, graph persistence, CLI |
| `cortex/` | TypeScript | Hook processor, knowledge graph engine, MCP dashboard server |
| `contextscore/` | Python | 7 analyzers, snapshot/recovery, HTTP API |

## Plugin Structure

```
.claude-plugin/plugin.json       — Plugin manifest
.claude/settings.json            — Team permissions (committed)
.claude/rules/                   — Path-scoped instruction modules
.claude/commands/                — 14 slash commands
.claude/skills/cortex/           — Auto-invoked cortex advisor + support docs
.claude/agents/                  — cortex-advisor, graph-maintainer (haiku), work-evaluator (sonnet)
mcp-config.json                  — MCP server registration (cortex-dashboard)
hooks/hooks.json                 — Hook wiring (7 events)
hooks/scripts/                   — Shell hook handlers
```

## MCP Dashboard Tools
- `cortex_token_timeline` — Token consumption time-series with spike detection
- `cortex_activity_map` — Gantt-like skill/hook/tool activation timeline
- `cortex_quality_heatmap` — 7-dimension context quality radar
- `cortex_graph_explorer` — Interactive knowledge graph
- `cortex_dashboard` — Unified session dashboard with KPIs, charts, cost breakdown, and cross-session trends

## Key Design Decisions

- **JSON persistence, not SQLite** — zero deps, graph <200KB
- **No database, no Docker, no daemon** — one install = entire setup
- Core thesis: **coherence > capacity** — quality of context > quantity of tokens
- Detailed rules in `.claude/rules/` (path-scoped per product)
- Hook wiring, conventions, and safety rules documented in `.claude/rules/`

## Autonomy System

| Level | Tool | What It Does |
|-------|------|-------------|
| L1 | `.claude/settings.json` | Allow/deny lists for permissions |
| L3 | `/run-tasks` | Subagent task runner, quality-gated |
| L4 | `/ralph-start` | Autonomous loop via Stop hook re-feed |
| L5 | `/auto-research` | Experiment runner with hypothesis tracking |

### Generator-Evaluator Pattern
- work-evaluator agent independently grades output (5 dimensions, 0-100)
- Sprint contracts align generator + evaluator before coding begins
- One retry on NEEDS_WORK (40-59), skip on FAIL (<40)

### Safety
- Dual quality gate: 30% graph health + 70% work quality, halts at composite < 40
- `/freeze` scopes edits to specified directory
- Git push blocked — user reviews and pushes manually
- Ralph loop defaults to 50 max iterations, supports `--reset-strategy reset`
- Destructive commands blocked in settings.json deny list

## Deploy Configuration (configured by /setup-deploy)
- Platform: GitHub Releases (Claude Code plugin — distributed via git)
- Production URL: https://github.com/Peaky8linders/claude-cortex
- Deploy workflow: `.github/workflows/release.yml` (triggers on `v*` tags)
- Deploy status command: `gh release view`
- Merge method: merge
- Project type: Claude Code plugin

### Release process
1. Bump version in `.claude-plugin/plugin.json`
2. Commit and push to main
3. Tag: `git tag v{VERSION} && git push origin v{VERSION}`
4. CI runs tests, then `release.yml` auto-creates a GitHub Release
5. Users update: `claude plugin update cortex`

### Custom deploy hooks
- Pre-merge: tests must pass (CI)
- Deploy trigger: `git tag v{VERSION} && git push origin v{VERSION}`
- Deploy status: `gh release view v{VERSION}`
- Health check: `gh release view --json tagName -q .tagName`

## Research Foundations

- **A-MEM** — Zettelkasten-style atomic notes + dynamic linking
- **MAGMA** — Multi-graph with intent-aware routing + typed edges
- **SmartSearch** — Score-adaptive truncation; 8.5x token reduction
- **LCM** — Lossless Context Management; hierarchical DAG
- **Anthropic Harness Design** — Generator-evaluator separation; context resets; sprint contracts
