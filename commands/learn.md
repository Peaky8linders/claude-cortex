# /learn — Extract & Save Session Learnings to Knowledge Graph

You are the learning extraction agent for the Brainiac cross-project knowledge graph. Your job is to analyze the current session, propose knowledge entries, and save approved ones as graph nodes with auto-linking.

## System Location
- Engine: `~/.claude/knowledge/brainiac/`
- Graph data: `~/.claude/knowledge/graph/` (nodes.json, edges.json, embeddings.npz)
- CLI: `cd ~/.claude/knowledge && python -m brainiac <command>`

## Step 1: Check Existing Knowledge

Before proposing anything, search the graph for related entries:
```bash
cd ~/.claude/knowledge && python -m brainiac search "RELEVANT_TOPIC"
```

This prevents duplicates and shows what's already captured.

## Step 2: Analyze the Session

Review the conversation and identify:

1. **Patterns discovered** — Reusable approaches that worked well
2. **Anti-patterns encountered** — Approaches that failed, with evidence
3. **Effective workflows** — Claude Code workflows or agent configurations
4. **Solutions found** — Debugging solutions for specific error classes
5. **Decisions made** — Architecture decisions with rationale
6. **Hypotheses to test** — Claims that emerged but aren't validated

Filter aggressively. Only propose entries that:
- Are **generalizable** across projects
- Have **evidence** from this session
- Are **not already in the graph** (checked in Step 1)
- Would **save time** if encountered again

## Step 3: Propose Entries

For each proposed entry, present:

```
### Proposed: [type] — [name]
**Type**: pattern | antipattern | workflow | hypothesis | solution | decision
**Tags**: [relevant tags]
**Projects**: [which projects]
**Summary**: [2-3 sentences]
**Evidence**: [from this session]
**Causal links**: [if this learning was caused by or led to another entry, note it]
```

Ask the user which entries to save.

## Step 4: Save Approved Entries to Graph

For each approved entry, add it to the graph via CLI:
```bash
cd ~/.claude/knowledge && python -m brainiac add <type> "<content>"
```

The CLI will:
- Generate a unique node ID
- Compute embeddings automatically
- Auto-link to related existing nodes (semantic, temporal, entity edges)
- Regenerate markdown views
- Update INDEX.md stats

For causal relationships identified in Step 3:
```bash
cd ~/.claude/knowledge && python -m brainiac link <source_id> <target_id> causal
```

## Step 5: Also save the markdown source file

For each entry, also create `~/.claude/knowledge/{domain}/{kebab-name}.md` with YAML frontmatter as a human-readable backup:

```markdown
---
name: descriptive-name
type: pattern | antipattern | workflow | hypothesis | solution | decision
projects: [project-names]
tags: [tag1, tag2]
created: YYYY-MM-DD
updated: YYYY-MM-DD
confidence: high | medium | low
status: active
graph_id: <the node ID from Step 4>
---

## Description
What and why.

## When to Apply
Conditions for relevance.

## Details
The actual content with specifics.

## Evidence
Real-world data from this session.
```

## Step 6: Log the Session

Append to `~/.claude/knowledge/meta/session-log.md`:

```markdown
## YYYY-MM-DD | project-name | brief description
- **Learned**: what was captured
- **Graph nodes**: list of node IDs created
- **Edges created**: count of auto + manual edges
```

## Guidelines

- **Quality over quantity** — 1-2 high-value entries per session
- **Be specific** — actionable, not generic
- **Include code snippets** when relevant
- **Check graph first** — search before proposing to avoid duplicates
- **Cross-project value** — prefer learnings that help everywhere
- **Causal links matter** — if learning A led to learning B, link them
