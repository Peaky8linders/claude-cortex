#!/usr/bin/env bash
# PostCompact: Inject recovery context — decisions and active patterns
set -euo pipefail

KNOWLEDGE_DIR="$HOME/.claude/knowledge"

if [ -f "$KNOWLEDGE_DIR/graph/nodes.json" ]; then
  # Extract decision nodes for recovery context
  DECISIONS=$(python3 -c "
import json
nodes = json.load(open('$KNOWLEDGE_DIR/graph/nodes.json'))
decs = [n for n in nodes if n.get('metadata',{}).get('type') == 'decision']
if decs:
    lines = ['Decisions (DO NOT reverse):']
    for d in decs[:5]:
        kw = ', '.join(d.get('keywords', [])[:3])
        lines.append(f'  - [{d[\"id\"]}] {kw}: {d[\"content\"][:80]}')
    print(' '.join(lines))
else:
    print('No active decisions in graph.')
" 2>/dev/null || echo "Graph recovery unavailable.")

  echo "{\"additionalContext\": \"[Cortex Recovery] $DECISIONS\"}"
else
  echo '{"additionalContext": "[Cortex] No graph state for recovery."}'
fi
