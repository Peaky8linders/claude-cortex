/**
 * Quality Heatmap Tool — 7-dimension context quality radar
 */

import { scoreContext, scoreLatestSnapshot, type QualityResult } from "../data/quality-bridge.js";

export interface QualityHeatmapResult extends QualityResult {
  radar_labels: string[];
  radar_values: number[];
  health_status: "healthy" | "degraded" | "critical";
}

export async function computeQualityHeatmap(
  context?: string,
  query: string = "general session quality",
): Promise<QualityHeatmapResult> {
  const result = context
    ? await scoreContext(context, query)
    : await scoreLatestSnapshot(query);

  // Extract radar chart arrays for easy visualization
  const labels = Object.keys(result.dimensions);
  const values = Object.values(result.dimensions).map(d => d.score);

  // Determine health status
  let healthStatus: "healthy" | "degraded" | "critical" = "healthy";
  if (result.score < 40) {
    healthStatus = "critical";
  } else if (result.score < 65) {
    healthStatus = "degraded";
  }

  return {
    ...result,
    radar_labels: labels,
    radar_values: values,
    health_status: healthStatus,
  };
}
