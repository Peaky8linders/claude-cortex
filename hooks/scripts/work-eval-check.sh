#!/usr/bin/env bash
# Work output quality check — lightweight heuristic evaluation
# Used alongside quality-check.sh (graph health) for dual gating
# Returns a numeric score 0-100 based on test results and diff analysis
set -euo pipefail

SCORE=70  # Baseline

# 1. Check if there are any changes to evaluate
DIFF_STAT=$(git diff --stat HEAD~1 2>/dev/null || echo "")
if [ -z "$DIFF_STAT" ]; then
  # No changes = nothing to evaluate, return baseline
  echo "$SCORE"
  exit 0
fi

# 2. Count files changed and lines changed
FILES_CHANGED=$(git diff --name-only HEAD~1 2>/dev/null | wc -l)
LINES_ADDED=$(git diff HEAD~1 --numstat 2>/dev/null | awk '{sum+=$1} END {print sum+0}')
LINES_REMOVED=$(git diff HEAD~1 --numstat 2>/dev/null | awk '{sum+=$2} END {print sum+0}')

# 3. Check for obvious issues in the diff
ISSUES=0

# Check for debug leftovers (console.log, print("DEBUG, breakpoint, TODO)
DEBUG_COUNT=$(git diff HEAD~1 2>/dev/null | grep -c '^\+.*\(console\.log\|print("DEBUG\|breakpoint()\|# TODO\|// TODO\)' || true)
if [ "$DEBUG_COUNT" -gt 3 ]; then
  ISSUES=$((ISSUES + 10))
fi

# Check for hardcoded secrets patterns
SECRET_COUNT=$(git diff HEAD~1 2>/dev/null | grep -c '^\+.*\(password\s*=\s*["\x27]\|api_key\s*=\s*["\x27]\|secret\s*=\s*["\x27]\|token\s*=\s*["\x27]sk-\)' || true)
if [ "$SECRET_COUNT" -gt 0 ]; then
  ISSUES=$((ISSUES + 25))
fi

# Check for conflict markers left in
CONFLICT_COUNT=$(git diff HEAD~1 2>/dev/null | grep -c '^\+.*\(<<<<<<<\|>>>>>>>\|=======\)' || true)
if [ "$CONFLICT_COUNT" -gt 0 ]; then
  ISSUES=$((ISSUES + 30))
fi

# 4. Run project test suite if available (fast check)
TEST_PENALTY=0
# Try python tests for changed python files
PY_CHANGED=$(git diff --name-only HEAD~1 2>/dev/null | grep '\.py$' | head -1 || true)
if [ -n "$PY_CHANGED" ]; then
  # Determine which test suite to run based on path
  if echo "$PY_CHANGED" | grep -q "^brainiac/"; then
    TEST_RESULT=$(cd brainiac && python3 -m pytest tests/ -x -q --tb=no 2>/dev/null; echo $?)
    if [ "$TEST_RESULT" != "0" ]; then
      TEST_PENALTY=20
    fi
  elif echo "$PY_CHANGED" | grep -q "^contextscore/"; then
    TEST_RESULT=$(cd contextscore && python3 -m pytest tests/ -x -q --tb=no 2>/dev/null; echo $?)
    if [ "$TEST_RESULT" != "0" ]; then
      TEST_PENALTY=20
    fi
  fi
fi

# Try npm tests for changed ts/js files
TS_CHANGED=$(git diff --name-only HEAD~1 2>/dev/null | grep -E '\.(ts|js)$' | grep '^cortex/' | head -1 || true)
if [ -n "$TS_CHANGED" ]; then
  TEST_RESULT=$(cd cortex && npm test --silent 2>/dev/null; echo $?)
  if [ "$TEST_RESULT" != "0" ]; then
    TEST_PENALTY=20
  fi
fi

# 5. Compute final score
SCORE=$((SCORE - ISSUES - TEST_PENALTY))

# Bonus for substantive changes (not just cosmetic)
if [ "$LINES_ADDED" -gt 10 ] && [ "$FILES_CHANGED" -gt 0 ]; then
  SCORE=$((SCORE + 5))
fi

# Clamp to 0-100
if [ "$SCORE" -lt 0 ]; then SCORE=0; fi
if [ "$SCORE" -gt 100 ]; then SCORE=100; fi

echo "$SCORE"
