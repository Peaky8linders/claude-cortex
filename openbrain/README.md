# OpenBrain

**Context intelligence autopilot — from raw thought to agent-ready spec.**

Breaks memory silos across AI tools. One brain, every agent.

---

## The Problem

Your AI tools don't share memory. Claude forgets. ChatGPT forgets. Cursor doesn't know what you discussed in Slack. Every session starts from zero. You spend more time transferring context than doing actual work.

## The Autopilot Solution

OpenBrain doesn't sell you a tool. It **does the work**.

Paste a meeting note. Get back: structured context, strategic intent, and a phased specification with agent instructions, quality gates, and a rollback plan. The full AI Skill Hierarchy — automated.

```
L1: "Met Sarah from Acme. JWT auth migration. 50K users. Q3 deadline."
    ↓ extractContextGraph()
L2: 12 entities · 4 decisions · 6 constraints · 1 open question
    ↓ deriveIntent()
L3: Goal + constraints + tradeoffs + stakeholders + timeline
    ↓ generateSpecification()
L4: 3 phases · 14 tasks · agent instructions · quality gates
```

## Quick Start

```bash
npm install -g openbrain

# Full pipeline: thought → spec
echo "your meeting notes..." | openbrain pipeline -

# Or step by step
openbrain think "Met Sarah from Acme. JWT migration."
openbrain context "Acme auth"
openbrain intent "Acme auth"
openbrain spec "Acme JWT migration"
```

## MCP Integration (Break the Silos)

OpenBrain exposes 8 MCP tools so **any AI** can read/write to your brain:

| Tool | What it does |
|---|---|
| `save_thought` | Capture thoughts with auto-extraction |
| `search_brain` | Semantic search across all thoughts |
| `get_context` | Structured context graph (L2) |
| `get_intent` | Strategic intent derivation (L3) |
| `get_spec` | Agent-ready specification (L4) |
| `run_pipeline` | Full L1→L4 transformation |
| `list_decisions` | All captured decisions |
| `list_entities` | All known entities |

Add to Claude Code's `.claude/settings.json`:
```json
{
  "mcpServers": {
    "openbrain": {
      "command": "node",
      "args": ["path/to/openbrain/dist/mcp/server.js"]
    }
  }
}
```

## Sequoia Autopilot Positioning

Per Sequoia's "Services: The New Software" thesis:

| | Copilot (old) | Autopilot (OpenBrain) |
|---|---|---|
| **Sells** | Context scoring tool | Agent-ready specifications |
| **Customer** | The engineer | The team/founder |
| **Budget** | Software ($29/mo) | Services ($5K-50K/engagement) |
| **Model improvement** | Threat | Advantage (faster, cheaper specs) |
| **Outcome** | "Your context has issues" | "Here's your execution plan" |

## Dev

```bash
npm install
npx tsc          # compile
npx vitest run   # 27 tests
node dist/cli.js pipeline -  # test with stdin
```

## License

MIT
