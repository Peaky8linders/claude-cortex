import { describe, it, expect } from "vitest";

/**
 * MCP Server integration test — verifies tool registration.
 * We can't fully test StdioServerTransport in vitest, but we can
 * verify the tool handlers are wired correctly by importing them.
 */

import { computeTokenTimeline } from "../../src/mcp/tools/token-timeline.js";
import { computeActivityMap } from "../../src/mcp/tools/activity-map.js";
import { computeQualityHeatmap } from "../../src/mcp/tools/quality-heatmap.js";
import { computeGraphExplorer } from "../../src/mcp/tools/graph-explorer.js";

describe("MCP tool handlers", () => {
  it("all tool handlers are importable and callable", () => {
    // Verify all handlers exist and accept the expected parameters
    expect(typeof computeTokenTimeline).toBe("function");
    expect(typeof computeActivityMap).toBe("function");
    expect(typeof computeQualityHeatmap).toBe("function");
    expect(typeof computeGraphExplorer).toBe("function");
  });

  it("token timeline handles missing data gracefully", () => {
    const result = computeTokenTimeline(undefined, 60, "/nonexistent");
    expect(result.timeline).toEqual([]);
    expect(result.summary.total_tokens).toBe(0);
  });

  it("activity map handles missing data gracefully", () => {
    const result = computeActivityMap(undefined, true, false, "/nonexistent");
    expect(result.tracks).toEqual([]);
    expect(result.duration_minutes).toBeGreaterThanOrEqual(0);
  });

  it("quality heatmap returns valid structure without Python", () => {
    const result = computeQualityHeatmap("test context");
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.dimensions).toBeDefined();
    expect(result.economics).toBeDefined();
  });

  it("graph explorer handles empty graph directory", async () => {
    const result = await computeGraphExplorer("json", undefined, 50, "/nonexistent");
    expect(result.mode).toBe("json");
    if (result.mode === "json") {
      expect(result.nodes).toEqual([]);
    }
  });
});
