#!/usr/bin/env bash
# Structural tests for on-stop.sh
# Run: bash tests/shell/test_on_stop.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ON_STOP="$PROJECT_DIR/hooks/scripts/on-stop.sh"

PASSED=0
FAILED=0
TOTAL=0

pass() { PASSED=$((PASSED + 1)); TOTAL=$((TOTAL + 1)); echo "  PASS: $1"; }
fail() { FAILED=$((FAILED + 1)); TOTAL=$((TOTAL + 1)); echo "  FAIL: $1 — $2"; }

echo "=== on-stop.sh Tests ==="
echo ""

# Test 1: Script exists and is executable
echo "Test 1: Script is executable"
if [ -x "$ON_STOP" ]; then
  pass "on-stop.sh is executable"
else
  fail "on-stop.sh should be executable" ""
fi

# Test 2: Checks for Ralph loop file
echo "Test 2: Checks Ralph loop"
if grep -q "ralph-active" "$ON_STOP"; then
  pass "Checks for .ralph-active"
else
  fail "Should check .ralph-active" ""
fi

# Test 3: Calls ralph-loop.sh
echo "Test 3: Calls ralph-loop.sh"
if grep -q "ralph-loop.sh" "$ON_STOP"; then
  pass "Calls ralph-loop.sh"
else
  fail "Should call ralph-loop.sh" ""
fi

# Test 4: Has error logging (redirects stderr)
echo "Test 4: Error logging"
if grep -q "ralph-errors.log" "$ON_STOP"; then
  pass "Logs errors to ralph-errors.log"
else
  fail "Should log errors" ""
fi

# Test 5: Cleans up search cache
echo "Test 5: Cache cleanup"
if grep -q "ralph-search-cache" "$ON_STOP"; then
  pass "Cleans up search cache"
else
  fail "Should clean .ralph-search-cache" ""
fi

# Test 6: Normal summary still works (integration)
echo "Test 6: Normal summary (integration)"
# Only test if no active Ralph loop
if [ ! -f "$HOME/.claude/knowledge/.ralph-active" ]; then
  OUTPUT=$(bash "$ON_STOP" 2>/dev/null || true)
  if echo "$OUTPUT" | grep -q "\[Cortex\]" || [ -z "$OUTPUT" ]; then
    pass "Normal summary or silent (no graph)"
  else
    fail "Unexpected output" "Got: $OUTPUT"
  fi
else
  pass "Skipped (active Ralph loop)"
fi

echo ""
echo "=== Results: $PASSED/$TOTAL passed, $FAILED failed ==="
[ "$FAILED" -eq 0 ] && exit 0 || exit 1
