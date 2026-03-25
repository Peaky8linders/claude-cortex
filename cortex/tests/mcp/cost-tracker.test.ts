import { describe, it, expect } from "vitest";
import { estimateCost, computeSessionCost, MODEL_PRICING } from "../../src/mcp/data/cost-tracker.js";
import type { JournalEntry } from "../../src/mcp/data/session-reader.js";

describe("cost-tracker", () => {
  describe("estimateCost", () => {
    it("computes opus cost with 70/30 input/output split", () => {
      // 1000 tokens on opus: 700 input * $15/M + 300 output * $75/M
      const cost = estimateCost(1000, "opus");
      const expected = (700 / 1_000_000) * 15 + (300 / 1_000_000) * 75;
      expect(cost).toBeCloseTo(expected, 8);
    });

    it("computes sonnet cost", () => {
      const cost = estimateCost(1_000_000, "sonnet");
      const expected = 0.7 * 3 + 0.3 * 15;
      expect(cost).toBeCloseTo(expected, 4);
    });

    it("computes haiku cost", () => {
      const cost = estimateCost(1_000_000, "haiku");
      const expected = 0.7 * 0.25 + 0.3 * 1.25;
      expect(cost).toBeCloseTo(expected, 4);
    });

    it("defaults to sonnet for unknown model", () => {
      const unknown = estimateCost(1000, "unknown");
      const sonnet = estimateCost(1000, "sonnet");
      expect(unknown).toBe(sonnet);
    });

    it("defaults to sonnet for undefined model", () => {
      const noModel = estimateCost(1000);
      const sonnet = estimateCost(1000, "sonnet");
      expect(noModel).toBe(sonnet);
    });

    it("normalizes full model IDs", () => {
      const full = estimateCost(1000, "claude-opus-4-6");
      const short = estimateCost(1000, "opus");
      expect(full).toBe(short);
    });

    it("returns 0 for 0 tokens", () => {
      expect(estimateCost(0, "opus")).toBe(0);
    });
  });

  describe("computeSessionCost", () => {
    it("aggregates cost across entries by model", () => {
      const entries: JournalEntry[] = [
        { type: "write", ts: "2026-01-01T00:00:00Z", tokens_est: 1000, model: "opus" },
        { type: "read", ts: "2026-01-01T00:01:00Z", tokens_est: 500, model: "sonnet" },
        { type: "bash", ts: "2026-01-01T00:02:00Z", tokens_est: 200, model: "opus" },
      ];

      const result = computeSessionCost(entries);
      expect(result.total_tokens).toBe(1700);
      expect(result.total_usd).toBeGreaterThan(0);
      expect(result.by_model.opus.tokens).toBe(1200);
      expect(result.by_model.sonnet.tokens).toBe(500);
    });

    it("skips session_start and session_end entries", () => {
      const entries: JournalEntry[] = [
        { type: "session_start", ts: "2026-01-01T00:00:00Z" },
        { type: "write", ts: "2026-01-01T00:01:00Z", tokens_est: 1000, model: "sonnet" },
        { type: "session_end", ts: "2026-01-01T00:10:00Z" },
      ];

      const result = computeSessionCost(entries);
      expect(result.total_tokens).toBe(1000);
    });

    it("returns empty by_model for empty entries", () => {
      const result = computeSessionCost([]);
      expect(result.total_usd).toBe(0);
      expect(result.total_tokens).toBe(0);
      expect(Object.keys(result.by_model)).toHaveLength(0);
    });
  });
});
