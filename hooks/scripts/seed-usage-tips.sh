#!/usr/bin/env bash
# Seed the 10 usage limit tips as pattern nodes in the brainiac knowledge graph
# Run once: bash hooks/scripts/seed-usage-tips.sh
set -euo pipefail

KNOWLEDGE_DIR="$HOME/.claude/knowledge"

cd "$KNOWLEDGE_DIR" 2>/dev/null || { echo "Knowledge dir not found at $KNOWLEDGE_DIR"; exit 1; }

echo "Seeding 10 usage optimization tips into knowledge graph..."

python3 -m brainiac add pattern "Front-load context instead of follow-ups: Write one detailed prompt upfront. Edit your original message instead of replying — Claude re-reads the entire conversation on every follow-up. A 10-message thread means 5000+ words of dead context re-processed per reply." 2>/dev/null || echo "  [skip] tip 1 may already exist"

python3 -m brainiac add pattern "Use Projects/CLAUDE.md for persistent context: Stop re-explaining your background each session. Put repeated info (language, codebase structure, tone, role) in CLAUDE.md or Project system prompts to save tokens every session." 2>/dev/null || echo "  [skip] tip 2 may already exist"

python3 -m brainiac add pattern "Ask for skeletons before full drafts: For long documents or features, request an outline first. Approve the structure, then flesh out each section. One bad full draft costs 4x the token cost of iterating on an outline." 2>/dev/null || echo "  [skip] tip 3 may already exist"

python3 -m brainiac add pattern "Be surgical with edits: Paste only the broken function, not the entire 500-line file. Use Read with line ranges. Claude does not need the whole file to fix one method — targeted context means faster and cheaper responses." 2>/dev/null || echo "  [skip] tip 4 may already exist"

python3 -m brainiac add pattern "Skip pleasantries in prompts: Remove filler like 'Could you perhaps help me with something?' and start with the actual ask. Every token of fluff is a token not spent on your task." 2>/dev/null || echo "  [skip] tip 5 may already exist"

python3 -m brainiac add pattern "Specify output length explicitly: Add 'respond in under 200 words' or 'bullet points only' to prompts. Claude's default output is generous — if you don't need an essay, constrain it to save output tokens." 2>/dev/null || echo "  [skip] tip 6 may already exist"

python3 -m brainiac add pattern "Batch tasks into single messages: 'Do X. Then do Y. Then do Z.' in one message is dramatically cheaper than three separate conversations. Each new round-trip has setup overhead." 2>/dev/null || echo "  [skip] tip 7 may already exist"

python3 -m brainiac add pattern "Use Haiku for simple tasks: Route summarization, classification, and quick rewrites to Haiku via subagents or API. Reserve Sonnet/Opus for multi-file edits, architecture decisions, and complex reasoning." 2>/dev/null || echo "  [skip] tip 8 may already exist"

python3 -m brainiac add pattern "Don't ask Claude to search its own outputs: 'What did you say about X?' wastes a full exchange. Scroll up and use Cmd+F — the text is right there in your conversation history." 2>/dev/null || echo "  [skip] tip 9 may already exist"

python3 -m brainiac add pattern "Start fresh chats for new topics: Dragging unrelated tasks into a long conversation means Claude re-reads ALL that context every reply. Fresh chat = clean slate = faster + cheaper." 2>/dev/null || echo "  [skip] tip 10 may already exist"

echo ""
echo "Done. Run 'cd ~/.claude/knowledge && python3 -m brainiac stats' to verify."
