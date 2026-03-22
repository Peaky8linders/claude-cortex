# contextscore-cc

**Context quality scoring & compaction guard for Claude Code**

Stop losing work to compaction. Score your context quality in real-time, snapshot critical decisions before compaction fires, and auto-recover after.

---

## The Problem

Claude Code auto-compacts at ~83% context capacity. After compaction, Claude forgets architectural decisions, re-reads files it already processed, and contradicts its own prior choices. The community workaround is `/quit` and start fresh.

## The Solution

Two products in one package:

1. **ContextScore** — 7 analyzers score context quality 0–100 across semantic relevance, redundancy, distractors, density, fragmentation, structure, and economics. Every issue gets a specific cause, description, and actionable fix.

2. **Compaction Guard** — Snapshots critical context (decisions, entities, files, patterns, error resolutions) before compaction. Auto-generates recovery context to inject after compaction, preserving session continuity.

---

## Install

```bash
npm install -g contextscore-cc
# or
npx contextscore-cc score context.txt -q "your query"
```

## CLI Commands

### Score context quality
```bash
# From a file
contextscore score context.txt -q "How does auth work?"

# From stdin
echo "your context..." | contextscore score - -q "your query"

# JSON output
contextscore score context.txt -q "query" --json
```

### Lightweight watch (for hooks)
```bash
echo "context" | contextscore watch - -q "query"
# 🟢 CCS: 92/100 (A) | 1,200 tokens | 3% waste | 1 issue
```

### Snapshot before compaction
```bash
contextscore snapshot session.txt --session my-session -q "current task"
# ✅ Snapshot saved with 5 decisions, 12 entities, 8 files
```

### Recover after compaction
```bash
contextscore recover my-session
# Outputs structured recovery context with decisions, entities, patterns
```

---

## Claude Code Integration

### PostToolUse Hook (quality indicator)
Add to `.claude/settings.json`:
```json
{
  "hooks": {
    "PostToolUse": [{
      "type": "command",
      "command": "bash hooks/post-tool-use.sh"
    }]
  }
}
```

### PostCompact Hook (auto-recovery)
```json
{
  "hooks": {
    "PostCompact": [{
      "type": "command",
      "command": "bash hooks/post-compact.sh"
    }]
  }
}
```

### Slash Command
Copy `commands/contextscore.md` to `.claude/commands/` for the `/contextscore` command.

---

## What It Detects (28 Issue Types)

| Category | Issues |
|---|---|
| **Semantic Relevance** | Irrelevant segments, low query alignment, topic drift, semantic mismatch |
| **Redundancy** | Exact duplicates, near-duplicates, paraphrased repetition, boilerplate |
| **Distractors** | Topical distractors, misleading terms, contradictions, stale information |
| **Density** | Verbose padding, low signal ratio, excessive formatting, filler content |
| **Fragmentation** | Broken references, incomplete context, orphaned entities, missing relationships |
| **Structure** | No section boundaries, mixed content types, poor ordering, missing metadata |
| **Economics** | Oversized context, attention budget exceeded, high cost/low signal, cacheable content |

## What Snapshots Capture

- **Decisions** — architectural choices with reasoning and affected files
- **Entities** — files, classes, configs, and variables in active use
- **Patterns** — conventions and standards established in the session
- **Error resolutions** — bugs fixed (marked "DO NOT re-introduce")
- **Compact instructions** — priority-ranked guidance for the compaction summarizer

---

## Dev

```bash
npm install
npx tsc                    # compile
npx vitest run             # 41 tests
node dist/cli/main.js help # CLI
```

## License

MIT
