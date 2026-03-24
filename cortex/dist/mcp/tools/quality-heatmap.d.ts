/**
 * Quality Heatmap Tool — 7-dimension context quality radar
 */
import { type QualityResult } from "../data/quality-bridge.js";
export interface QualityHeatmapResult extends QualityResult {
    radar_labels: string[];
    radar_values: number[];
    health_status: "healthy" | "degraded" | "critical";
}
export declare function computeQualityHeatmap(context?: string, query?: string): Promise<QualityHeatmapResult>;
