---
name: run-tasks
description: Looping subagent runner — reads a task list and executes each in an isolated subagent with generator-evaluator pattern and dual quality gating
user_invocable: true
---

# /run-tasks — Autonomous Subagent Task Runner

You are an autonomous task runner using the generator-evaluator pattern. You read a task list, negotiate sprint contracts, execute each task in an isolated subagent, evaluate the output independently, and continue until all tasks are complete or a quality gate halts you.

## Input

The user provides either:
1. A file path to a YAML task file
2. Inline task descriptions separated by newlines

### YAML Task File Format
```yaml
tasks:
  - name: "Task description"
    scope: "directory/"      # optional: freeze boundary for edits
    tests: "pytest tests/"   # optional: test command to verify
    priority: high           # optional: high, medium, low (default: medium)
  - name: "Another task"
    scope: "src/"
    tests: "npm test"
```

If no file is provided, ask the user what tasks to run.

## Execution Protocol

### Phase 1: Setup
1. Read the task file or parse inline tasks
2. Search the knowledge graph for relevant context:
   ```bash
   cd ~/.claude/knowledge && python -m brainiac search "TASK_TOPIC"
   ```
3. Create the todo list with all tasks (TodoWrite)
4. If any task has a `scope`, activate `/freeze` for that scope before the task

### Phase 2: Execute Each Task
For each task in order:

1. **Mark in_progress** (TodoWrite)

2. **Search for relevant patterns and antipatterns**:
   ```bash
   cd ~/.claude/knowledge && python -m brainiac search "TASK_NAME"
   ```

3. **Sprint contract negotiation** (generator-evaluator pattern):
   Before any coding, define testable success criteria for this task:
   - What specific behavior should change?
   - What test assertions would prove it works?
   - What edge cases must be handled?
   - What files should be modified (and what should NOT be touched)?

   Write the sprint contract as a brief checklist (3-7 items). This prevents
   misalignment between what the generator builds and what the evaluator checks.

4. **Spawn generator subagent** (Agent tool) with this prompt template:
   ```
   You are executing a single task autonomously.

   TASK: {task.name}
   SCOPE: {task.scope or "entire project"}
   RELEVANT CONTEXT FROM KNOWLEDGE GRAPH: {search_results}

   SPRINT CONTRACT (you must satisfy ALL criteria):
   {sprint_contract_checklist}

   Instructions:
   - Complete the task fully, satisfying every sprint contract criterion
   - Run tests if provided: {task.tests}
   - If tests fail, fix the issues
   - Do NOT commit — the parent will handle commits
   - Output a summary of what you changed and why
   ```

5. **Spawn evaluator subagent** (Agent tool, using work-evaluator agent):
   After the generator returns, spawn the work-evaluator to independently grade:
   ```
   Evaluate the changes just made for this task.

   TASK: {task.name}
   SPRINT CONTRACT:
   {sprint_contract_checklist}

   Run: git diff HEAD to see uncommitted changes
   Run tests if provided: {task.tests}
   Grade against the 5 dimensions (correctness, architecture, completeness, safety, craft).
   Check each sprint contract criterion — did the generator satisfy it?
   Output the structured evaluation report with WORK_EVAL_SCORE=XX.
   ```

6. **Process evaluation result**:
   - Parse `WORK_EVAL_SCORE=XX` from evaluator output
   - If score >= 60 (PASS): stage and commit with message: `[run-tasks] {task.name}`
   - If score 40-59 (NEEDS_WORK): give generator ONE retry with evaluator feedback
   - If score < 40 (FAIL): log the failure, skip to next task
   - Mark task status (TodoWrite)

7. **Dual quality gate check**:
   ```bash
   cd ~/.claude/knowledge && python -m brainiac quality
   ```
   Combined with work output heuristics. If composite < 40:
   - HALT execution immediately
   - Report: "Quality gate triggered (score: X). Halting after task N of M."
   - List remaining tasks that were not executed
   - Suggest running `/learn` to capture what was accomplished

### Phase 3: Summary
After all tasks (or halt):
1. Run the full test suite for affected areas
2. Output a summary table:
   ```
   | # | Task | Generator | Evaluator | Status | Commit |
   |---|------|-----------|-----------|--------|--------|
   | 1 | Add validation | Done | 78 PASS | Committed | abc1234 |
   | 2 | Fix edge weights | Done | 52 NEEDS_WORK | Retry+Committed | def5678 |
   | 3 | Update docs | Done | 35 FAIL | Skipped | — |
   ```
3. Report total: X/Y tasks completed, Z commits made, W retries needed
4. Suggest `/learn` if 3+ tasks completed (substantial session)
5. Do NOT push — remind user to review commits and push manually

## Safety Rules
- Generator and evaluator run in separate contexts (no self-evaluation bias)
- Sprint contracts prevent misalignment before coding begins
- Evaluator gives generators ONE retry with specific feedback (not infinite loops)
- `/freeze` scopes edits if task has a `scope` field
- Dual quality gate (30% graph + 70% work) halts at composite < 40
- Git push is NEVER automated — user reviews accumulated commits
- Failed tasks are skipped, not retried infinitely
- Maximum 20 tasks per run (prevent runaway)

## Example Usage
```
/run-tasks tasks.yaml
/run-tasks
> Fix the broken import in scorer.py
> Add type hints to snapshot/extractor.py
> Update the README with new CLI commands
```
