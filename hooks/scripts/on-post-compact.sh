#!/usr/bin/env bash
# PostCompact: Inject lossless recovery context — pointers to full data in snapshots
# Inspired by LCM (Ehrlich 2026): keep immutable store, inject pointers not full text
set -euo pipefail

KNOWLEDGE_DIR="$HOME/.claude/knowledge"
SNAPSHOTS="$KNOWLEDGE_DIR/snapshots"

if [ -f "$KNOWLEDGE_DIR/graph/nodes.json" ]; then
  RECOVERY=$(python3 << 'PYEOF'
import json, os, glob

knowledge_dir = os.path.join(os.environ.get("HOME", os.path.expanduser("~")), ".claude", "knowledge")
nodes_file = os.path.join(knowledge_dir, "graph", "nodes.json")
snapshots_dir = os.path.join(knowledge_dir, "snapshots")

try:
    with open(nodes_file) as f:
        nodes = json.load(f)
except Exception:
    print("Graph recovery unavailable.")
    raise SystemExit(0)

# Find latest snapshot for pointer references
snapshot_files = sorted(glob.glob(os.path.join(snapshots_dir, "nodes_*.json")), reverse=True)
snapshot_ref = os.path.basename(snapshot_files[0]) if snapshot_files else "none"

# Build lossless pointers: compact references with expand capability
decisions = [n for n in nodes if n.get("metadata", {}).get("type") == "decision"]
patterns = [n for n in nodes if n.get("metadata", {}).get("type") == "pattern"]
active_hyps = [n for n in nodes if n.get("metadata", {}).get("type") == "hypothesis"
               and n.get("metadata", {}).get("status") != "rejected"]

lines = ["[Cortex Recovery — Lossless Pointers]"]
lines.append(f"Snapshot: {snapshot_ref} | Expand: `cd ~/.claude/knowledge && python -m brainiac expand <id>`")
lines.append("")

if decisions:
    lines.append("Decisions (DO NOT reverse):")
    for d in decisions[:5]:
        kw = ", ".join(d.get("keywords", [])[:3])
        lines.append(f"  [{d['id']}] {kw}: {d['content'][:60]}")

if patterns:
    lines.append("Active patterns:")
    for p in patterns[:3]:
        kw = ", ".join(p.get("keywords", [])[:3])
        lines.append(f"  [{p['id']}] {kw}: {p['content'][:60]}")

if active_hyps:
    lines.append("Open hypotheses:")
    for h in active_hyps[:3]:
        status = h.get("metadata", {}).get("status", "proposed")
        lines.append(f"  [{h['id']}] ({status}) {h['content'][:60]}")

if not decisions and not patterns and not active_hyps:
    lines.append("No active decisions, patterns, or hypotheses in graph.")

# Surface usage tip if one was detected
tip_file = os.path.join(knowledge_dir, "active-tip.json")
try:
    if os.path.exists(tip_file):
        with open(tip_file) as tf:
            tip = json.load(tf)
        lines.append("")
        lines.append(f"[Usage Tip] {tip['title']}: {tip['short']}")
except Exception:
    pass

lines.append("")
lines.append(f"Total: {len(nodes)} nodes. Full context recoverable via `brainiac expand <id>`.")

output = json.dumps({"additionalContext": "\n".join(lines)})
print(output)
PYEOF
)

  if [ -n "$RECOVERY" ]; then
    echo "$RECOVERY"
  else
    echo '{"additionalContext": "[Cortex] No graph state for recovery."}'
  fi
else
  echo '{"additionalContext": "[Cortex] No graph state for recovery."}'
fi
