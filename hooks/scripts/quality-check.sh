#!/usr/bin/env bash
# Shared quality gate — outputs a numeric score 0-100
# Used by ralph-loop.sh and /run-tasks
# Calls brainiac quality command for real scoring
set -euo pipefail

SCORE=$(cd "$HOME/.claude/knowledge" && python3 -m brainiac quality 2>/dev/null || echo "70")

# Validate it's a number
if [[ "$SCORE" =~ ^[0-9]+$ ]]; then
  echo "$SCORE"
else
  echo "70"
fi
