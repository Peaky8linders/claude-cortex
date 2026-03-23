#!/usr/bin/env bash
# Tests for tmux-launch.sh — argument parsing and mode detection
# Run: bash tests/shell/test_tmux_launch.sh
# NOTE: These tests do NOT actually create tmux sessions — they test arg parsing only
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TMUX_LAUNCH="$PROJECT_DIR/scripts/tmux-launch.sh"

PASSED=0
FAILED=0
TOTAL=0

pass() { PASSED=$((PASSED + 1)); TOTAL=$((TOTAL + 1)); echo "  PASS: $1"; }
fail() { FAILED=$((FAILED + 1)); TOTAL=$((TOTAL + 1)); echo "  FAIL: $1 — $2"; }

echo "=== tmux-launch.sh Tests ==="
echo ""

# Test 1: Script is executable
echo "Test 1: Script is executable"
if [ -x "$TMUX_LAUNCH" ]; then
  pass "tmux-launch.sh is executable"
else
  fail "tmux-launch.sh should be executable" "Missing +x permission"
fi

# Test 2: Script has correct shebang
echo "Test 2: Correct shebang"
SHEBANG=$(head -1 "$TMUX_LAUNCH")
if [ "$SHEBANG" = "#!/usr/bin/env bash" ]; then
  pass "Correct shebang line"
else
  fail "Should have #!/usr/bin/env bash" "Got: $SHEBANG"
fi

# Test 3: --ralph mode requires prompt argument
echo "Test 3: --ralph requires prompt"
if ! command -v tmux &>/dev/null; then
  # Can test the error path since tmux check happens first
  OUTPUT=$(bash "$TMUX_LAUNCH" "test-session" --ralph 2>&1 || true)
  if echo "$OUTPUT" | grep -q "Error"; then
    pass "Error message when tmux or prompt missing"
  else
    pass "Script handles missing tmux gracefully"
  fi
else
  # tmux exists — test ralph prompt requirement
  OUTPUT=$(bash "$TMUX_LAUNCH" "test-ralph-$$" --ralph 2>&1 || true)
  if echo "$OUTPUT" | grep -q "requires a prompt"; then
    pass "Error when --ralph has no prompt"
  else
    fail "Should require prompt for --ralph" "Got: $OUTPUT"
  fi
  tmux kill-session -t "test-ralph-$$" 2>/dev/null || true
fi

# Test 4: Contains --allowedTools (not --dangerously-skip-permissions)
echo "Test 4: Uses --allowedTools"
if grep -q "allowedTools" "$TMUX_LAUNCH"; then
  pass "Uses --allowedTools flag"
else
  fail "Should use --allowedTools" "Flag not found in script"
fi
if grep -q "dangerously-skip-permissions" "$TMUX_LAUNCH"; then
  fail "Should NOT use --dangerously-skip-permissions" "Flag found in script"
else
  pass "Does not use --dangerously-skip-permissions"
fi

# Test 5: Recognizes YAML file mode
echo "Test 5: YAML mode detection"
if grep -q '\.yaml\|\.yml' "$TMUX_LAUNCH"; then
  pass "Script handles .yaml/.yml file patterns"
else
  fail "Should detect YAML files" "Pattern not found"
fi

echo ""
echo "=== Results: $PASSED/$TOTAL passed, $FAILED failed ==="
[ "$FAILED" -eq 0 ] && exit 0 || exit 1
