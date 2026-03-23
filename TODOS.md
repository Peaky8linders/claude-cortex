# TODOS

## Branding
- [ ] **Rename brainiac package to cortex**
  **Priority:** P2
  **Context:** The Python graph engine is currently named `brainiac/` with CLI `python -m brainiac`. For brand consistency, rename to `cortex/` with CLI `python -m cortex`. This is a breaking change that touches: package directory, pyproject.toml/setup.py, all CLI references in CLAUDE.md and hook scripts, the `~/.claude/knowledge` internal paths, and the brainiac skill commands. Needs a migration script for existing graph data. Note: would conflict with the TypeScript `cortex/` directory — need to decide naming.
  **Depends on:** Nothing — can be done independently.
