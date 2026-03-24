# Autonomy & Safety Rules

These rules apply unconditionally to all autonomy features.

## Generator-Evaluator Pattern

Inspired by Anthropic's harness design research: separating work production from
assessment is more effective than self-evaluation. The generator writes code, the
evaluator independently grades it.

- **work-evaluator agent** grades actual output across 5 dimensions (correctness,
  architecture, completeness, safety, craft)
- Evaluator runs in isolated context — never sees generator's reasoning
- Sprint contracts align generator and evaluator before coding begins
- One retry allowed on NEEDS_WORK (40-59); FAIL (<40) skips the task

## Dual Quality Gate

Two independent signals combined into one composite score:
- **Graph health** (30%): `python -m brainiac quality` — node connectivity, orphans, edge density
- **Work quality** (70%): `work-eval-check.sh` — test results, diff heuristics, secret detection
- **Composite threshold**: < 40 = automatic halt (raised from 30 to account for real signal)
- Fallback: both scores default to 70 if their check fails

## Context Strategies

Two strategies available for Ralph loop, selected via `--reset-strategy`:
- **compact** (default): Carry forward context, rely on compaction + lossless recovery pointers
- **reset**: Full context reset each iteration with structured handoff artifact. Better for
  long-running tasks (10+ iterations) where context anxiety degrades output quality.

## Ralph Wiggum Loop
- State file: `~/.claude/knowledge/.ralph-active`
- Max iterations default: 50
- Stop hook checks: loop file exists, dual quality gate >= 40, iteration < max
- Git push is NEVER automated — accumulated commits reviewed manually

## Run-Tasks
- Max 20 tasks per run
- Each task uses generator-evaluator pattern with sprint contracts
- Generator and evaluator run in separate isolated contexts
- One retry on NEEDS_WORK, then skip on second failure
- `/freeze` scopes edits if task has a `scope` field

## Auto-Research
- Each variation runs on its own git branch (`experiment/{name}`)
- Pre-experiment state stashed and restored
- Max 10 variations per experiment
- Results persisted in graph even if interrupted

## General Safety
- All consolidation is propose-only — never auto-merge or auto-delete
- Destructive bash commands blocked in settings.json deny list
- Git push blocked — user reviews and pushes manually
