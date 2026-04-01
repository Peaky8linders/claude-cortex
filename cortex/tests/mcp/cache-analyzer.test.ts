import { describe, it, expect } from "vitest";
import {
  estimateCacheAwareCost,
  detectCacheAnomaly,
  CACHE_WRITE_MULTIPLIER,
  CACHE_READ_MULTIPLIER,
  STATIC_CONTENT_RATIO,
} from "../../src/mcp/data/cost-tracker.js";
import type { JournalEntry } from "../../src/mcp/data/session-reader.js";

// Helper: create entries spread across distinct prompt turns (different seconds)
function makeEntries(turnTokens: number[], model = "sonnet"): JournalEntry[] {
  return turnTokens.map((tokens, i) => ({
    type: "write",
    ts: new Date(Date.UTC(2026, 0, 1, 0, i, 0)).toISOString(),
    tokens_est: tokens,
    model,
    prompt_id: `session-${1735689600 + i * 60}`, // distinct prompt IDs 60s apart
  }));
}

describe("cache-aware cost estimation", () => {
  describe("estimateCacheAwareCost", () => {
    it("returns zeros for empty entries", () => {
      const result = estimateCacheAwareCost([], "startup");
      expect(result.cost_no_cache).toBe(0);
      expect(result.cost_with_cache).toBe(0);
      expect(result.cache_savings_est).toBe(0);
      expect(result.cache_hit_ratio_est).toBe(0);
    });

    it("estimates savings for multi-turn startup session", () => {
      const entries = makeEntries([5000, 3000, 4000, 3000]);
      const result = estimateCacheAwareCost(entries, "startup");

      expect(result.cost_no_cache).toBeGreaterThan(0);
      expect(result.cost_with_cache).toBeGreaterThan(0);
      // Cache should provide savings on turns 2-4 (static portion read at 0.1x)
      expect(result.cache_savings_est).toBeGreaterThan(0);
      expect(result.cache_hit_ratio_est).toBe(0.75); // 3 of 4 turns are hits
    });

    it("models resume as more expensive on first turn", () => {
      const entries = makeEntries([10000, 3000, 3000]);
      const startup = estimateCacheAwareCost(entries, "startup");
      const resume = estimateCacheAwareCost(entries, "resume");

      // Resume first turn: all input at CACHE_WRITE_MULTIPLIER
      // Startup first turn: only static at CACHE_WRITE_MULTIPLIER
      expect(resume.cost_with_cache).toBeGreaterThan(startup.cost_with_cache);
    });

    it("single turn has 0 hit ratio", () => {
      const entries = makeEntries([5000]);
      const result = estimateCacheAwareCost(entries, "startup");
      expect(result.cache_hit_ratio_est).toBe(0);
    });
  });

  describe("detectCacheAnomaly", () => {
    it("detects anomaly when first turn is >3x average", () => {
      // First turn: 15000 tokens, rest: 2000 each → ratio = 7.5x
      const entries = makeEntries([15000, 2000, 2000, 2000]);
      const result = detectCacheAnomaly(entries, "resume");

      expect(result.detected).toBe(true);
      expect(result.first_turn_tokens).toBe(15000);
      expect(result.avg_subsequent_tokens).toBe(2000);
      expect(result.ratio).toBe(7.5);
      expect(result.estimated_excess_cost).toBeGreaterThan(0);
      expect(result.session_type).toBe("resume");
    });

    it("does not flag normal sessions", () => {
      // All turns roughly equal
      const entries = makeEntries([3000, 2500, 3500, 2800]);
      const result = detectCacheAnomaly(entries, "startup");

      expect(result.detected).toBe(false);
      expect(result.ratio).toBeLessThan(3);
    });

    it("handles single-turn sessions", () => {
      const entries = makeEntries([5000]);
      const result = detectCacheAnomaly(entries);

      expect(result.detected).toBe(false);
      expect(result.first_turn_tokens).toBe(5000);
      expect(result.avg_subsequent_tokens).toBe(0);
    });

    it("handles empty entries", () => {
      const result = detectCacheAnomaly([]);
      expect(result.detected).toBe(false);
      expect(result.first_turn_tokens).toBe(0);
    });

    it("preserves session type in result", () => {
      const entries = makeEntries([3000, 3000]);
      const result = detectCacheAnomaly(entries, "compact");
      expect(result.session_type).toBe("compact");
    });
  });

  describe("cache pricing constants", () => {
    it("has correct multipliers", () => {
      expect(CACHE_WRITE_MULTIPLIER).toBe(1.25);
      expect(CACHE_READ_MULTIPLIER).toBe(0.10);
      expect(STATIC_CONTENT_RATIO).toBe(0.35);
    });
  });
});
