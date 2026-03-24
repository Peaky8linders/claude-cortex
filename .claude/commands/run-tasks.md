---
name: run-tasks
description: Looping subagent runner — reads a task list and executes each in an isolated subagent with Cortex quality gating
user_invocable: true
---

# /run-tasks — Autonomous Subagent Task Runner

You are an autonomous task runner. You read a task list, execute each task in an isolated subagent, and continue until all tasks are complete or a quality gate halts you.

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

2. **Search for relevant patterns**:
   ```bash
   cd ~/.claude/knowledge && python -m brainiac search "TASK_NAME"
   ```

3. **Spawn subagent** (Agent tool) with this prompt template:
   ```
   You are executing a single task autonomously.

   TASK: {task.name}
   SCOPE: {task.scope or "entire project"}
   RELEVANT CONTEXT FROM KNOWLEDGE GRAPH: {search_results}

   Instructions:
   - Complete the task fully
   - Run tests if provided: {task.tests}
   - If tests fail, fix the issues
   - Do NOT commit — the parent will handle commits
   - Output a summary of what you changed and why
   ```

4. **After subagent returns**:
   - Review the changes (git diff)
   - Run the task's test command if specified
   - If tests pass: stage and commit with message: `[run-tasks] {task.name}`
   - If tests fail: log the failure, skip to next task
   - Mark task completed (TodoWrite)

5. **Quality gate check**:
   ```bash
   cd ~/.claude/knowledge && python -m brainiac quality
   ```
   The command outputs a single number (0-100). If quality < 30:
   - HALT execution immediately
   - Report: "Quality gate triggered (score: X). Halting after task N of M."
   - List remaining tasks that were not executed
   - Suggest running `/learn` to capture what was accomplished

### Phase 3: Summary
After all tasks (or halt):
1. Run the full test suite for affected areas
2. Output a summary table:
   ```
   | # | Task | Status | Commit |
   |---|------|--------|--------|
   | 1 | Add validation | Done | abc1234 |
   | 2 | Fix edge weights | Done | def5678 |
   | 3 | Update docs | Skipped (test fail) | — |
   ```
3. Report total: X/Y tasks completed, Z commits made
4. Suggest `/learn` if 3+ tasks completed (substantial session)
5. Do NOT push — remind user to review commits and push manually

## Safety Rules
- Each subagent runs in its own context (no main context pollution)
- `/freeze` scopes edits if task has a `scope` field
- Quality gate halts at score < 30 (moderate risk setting)
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
