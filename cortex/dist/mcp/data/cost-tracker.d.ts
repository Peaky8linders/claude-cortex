/**
 * Cost Tracker — Model-aware USD cost computation with cache awareness
 *
 * Tracks per-model token costs across sessions.
 * Computes per-model costs from token estimates using current pricing.
 * Models prompt cache behavior to estimate savings and detect anomalies.
 */
import { type JournalEntry } from "./session-reader.js";
export interface ModelPricing {
    input_per_m: number;
    output_per_m: number;
}
/** Current Claude model pricing (USD per 1M tokens) */
export declare const MODEL_PRICING: Record<string, ModelPricing>;
/** Cache pricing multipliers (relative to base input price) */
export declare const CACHE_WRITE_MULTIPLIER = 1.25;
export declare const CACHE_READ_MULTIPLIER = 0.1;
/** Estimated fraction of input tokens that are static (system prompt + tool defs) */
export declare const STATIC_CONTENT_RATIO = 0.35;
/**
 * Estimate USD cost for a token count on a given model.
 * Assumes 70/30 input/output split since hooks capture total tokens only.
 */
export declare function estimateCost(tokensEst: number, model?: string): number;
export interface SessionCostSummary {
    total_usd: number;
    total_tokens: number;
    by_model: Record<string, {
        tokens: number;
        cost_usd: number;
    }>;
}
/**
 * Compute session cost from journal entries, broken down by model.
 */
export declare function computeSessionCost(entries: JournalEntry[]): SessionCostSummary;
/**
 * Normalize model name to a pricing key.
 * Handles variants like "claude-opus-4-6", "opus", "claude-sonnet-4-6-20250514", etc.
 */
export declare function normalizeModel(model?: string): string;
export interface CacheAwareCost {
    cost_no_cache: number;
    cost_with_cache: number;
    cache_savings_est: number;
    cache_hit_ratio_est: number;
}
/**
 * Estimate cache-adjusted costs for a session.
 *
 * Prompt caching works: first request writes the cache (1.25x input cost for
 * static portion), subsequent requests read it (0.1x). On resume, the first
 * request is a full cache miss (1.0x input) because the message prefix changes.
 *
 * @param entries - Session journal entries
 * @param sessionType - "startup" | "resume" | "compact" | "clear"
 */
export declare function estimateCacheAwareCost(entries: JournalEntry[], sessionType?: string): CacheAwareCost;
export interface CacheAnomaly {
    detected: boolean;
    first_turn_tokens: number;
    avg_subsequent_tokens: number;
    ratio: number;
    estimated_excess_cost: number;
    session_type?: string;
}
/**
 * Detect likely cache misses by comparing first-turn token count to subsequent turns.
 * A first turn > 3x the average of turns 2-N is a strong proxy for cache rebuild.
 */
export declare function detectCacheAnomaly(entries: JournalEntry[], sessionType?: string): CacheAnomaly;
