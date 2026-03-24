# Contributing to Claude Cortex

## Prerequisites

- Node.js 20+ (see `.nvmrc`)
- Python 3.12+ (see `.python-version`)
- Git

## Setup

```bash
git clone https://github.com/Peaky8linders/claude-cortex.git
cd claude-cortex

# Python packages
pip install -e .
cd contextscore && pip install -e . && cd ..

# TypeScript package
cd cortex && npm ci && cd ..
```

## Running Tests

```bash
# All TypeScript tests (90 tests)
cd cortex && npx vitest run

# All Python tests — brainiac (45+ tests)
pytest tests/ --ignore=tests/shell -v

# All Python tests — contextscore (88 tests)
cd contextscore && pytest tests/ -v

# Shell tests (hooks + autonomy)
bash tests/shell/run_all.sh
```

## Building

```bash
# TypeScript (required after src/ changes)
cd cortex && npm run build

# The dist/ directory is committed for plugin portability.
# Always rebuild and commit dist/ when changing TypeScript source.
```

## Project Structure

| Directory | Language | What to edit |
|-----------|----------|-------------|
| `brainiac/` | Python | Graph engine, embeddings, retrieval, CLI |
| `contextscore/src/contextscore/` | Python | Quality analyzers, snapshot/recovery, API |
| `cortex/src/` | TypeScript | Hook processor, MCP server, dashboard tools |
| `hooks/scripts/` | Bash | Hook event handlers |
| `commands/` | Markdown | Slash command definitions |
| `skills/` | Markdown | Auto-invoked skill definitions |

## Conventions

- Node IDs use type prefixes: `pat-`, `anti-`, `wf-`, `hyp-`, `sol-`, `dec-`
- All consolidation operations are propose-only (never auto-merge/delete)
- PostToolUse hooks must be async (zero latency on Claude's tool loop)
- SessionStart/PostCompact hooks must be sync (context injection)
- Run all tests before submitting a PR

## Commit Style

```
feat: add new MCP tool for X
fix: resolve race condition in Y
chore: update dependencies
test: add coverage for Z
docs: update README with new commands
```
