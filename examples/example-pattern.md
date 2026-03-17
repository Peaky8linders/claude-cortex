---
name: test-first-verify-after
type: workflow
projects: [all]
tags: [testing, quality, workflow]
created: 2026-03-17
updated: 2026-03-17
confidence: high
status: active
---

## Description
Always run the full test suite before AND after making changes. This catches both pre-existing failures and regressions introduced by your work.

## When to Apply
Any code change in a project with a test suite.

## Details
1. Run tests BEFORE changes to establish baseline
2. Make your changes
3. Run tests AFTER changes to verify no regressions
4. If tests fail after, check if they also failed before (pre-existing) vs new failures

## Evidence
Multiple sessions where skipping the before-run led to wasted debugging time on pre-existing failures.
