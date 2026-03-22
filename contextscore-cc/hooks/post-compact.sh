#!/bin/bash
# ContextScore PostCompact Hook for Claude Code
# Automatically injects recovery context after compaction.
#
# Installation: Add to .claude/settings.json:
# {
#   "hooks": {
#     "PostCompact": [{
#       "type": "command",
#       "command": "bash .claude/hooks/post-compact.sh"
#     }]
#   }
# }

# Generate recovery context from latest snapshot
RECOVERY=$(npx contextscore recover 2>/dev/null)

if [ -n "$RECOVERY" ]; then
  # Output recovery context (Claude Code will see this)
  echo "$RECOVERY"
  echo ""
  echo "⚠️  Compaction detected. Context recovery loaded from snapshot."
  echo "    Review the recovered context above and confirm it matches your expectations."
else
  echo "⚠️  Compaction detected. No snapshot available for recovery."
  echo "    Tip: Run 'contextscore snapshot' periodically to protect your context."
fi
