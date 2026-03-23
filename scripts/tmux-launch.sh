#!/usr/bin/env bash
# Launch Claude Code in a detachable tmux session for multi-hour autonomous runs
# Usage:
#   ./tmux-launch.sh                              # Start interactive session
#   ./tmux-launch.sh "my-session"                  # Named session
#   ./tmux-launch.sh "my-session" tasks.yaml       # Named session + auto-run tasks
#   ./tmux-launch.sh "my-session" --ralph "PROMPT" # Named session + Ralph loop
set -euo pipefail

SESSION_NAME="${1:-claude-autonomous}"
MODE="${2:-interactive}"

# Check tmux is available
if ! command -v tmux &>/dev/null; then
  echo "Error: tmux is not installed. Install with: sudo apt install tmux"
  exit 1
fi

# Check if session already exists
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  echo "Session '$SESSION_NAME' already exists."
  echo "  Attach: tmux attach -t $SESSION_NAME"
  echo "  Kill:   tmux kill-session -t $SESSION_NAME"
  exit 1
fi

# Create detached tmux session
tmux new-session -d -s "$SESSION_NAME" -x 200 -y 50

# Start Claude Code with explicit allowed tools
# Safety enforced by: settings.json deny list + /freeze boundaries + --allowedTools
# This allows autonomous operation without blanket permission skipping
ALLOWED_TOOLS="Read,Glob,Grep,Edit,Write,Agent,TodoWrite"
ALLOWED_TOOLS="$ALLOWED_TOOLS,Bash(npm test*),Bash(npm run build*),Bash(pytest*)"
ALLOWED_TOOLS="$ALLOWED_TOOLS,Bash(python -m pytest*),Bash(python -m brainiac*)"
ALLOWED_TOOLS="$ALLOWED_TOOLS,Bash(git status*),Bash(git diff*),Bash(git log*)"
ALLOWED_TOOLS="$ALLOWED_TOOLS,Bash(git add*),Bash(git commit*),Bash(git branch*)"
ALLOWED_TOOLS="$ALLOWED_TOOLS,Bash(git checkout*),Bash(git stash*)"
ALLOWED_TOOLS="$ALLOWED_TOOLS,Bash(cat *),Bash(ls *),Bash(node *),Bash(mkdir *)"
tmux send-keys -t "$SESSION_NAME" "claude --allowedTools \"$ALLOWED_TOOLS\"" Enter

# Wait for Claude to initialize
sleep 5

# Send command based on mode
case "$MODE" in
  *.yaml|*.yml)
    # Task file mode: run /run-tasks with the file
    TASK_FILE="$MODE"
    echo "Starting task runner with: $TASK_FILE"
    tmux send-keys -t "$SESSION_NAME" "/run-tasks $TASK_FILE" Enter
    ;;
  --ralph)
    # Ralph mode: start autonomous loop
    RALPH_PROMPT="${3:-}"
    if [ -z "$RALPH_PROMPT" ]; then
      echo "Error: --ralph requires a prompt argument"
      echo "Usage: ./tmux-launch.sh session-name --ralph \"Your task prompt\""
      exit 1
    fi
    MAX_ITER="${4:-50}"
    echo "Starting Ralph loop: $RALPH_PROMPT"
    tmux send-keys -t "$SESSION_NAME" "/ralph-start \"$RALPH_PROMPT\" --max-iterations $MAX_ITER" Enter
    ;;
  interactive)
    echo "Interactive mode — attach to send commands."
    ;;
  *)
    # Treat as a direct prompt
    echo "Sending prompt: $MODE"
    tmux send-keys -t "$SESSION_NAME" "$MODE" Enter
    ;;
esac

echo ""
echo "=== Claude Autonomous Session ==="
echo "  Session:  $SESSION_NAME"
echo "  Attach:   tmux attach -t $SESSION_NAME"
echo "  Detach:   Ctrl+B, then D (inside tmux)"
echo "  Kill:     tmux kill-session -t $SESSION_NAME"
echo "  List:     tmux list-sessions"
echo ""
echo "Your laptop lid can close. The session persists in tmux."
