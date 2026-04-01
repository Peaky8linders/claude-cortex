/**
 * Cache Analyzer — Detect cache anomalies and generate cost optimization recommendations
 *
 * Since hooks cannot intercept API response headers, cache behavior is inferred
 * from observable signals: per-turn token counts, session types, and cost spikes.
 * A first turn > 3x the average of subsequent turns is a strong proxy for cache miss.
 */
import { type JournalEntry } from "./session-reader.js";
import type { SessionSummary } from "./cross-session.js";
export interface CacheEfficiencyReport {
    session_type: string;
    total_turns: number;
    first_turn_tokens: number;
    avg_subsequent_turn_tokens: number;
    first_turn_cost_ratio: number;
    cache_miss_detected: boolean;
    estimated_cache_savings_usd: number;
    estimated_cache_waste_usd: number;
    cache_efficiency_pct: number;
    recommendations: string[];
}
export interface SentinelRiskReport {
    risk_level: "none" | "low" | "high";
    indicators: string[];
    recommendation: string;
}
export interface OptimalSessionLength {
    optimal_minutes: number;
    cost_per_token_at_optimal: number;
    current_avg_minutes: number;
    recommendation: string;
}
/**
 * Analyze cache efficiency for the current or specified session.
 */
export declare function analyzeCacheEfficiency(sessionId?: string, knowledgeDir?: string): CacheEfficiencyReport;
/**
 * Scan journal entries for patterns that suggest sentinel bug risk.
 * The sentinel bug triggers when billing-related strings appear in conversation
 * content, causing the cache prefix to change on every request.
 *
 * Note: hooks cannot see actual conversation content, only tool names and types.
 * This is a best-effort heuristic based on CC-related tool interactions.
 */
export declare function detectSentinelRisk(entries: JournalEntry[]): SentinelRiskReport;
/**
 * Analyze historical sessions to find the duration where cost-per-token is minimized.
 * Longer sessions benefit from cache hits, but compaction events reset the cache.
 */
export declare function computeOptimalSessionLength(summaries: SessionSummary[]): OptimalSessionLength;
