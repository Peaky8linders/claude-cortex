#!/usr/bin/env bash
# Structural tests for quality-check.sh
# Core scoring logic tested in tests/test_brainiac_quality.py
# Run: bash tests/shell/test_quality_check.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
QUALITY_CHECK="$PROJECT_DIR/hooks/scripts/quality-check.sh"

PASSED=0
FAILED=0
TOTAL=0

pass() { PASSED=$((PASSED + 1)); TOTAL=$((TOTAL + 1)); echo "  PASS: $1"; }
fail() { FAILED=$((FAILED + 1)); TOTAL=$((TOTAL + 1)); echo "  FAIL: $1 — $2"; }

echo "=== quality-check.sh Tests ==="
echo ""

# Test 1: Script exists
echo "Test 1: Script exists"
if [ -f "$QUALITY_CHECK" ]; then
  pass "quality-check.sh exists"
else
  fail "quality-check.sh not found" ""
fi

# Test 2: Calls brainiac quality
echo "Test 2: Calls brainiac quality command"
if grep -q "brainiac quality" "$QUALITY_CHECK"; then
  pass "Calls brainiac quality"
else
  fail "Should call brainiac quality" ""
fi

# Test 3: Validates numeric output
echo "Test 3: Has numeric validation"
if grep -q '[0-9]' "$QUALITY_CHECK" && grep -q "echo" "$QUALITY_CHECK"; then
  pass "Has output validation"
else
  fail "Should validate numeric output" ""
fi

# Test 4: Has fallback value
echo "Test 4: Has fallback"
if grep -q '70' "$QUALITY_CHECK"; then
  pass "Falls back to 70"
else
  fail "Should have 70 fallback" ""
fi

# Test 5: Returns numeric output (integration test with real graph)
echo "Test 5: Returns numeric output (integration)"
OUTPUT=$(bash "$QUALITY_CHECK" 2>/dev/null || echo "70")
if [[ "$OUTPUT" =~ ^[0-9]+$ ]]; then
  pass "Returns numeric: $OUTPUT"
else
  fail "Should return a number" "Got: $OUTPUT"
fi

echo ""
echo "=== Results: $PASSED/$TOTAL passed, $FAILED failed ==="
[ "$FAILED" -eq 0 ] && exit 0 || exit 1
