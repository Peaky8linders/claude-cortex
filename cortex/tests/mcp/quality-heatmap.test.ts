import { describe, it, expect } from "vitest";
import { computeQualityHeatmap } from "../../src/mcp/tools/quality-heatmap.js";

describe("computeQualityHeatmap", () => {
  it("returns synthetic result when no context and no snapshot", async () => {
    // Without contextscore Python installed, this should return synthetic result
    const result = await computeQualityHeatmap();
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.grade).toBeDefined();
    expect(result.radar_labels).toHaveLength(7);
    expect(result.radar_values).toHaveLength(7);
    expect(result.health_status).toBeDefined();
  });

  it("returns all 7 dimensions", async () => {
    const result = await computeQualityHeatmap("test context for quality analysis");
    expect(result.dimensions).toBeDefined();
    const dimensionNames = Object.keys(result.dimensions);
    expect(dimensionNames.length).toBe(7);
    expect(dimensionNames).toContain("semantic_relevance");
    expect(dimensionNames).toContain("redundancy");
    expect(dimensionNames).toContain("economics");
  });

  it("includes economics data", async () => {
    const result = await computeQualityHeatmap("sample context text for analysis");
    expect(result.economics).toBeDefined();
    expect(result.economics.total_tokens).toBeGreaterThan(0);
    expect(typeof result.economics.waste_percentage).toBe("number");
    expect(typeof result.economics.estimated_cost).toBe("number");
  });

  it("classifies health status correctly", async () => {
    const result = await computeQualityHeatmap("test");
    expect(["healthy", "degraded", "critical"]).toContain(result.health_status);
  });

  it("radar_labels and radar_values have matching lengths", async () => {
    const result = await computeQualityHeatmap("some context");
    expect(result.radar_labels.length).toBe(result.radar_values.length);
    for (const value of result.radar_values) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });
});
