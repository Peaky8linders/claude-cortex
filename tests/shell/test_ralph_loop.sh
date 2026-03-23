#!/usr/bin/env bash
# Structural tests for ralph-loop.sh
# Core quality scoring logic is tested in tests/test_brainiac_quality.py
# Run: bash tests/shell/test_ralph_loop.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
RALPH_LOOP="$PROJECT_DIR/hooks/scripts/ralph-loop.sh"

PASSED=0
FAILED=0
TOTAL=0

pass() { PASSED=$((PASSED + 1)); TOTAL=$((TOTAL + 1)); echo "  PASS: $1"; }
fail() { FAILED=$((FAILED + 1)); TOTAL=$((TOTAL + 1)); echo "  FAIL: $1 — $2"; }

echo "=== ralph-loop.sh Tests ==="
echo ""

# Test 1: Script exists and is executable
echo "Test 1: Script is executable"
if [ -x "$RALPH_LOOP" ]; then
  pass "ralph-loop.sh is executable"
else
  fail "ralph-loop.sh should be executable" "Missing +x"
fi

# Test 2: Correct shebang
echo "Test 2: Correct shebang"
SHEBANG=$(head -1 "$RALPH_LOOP")
if [ "$SHEBANG" = "#!/usr/bin/env bash" ]; then
  pass "Correct shebang"
else
  fail "Wrong shebang" "Got: $SHEBANG"
fi

# Test 3: Uses set -euo pipefail
echo "Test 3: Strict mode"
if grep -q "set -euo pipefail" "$RALPH_LOOP"; then
  pass "Uses strict mode"
else
  fail "Should use set -euo pipefail" ""
fi

# Test 4: No .ralph-active → silent exit
echo "Test 4: No loop file → silent exit"
# Use real HOME since Python expanduser is platform-dependent
if [ ! -f "$HOME/.claude/knowledge/.ralph-active" ]; then
  OUTPUT=$(bash "$RALPH_LOOP" 2>/dev/null || true)
  if [ -z "$OUTPUT" ]; then
    pass "Silent exit when no .ralph-active"
  else
    fail "Should produce no output" "Got: $OUTPUT"
  fi
else
  pass "Skipped (active loop exists in real HOME)"
fi

# Test 5: Uses json.dumps for output (not shell heredoc)
echo "Test 5: Uses json.dumps for JSON safety"
if grep -q "json.dumps" "$RALPH_LOOP"; then
  pass "Uses json.dumps for proper escaping"
else
  fail "Should use json.dumps" "Shell heredoc JSON is fragile"
fi

# Test 6: Uses quality-check.sh (not inline scoring)
echo "Test 6: Calls shared quality-check.sh"
if grep -q "quality-check.sh" "$RALPH_LOOP"; then
  pass "Uses shared quality checker"
else
  fail "Should call quality-check.sh" ""
fi

# Test 7: Has search result caching
echo "Test 7: Search result caching"
if grep -q "ralph-search-cache" "$RALPH_LOOP"; then
  pass "Caches search results"
else
  fail "Should cache brainiac search results" ""
fi

# Test 8: Has error logging
echo "Test 8: Error logging"
if grep -q "ralph-errors.log" "$RALPH_LOOP"; then
  pass "Logs errors to file"
else
  fail "Should log errors" ""
fi

# Test 9: Single python3 invocation (not 4 separate calls)
echo "Test 9: Single python3 call"
PYTHON_CALLS=$(grep -c "^python3" "$RALPH_LOOP" || echo "0")
if [ "$PYTHON_CALLS" -le 1 ]; then
  pass "Single python3 invocation ($PYTHON_CALLS calls)"
else
  fail "Should have at most 1 python3 call" "Got: $PYTHON_CALLS"
fi

echo ""
echo "=== Results: $PASSED/$TOTAL passed, $FAILED failed ==="
[ "$FAILED" -eq 0 ] && exit 0 || exit 1
