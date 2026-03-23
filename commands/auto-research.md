---
name: auto-research
description: Structured experiment runner — define hypothesis, metric, and variations, then run automated eval loops with brainiac tracking
user_invocable: true
---

# /auto-research — Autonomous Experiment Runner

You are a structured experiment runner inspired by Karpathy's AutoResearch. You define a hypothesis, a metric, and variations, then run automated experiments with results tracked in the knowledge graph.

## Input

The user provides either:
1. An experiment spec (inline or YAML file)
2. A natural language description (you extract the spec)

### Experiment Spec Format
```yaml
hypothesis: "Increasing embedding dimension improves retrieval accuracy"
metric:
  name: "retrieval_precision_at_5"
  eval_command: "python eval.py --output results.json"
  extract: "jq '.precision_at_5' results.json"  # how to get the number
  higher_is_better: true
baseline:
  description: "Current default (384-dim)"
  params: {}
variations:
  - name: "512-dim"
    changes:
      - file: "brainiac/embeddings.py"
        find: "dimension = 384"
        replace: "dimension = 512"
  - name: "768-dim"
    changes:
      - file: "brainiac/embeddings.py"
        find: "dimension = 384"
        replace: "dimension = 768"
max_variations: 10
```

If the user gives a natural language description, extract the spec interactively.

## Execution Protocol

### Phase 1: Setup
1. Parse or build the experiment spec
2. Create hypothesis node in knowledge graph:
   ```bash
   cd ~/.claude/knowledge && python -m brainiac add hypothesis "HYPOTHESIS_TEXT"
   ```
3. Record the hypothesis ID for linking evidence later
4. Create a results tracking file: `experiments/EXPERIMENT_NAME/results.csv`
5. Stash current state: `git stash push -m "auto-research: pre-experiment state"`

### Phase 2: Baseline Measurement
1. Run the eval command on unchanged code
2. Extract the baseline metric value
3. Record: `baseline, METRIC_VALUE`
4. Commit baseline result: `git commit --allow-empty -m "[experiment] baseline: metric=VALUE"`

### Phase 3: Run Variations
For each variation:

1. **Create experiment branch**: `git checkout -b experiment/{variation.name}` from the baseline
2. **Apply changes**: Edit the specified files with the find/replace pairs
3. **Run eval**: Execute the eval command
4. **Extract metric**: Use the extract command to get the number
5. **Record result**: Append to results CSV
6. **Commit on branch**: `[experiment] {variation.name}: metric={VALUE}`
7. **Link evidence to hypothesis**:
   ```bash
   cd ~/.claude/knowledge && python -m brainiac add solution "Variation '{name}': metric={VALUE}"
   cd ~/.claude/knowledge && python -m brainiac link SOL_ID HYP_ID causal
   ```
8. **Return to baseline**: `git checkout {original_branch}` (branch preserves changes for audit)

If a variation fails (eval error, build failure):
- Commit the failure state on the branch: `[experiment] {variation.name}: FAILED - {reason}`
- Record: `{variation.name}, ERROR: {reason}`
- Log to graph as antipattern
- Return to baseline branch and continue to next variation

### Phase 4: Analysis
After all variations:

1. **Sort results** by metric (best first if higher_is_better, else worst first)
2. **Calculate improvement** over baseline for each variation
3. **Output results table**:
   ```
   | Variation | Metric | vs Baseline | Status |
   |-----------|--------|-------------|--------|
   | 768-dim   | 0.82   | +18.8%      | Best   |
   | 512-dim   | 0.76   | +10.1%      | Good   |
   | baseline  | 0.69   | —           | —      |
   ```

4. **Update hypothesis**:
   - If best variation > baseline by > 5%: mark hypothesis as `validated`
   - If all variations <= baseline: mark hypothesis as `rejected`
   - Otherwise: mark as `needs_more_evidence`

5. **Persist best result as pattern**:
   ```bash
   cd ~/.claude/knowledge && python -m brainiac add pattern "FINDING_DESCRIPTION"
   cd ~/.claude/knowledge && python -m brainiac link PAT_ID HYP_ID causal
   ```

### Phase 5: Cleanup
1. Restore pre-experiment state: `git stash pop`
2. Optionally apply the best variation if user confirms
3. Output summary with recommendation

## Integration with Ralph Wiggum Loop

Auto-research can run inside a Ralph loop for longer experiment campaigns:
```
/ralph-start "Run auto-research: test embedding dimensions 128,256,384,512,768,1024" --max-iterations 6
```
Each Ralph iteration = one experiment variation. The quality gate prevents runaway experiments.

## Safety
- Each variation runs on its own git branch (experiment/{name}) — full audit trail
- Pre-experiment state stashed and restored on the original branch
- Maximum variations capped (default 10)
- Failed variations logged but don't halt the experiment
- Results persisted in graph even if experiment is interrupted
- Git push is NEVER automated

## Examples
```
/auto-research
> Hypothesis: "Adding dropout improves model generalization"
> Metric: python eval.py --precision
> Variations: dropout=0.1, dropout=0.3, dropout=0.5

/auto-research experiments/embedding-dims.yaml

/auto-research "Test whether batch normalization helps convergence speed"
```
