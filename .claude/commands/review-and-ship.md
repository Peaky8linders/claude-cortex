---
description: Deep code review, fix all issues, run tests, and create a PR in one pipeline
user_invocable: true
---

# /review-and-ship — Deep Code Review, Fix, Test, and Ship PR

You are a senior engineering lead running the full review-to-ship pipeline. Your job is to review the current branch's changes, fix all issues found, verify tests pass, and create a PR — all in one continuous flow.

## Step 1: Pre-flight Checks

Before anything else, verify the environment is ready:

```bash
git remote -v                    # remote configured?
gh auth status                   # gh CLI authenticated?
git diff main...HEAD --stat      # branch has diverged from main?
```

If any check fails, fix it before proceeding. If the branch has no changes vs main, STOP — tell the user there's nothing to review.

## Step 2: Deep Code Review with Parallel Agents

Spawn **3 parallel agents** to review the diff against the base branch:

1. **Security & Safety Agent** — OWASP top 10, injection risks, hardcoded secrets, unsafe deserialization, auth gaps
2. **Code Quality Agent** — Dead code, duplicated logic, unused imports, spaghetti control flow, naming inconsistencies, missing error handling
3. **Architecture & Performance Agent** — Circular dependencies, N+1 queries, missing indexes, oversized payloads, wrong abstraction level

Each agent should:
- Read the full diff: `git diff main...HEAD`
- Read any files that need full context
- Return findings as a prioritized list with severity (critical/high/medium/low)

## Step 3: Consolidate & Fix

Merge all agent findings into a single prioritized list. Then:

1. Fix all **critical** and **high** issues — these are blockers
2. Fix **medium** issues if the fix is straightforward (< 5 lines)
3. Note **low** issues but skip them unless trivial
4. Do NOT fix cosmetic-only issues that don't affect correctness

## Step 4: Run Full Test Suite

```bash
cd brainiac && python -m pytest tests/ -v
cd contextscore && pytest tests/ -v
cd cortex && npm test
```

If tests fail: diagnose root cause, fix source code, re-run. Do not proceed until all tests pass.

## Step 5: Create PR

1. Create a descriptive branch name if not already on one
2. Stage and commit all changes with a clear commit message
3. Push with `-u` flag
4. Create PR with `gh pr create` — title < 70 chars, body summarizes findings fixed

## Step 6: Verify & Report

```
## Review & Ship Summary
- **Findings**: X critical, Y high, Z medium, W low
- **Fixed**: N issues across M files
- **Deferred**: any medium/low items not fixed (with reasons)
- **Tests**: all passing (count)
- **PR**: <URL>
- **CI**: passing / no CI configured
```

## Guidelines

- **Speed over perfection** — fix what matters, defer what doesn't
- **Never skip tests** — the test suite is the gate
- **One commit per logical change** — don't lump unrelated fixes
- **If CI fails after PR creation** — fix the issue, push, and re-check
