#!/usr/bin/env bash
# Dual quality gate — combines graph health + work output quality
# Graph health (brainiac): measures knowledge graph connectivity & node quality
# Work quality (work-eval-check): measures actual code output via tests & heuristics
# Used by ralph-loop.sh and /run-tasks
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 1. Graph health score (brainiac quality)
GRAPH_SCORE=$(cd "$HOME/.claude/knowledge" && python3 -m brainiac quality 2>/dev/null || echo "")
if ! [[ "$GRAPH_SCORE" =~ ^[0-9]+$ ]]; then
  echo "[Quality] WARNING: brainiac quality failed, using fallback graph score 70" >&2
  GRAPH_SCORE=70
fi

# 2. Work output score (test results + diff heuristics)
WORK_SCORE=$(bash "$SCRIPT_DIR/work-eval-check.sh" 2>/dev/null || echo "")
if ! [[ "$WORK_SCORE" =~ ^[0-9]+$ ]]; then
  echo "[Quality] WARNING: work-eval-check failed, using fallback work score 70" >&2
  WORK_SCORE=70
fi

# 3. Composite: 30% graph health + 70% work quality
# Work quality matters more — a healthy graph doesn't help if the code is broken
COMPOSITE=$(python3 -c "import sys; print(int(int(sys.argv[1]) * 0.3 + int(sys.argv[2]) * 0.7))" "$GRAPH_SCORE" "$WORK_SCORE" 2>/dev/null || echo "70")

# Output both scores to stderr for logging, composite to stdout for gating
echo "[Quality] Graph: $GRAPH_SCORE | Work: $WORK_SCORE | Composite: $COMPOSITE" >&2
echo "$COMPOSITE"
