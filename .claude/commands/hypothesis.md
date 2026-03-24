---
description: Create, track, and validate testable hypotheses in the knowledge graph
user_invocable: true
---

# /hypothesis — Manage Learning Hypotheses via Knowledge Graph

You manage hypotheses in the Brainiac knowledge graph. Hypotheses are graph nodes that move through: **proposed -> testing -> validated/rejected**. Evidence is tracked as causal edges from evidence nodes to the hypothesis node.

## System Location
- Engine: `~/.claude/knowledge/brainiac/`
- CLI: `cd ~/.claude/knowledge && python -m brainiac <command>`

## Commands

Parse the user's intent from their message after `/hypothesis`:

### Create a new hypothesis

1. Search existing graph for related hypotheses:
   ```bash
   cd ~/.claude/knowledge && python -m brainiac search "TOPIC"
   ```

2. Add hypothesis as a graph node:
   ```bash
   cd ~/.claude/knowledge && python -m brainiac add hypothesis "CLAIM: [testable statement]. EXPECTED: [what we'd observe]. TEST: [how to validate]."
   ```

3. Also create `~/.claude/knowledge/hypotheses/{kebab-name}.md` with full detail:
   ```markdown
   ---
   name: descriptive-name
   type: hypothesis
   projects: [relevant-projects]
   tags: [relevant-tags]
   created: YYYY-MM-DD
   updated: YYYY-MM-DD
   confidence: low
   status: proposed
   graph_id: <node ID from step 2>
   ---

   ## Claim
   [Clear, testable statement]

   ## Expected Outcome
   [What would we observe if this is true?]

   ## How to Test
   [Concrete steps to validate or reject]

   ## Evidence For
   <!-- Add dated entries as evidence accumulates -->

   ## Evidence Against
   <!-- Add dated entries as evidence accumulates -->

   ## Verdict
   Pending — needs more evidence.
   ```

4. Update `~/.claude/knowledge/hypotheses/INDEX.md` with the new entry.

### Add evidence to an existing hypothesis

1. Search for the hypothesis: `cd ~/.claude/knowledge && python -m brainiac search "hypothesis topic"`
2. Update the hypothesis markdown file with dated evidence entry
3. Create a causal edge from the evidence source to the hypothesis:
   ```bash
   cd ~/.claude/knowledge && python -m brainiac link <evidence_node_id> <hypothesis_node_id> causal
   ```
4. Update confidence (low/medium/high) based on accumulated evidence
5. If 3+ data points consistently one way:
   - **Validated**: Set status to `validated`. Create a pattern/decision node via `/learn`. Link hypothesis -> pattern with causal edge.
   - **Rejected**: Set status to `rejected`. Create an antipattern node via `/learn`. Link hypothesis -> antipattern with causal edge.

### List hypotheses
```bash
cd ~/.claude/knowledge && python -m brainiac search "hypothesis"
```
Then read `~/.claude/knowledge/hypotheses/INDEX.md` for full status overview.

### Review a hypothesis
Read the specific hypothesis file and summarize current evidence, then suggest next steps.

## Guidelines

- Hypotheses must be **falsifiable**
- Evidence must be **concrete** — test results, metrics, observed behavior
- After 30 days without evidence, flag for review
- Cross-project hypotheses are most valuable
- Always link evidence to hypotheses via causal edges in the graph
