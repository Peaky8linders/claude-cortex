#!/usr/bin/env bash
# Run all shell script tests
# Usage: bash tests/shell/run_all.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOTAL_PASS=0
TOTAL_FAIL=0

echo "========================================"
echo "  Shell Script Test Suite"
echo "========================================"
echo ""

for test_file in "$SCRIPT_DIR"/test_*.sh; do
  echo "--- Running: $(basename "$test_file") ---"
  if bash "$test_file"; then
    echo ""
  else
    TOTAL_FAIL=$((TOTAL_FAIL + 1))
    echo ""
  fi
done

echo "========================================"
if [ "$TOTAL_FAIL" -eq 0 ]; then
  echo "  ALL TEST FILES PASSED"
else
  echo "  $TOTAL_FAIL TEST FILE(S) HAD FAILURES"
fi
echo "========================================"

exit "$TOTAL_FAIL"
