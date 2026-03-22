#!/bin/bash
# ContextScore PostToolUse Hook for Claude Code
# Runs a lightweight quality check after each tool use.
#
# Installation: Add to .claude/settings.json:
# {
#   "hooks": {
#     "PostToolUse": [{
#       "type": "command",
#       "command": "bash .claude/hooks/post-tool-use.sh"
#     }]
#   }
# }

# Read hook input from stdin (Claude Code passes JSON)
INPUT=$(cat)

# Extract tool name from input
TOOL_NAME=$(echo "$INPUT" | grep -o '"tool_name":"[^"]*"' | head -1 | cut -d'"' -f4)

# Only run on significant tool uses (skip trivial ones)
case "$TOOL_NAME" in
  Read|Edit|Write|MultiEdit|Bash|Search)
    # These tools modify or read context — worth scoring
    ;;
  *)
    # Skip tool_result, thinking, etc.
    exit 0
    ;;
esac

# Run lightweight watch command
# Uses the current session's accumulated context estimate
npx contextscore watch --json 2>/dev/null || true
