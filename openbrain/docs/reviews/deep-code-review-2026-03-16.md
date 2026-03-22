# Deep Code Review: OpenBrain + ContextScore-CC

**Date:** 2026-03-16 13:10:00
**Scope:** openbrain/ (1,374 lines) + contextscore-cc/ (1,855 lines)
**Files reviewed:** 22 source files + 3 test files
**Lines changed:** +3,229 (net new codebase)
**Diff size category:** Large (multi-repo, multi-product)

## Executive Summary

Both codebases compile clean, pass all tests (27 + 41 = 68 total), and produce correct output on demo inputs. The architecture is sound — clean separation between core engines, pipeline stages, and integration layers. However, the review found **3 Critical issues** (data loss path, quality score overflow, regex catastrophic backtracking), **5 Important issues** (module-level state, missing input validation, duplicate re-computation, inconsistent deduplication, unhandled edge case), and **4 Suggestions**. The critical issues should be fixed before any production deployment.

## Critical Issues

### [C1] Module-level mutable state in MCP server causes cross-request contamination
- **File:** `openbrain/src/mcp/server.ts:24`
- **Bug:** `const thoughtStore: Thought[] = []` is a module-level mutable array. In a long-running MCP server, this array grows unboundedly. More critically, in serverless or multi-instance deployments, this state is not shared — each instance has its own empty array, silently dropping all previously saved thoughts.
- **Impact:** **Data loss.** Users save thoughts via `save_thought`, then `search_brain` returns empty results from a different instance. In a single long-running process, memory grows unboundedly until OOM crash.
- **Suggested fix:** Replace with an injected store interface. For MVP, use a file-backed store (JSON on disk). For production, inject Supabase client. Add a `maxThoughts` cap with LRU eviction for the in-memory fallback.
- **Confidence:** High
- **Found by:** State & Concurrency, Contract & Integration

### [C2] Quality score can exceed 100 and go negative in extractContextGraph
- **File:** `openbrain/src/pipeline/transform.ts:37-40`
- **Bug:** The formula `(entities.length * 10 + decisions.length * 15 + (100 - openQuestions.length * 5)) * (patterns.length > 0 ? 1.1 : 1.0)` has no lower bound before the outer `Math.min(100, ...)`. If `openQuestions.length >= 21`, the inner expression goes negative (100 - 105 = -5), and the final `Math.min(100, Math.max(0, ...))` on line 52 catches it BUT the intermediate value passed to `Math.round` on line 37 can produce unexpected rounding artifacts. More critically: 12 entities + 4 decisions = 120 + 60 = 180, plus 100 = 280 * 1.1 = 308 → `Math.min(100, 308)` = 100. The score is clamped but the *signal* is lost — a thought with 12 entities should score differently from one with 2.
- **Impact:** Quality score is always 100 for any reasonably rich input. The metric is useless for differentiating between good and excellent context. The CLI test showed `qualityScore: 100` for normal meeting notes, confirming this.
- **Suggested fix:** Normalize: `Math.min(100, Math.round((entities * 8 + decisions * 12 + Math.max(0, 50 - openQuestions * 10)) / Math.max(1, entities + decisions + openQuestions) * 10))`. This produces a spread instead of a ceiling.
- **Confidence:** High
- **Found by:** Logic & Correctness

### [C3] Regex catastrophic backtracking risk in decision extraction
- **File:** `openbrain/src/pipeline/transform.ts:171-174`
- **Bug:** Pattern `/(?:wants to|need to|have to)\s+(.{10,120}?)(?:\.|$)/gi` uses `.{10,120}?` (lazy quantifier) anchored to `\.|$`. On inputs without periods (e.g., multiline notes separated by newlines), the regex engine backtracks extensively trying to match across the entire remaining string for each starting position. On a 10KB input without periods, this becomes O(n²) or worse.
- **Impact:** Pipeline hangs or takes seconds per thought on large inputs. The MCP server becomes unresponsive.
- **Suggested fix:** Replace `.{10,120}?` with `[^.\n]{10,120}` (character class negation — no backtracking). Apply the same fix to all similar patterns in both codebases.
- **Confidence:** High
- **Found by:** Logic & Correctness, Error Handling

## Important Issues

### [I1] list_decisions and list_entities re-extract from all thoughts on every call
- **File:** `openbrain/src/mcp/server.ts:254-259, 261-279`
- **Bug:** Both handlers call `thoughtStore.flatMap(t => extractContextGraph(t).decisions)` — re-running the full extraction pipeline on EVERY stored thought on EVERY call. With 100 thoughts, this runs 100 extractions per request.
- **Impact:** O(n) per call where n = total thoughts. Becomes unusable after a few hundred thoughts.
- **Suggested fix:** Maintain a derived cache of entities and decisions that updates incrementally on `save_thought`. Invalidate on delete only.
- **Confidence:** High
- **Found by:** Logic & Correctness

### [I2] No input size validation on MCP tool calls
- **File:** `openbrain/src/mcp/server.ts:129-141`
- **Bug:** `handleSaveThought` accepts arbitrarily large content strings. A 10MB string would trigger regex processing across all patterns, consuming CPU and memory. No max length check.
- **Impact:** Denial of service via malicious or accidental large input. Combined with C3, a large input without periods could hang the server.
- **Suggested fix:** Add `if (content.length > 50_000) return error("Content too large, max 50K chars")` at the top of each handler.
- **Confidence:** High
- **Found by:** Security, Error Handling

### [I3] ContextScore-CC snapshot extractor duplicates ContextScore's regex patterns
- **File:** `contextscore-cc/src/snapshot/extractor.ts:37-42` vs `contextscore-cc/src/core/analyzers/index.ts` (various)
- **Bug:** The snapshot extractor has its own decision-extraction regex patterns that overlap with but are not identical to the patterns in the DistractorAnalyzer and elsewhere. The file path regex in extractor also differs from the one in the fragmentation analyzer. Over time these will diverge, producing inconsistent results.
- **Impact:** Same input produces different decisions in "score" vs "snapshot" commands. Confusing UX, hard-to-debug discrepancies.
- **Suggested fix:** Extract shared regex patterns into a `patterns.ts` constants file imported by both the analyzers and the snapshot extractor.
- **Confidence:** Medium
- **Found by:** Contract & Integration

### [I4] Deduplication in extractDecisions uses first 40 chars as key
- **File:** `openbrain/src/pipeline/transform.ts:183`
- **Bug:** `const key = desc.slice(0, 40).toLowerCase()` — if two decisions share the first 40 characters but differ after that, the second is silently dropped. The meeting note test showed duplicate decisions ("wants to migrate..." appeared twice) because the patterns overlap (pattern 3 and pattern 4 both match "wants to").
- **Impact:** Duplicate decisions in output. The CLI demo showed this: both "She wants to migrate..." and "wants to migrate..." appeared as separate decisions because the first 40 chars differ by the "She " prefix.
- **Suggested fix:** Deduplicate by checking if any existing decision's description *contains* or *is contained by* the new one (substring check), not just prefix match.
- **Confidence:** High
- **Found by:** Logic & Correctness

### [I5] `readStdinOrFile` in openbrain CLI falls through to treating text as content
- **File:** `openbrain/src/cli.ts:137-139`
- **Bug:** The `readStdinOrFile` function tries to read a file, and if it fails, returns the argument as literal text: `catch { return fileOrDash; }`. This means `openbrain pipeline nonexistent-file.txt` silently processes "nonexistent-file.txt" as a thought instead of erroring. Users won't notice their file wasn't read.
- **Impact:** Silent wrong behavior. User thinks they processed a 10KB file but actually processed the filename string.
- **Suggested fix:** Check `existsSync(fileOrDash)` first. If it exists, read it. If not and it looks like a filename (contains `.` or `/`), error. Otherwise treat as literal text.
- **Confidence:** High
- **Found by:** Error Handling

## Suggestions

- **[S1]** Both repos estimate tokens as `Math.floor(text.length / 4)`. For production accuracy, consider using tiktoken or a BPE-based estimator. The 4-char heuristic is ~10% off for English but 30%+ off for code, JSON, and non-Latin scripts.

- **[S2]** The ContextScore-CC `store.ts` creates snapshots in `.claude/context-snapshots/` but never cleans old ones. Add a `--max-snapshots` flag or auto-prune to the 10 most recent per session.

- **[S3]** The OpenBrain MCP server exposes `get_context`, `get_intent`, and `get_spec` as separate tools, but each one re-runs all prior stages. If an agent calls all three sequentially, it runs extraction 3 times. Consider a cached pipeline that memoizes intermediate results.

- **[S4]** Neither codebase has a `--version` flag on the CLI. Add one — it's the first thing users check when reporting bugs.

## Review Metadata

- **Review approach:** Manual multi-lens specialist review (Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, State & Concurrency, Security) followed by verification pass
- **Scope:** All 22 source files across both repos + 3 test files + 2 CLI entry points
- **Raw findings:** 19 (across 5 specialist lenses)
- **Verified findings:** 12 (after verification and deduplication)
- **Filtered out:** 7 (false positives, style nits, low-confidence)
- **Test status:** 68/68 passing (27 openbrain + 41 contextscore-cc)
