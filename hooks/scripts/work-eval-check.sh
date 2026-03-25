#!/usr/bin/env bash
# Work output quality check — lightweight heuristic evaluation
# Used alongside quality-check.sh (graph health) for dual gating
# Returns a numeric score 0-100 based on test results and diff analysis
set -euo pipefail

# Portable python resolver (python3 on macOS/Linux, python on Windows)
PYTHON=$(command -v python3 2>/dev/null || command -v python 2>/dev/null || echo "python3")

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"
DIFF_REF="${1:-HEAD~1}"  # Accept ref argument; default HEAD~1

SCORE=70  # Baseline

# 1. Capture diff once (avoid repeated git calls)
DIFF_OUTPUT=$(git diff "$DIFF_REF" 2>/dev/null || echo "")
if [ -z "$DIFF_OUTPUT" ]; then
  echo "$SCORE"
  exit 0
fi

# 2. Check for obvious issues in the cached diff
ISSUES=0

# Check for debug leftovers
DEBUG_COUNT=$(echo "$DIFF_OUTPUT" | grep -c '^\+.*\(console\.log\|print("DEBUG\|breakpoint()\|# TODO\|// TODO\)' || true)
if [ "$DEBUG_COUNT" -gt 3 ]; then
  ISSUES=$((ISSUES + 10))
fi

# Check for hardcoded secrets patterns (case-insensitive)
SECRET_COUNT=$(echo "$DIFF_OUTPUT" | grep -ci '^\+.*\(password\s*=\s*["'"'"']\|api_key\s*=\s*["'"'"']\|secret\s*=\s*["'"'"']\|token\s*=\s*["'"'"']sk-\|AWS_SECRET_ACCESS_KEY\|PRIVATE_KEY\|ghp_\|gho_\)' || true)
if [ "$SECRET_COUNT" -gt 0 ]; then
  ISSUES=$((ISSUES + 25))
fi

# Check for conflict markers left in
CONFLICT_COUNT=$(echo "$DIFF_OUTPUT" | grep -c '^\+.*\(<<<<<<<\|>>>>>>>\|=======\)' || true)
if [ "$CONFLICT_COUNT" -gt 0 ]; then
  ISSUES=$((ISSUES + 30))
fi

# 3. Run project test suite if available
TEST_PENALTY=0

# Determine which test suites to run based on changed files
CHANGED_FILES=$(git diff --name-only "$DIFF_REF" 2>/dev/null || echo "")

if echo "$CHANGED_FILES" | grep -q "^brainiac/"; then
  if "$PYTHON" -m pytest "$REPO_ROOT/brainiac/tests/" -x -q --tb=no 2>/dev/null; then
    : # tests passed
  else
    TEST_PENALTY=20
  fi
fi

if echo "$CHANGED_FILES" | grep -q "^contextscore/"; then
  if "$PYTHON" -m pytest "$REPO_ROOT/contextscore/tests/" -x -q --tb=no 2>/dev/null; then
    : # tests passed
  else
    TEST_PENALTY=20
  fi
fi

if echo "$CHANGED_FILES" | grep -qE "^cortex/.*\.(ts|js)$"; then
  if (cd "$REPO_ROOT/cortex" && npm test --silent 2>/dev/null); then
    : # tests passed
  else
    TEST_PENALTY=20
  fi
fi

# 4. Compute final score
SCORE=$((SCORE - ISSUES - TEST_PENALTY))

# Clamp to 0-100
if [ "$SCORE" -lt 0 ]; then SCORE=0; fi
if [ "$SCORE" -gt 100 ]; then SCORE=100; fi

echo "$SCORE"
