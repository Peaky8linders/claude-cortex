/**
 * Cost Tracker — Model-aware USD cost computation with cache awareness
 *
 * Tracks per-model token costs across sessions.
 * Computes per-model costs from token estimates using current pricing.
 * Models prompt cache behavior to estimate savings and detect anomalies.
 */

import { type JournalEntry, estimateTokensForEntry, groupByPromptTurn } from "./session-reader.js";

export interface ModelPricing {
  input_per_m: number;   // $ per 1M input tokens
  output_per_m: number;  // $ per 1M output tokens
}

/** Current Claude model pricing (USD per 1M tokens) */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  opus:   { input_per_m: 15,    output_per_m: 75 },
  sonnet: { input_per_m: 3,     output_per_m: 15 },
  haiku:  { input_per_m: 0.25,  output_per_m: 1.25 },
};

/** Cache pricing multipliers (relative to base input price) */
export const CACHE_WRITE_MULTIPLIER = 1.25;
export const CACHE_READ_MULTIPLIER = 0.10;

/** Estimated fraction of input tokens that are static (system prompt + tool defs) */
export const STATIC_CONTENT_RATIO = 0.35;

/** Default model when none specified (most common in typical sessions) */
const DEFAULT_MODEL = "sonnet";

/** Assumed input/output token split (tool-heavy sessions skew toward input) */
const INPUT_RATIO = 0.7;
const OUTPUT_RATIO = 0.3;

/** Anomaly threshold: first turn > N times average of subsequent turns */
const CACHE_MISS_THRESHOLD = 3.0;

/**
 * Estimate USD cost for a token count on a given model.
 * Assumes 70/30 input/output split since hooks capture total tokens only.
 */
export function estimateCost(tokensEst: number, model?: string): number {
  const pricing = MODEL_PRICING[normalizeModel(model)] ?? MODEL_PRICING[DEFAULT_MODEL];
  const inputCost = (tokensEst * INPUT_RATIO / 1_000_000) * pricing.input_per_m;
  const outputCost = (tokensEst * OUTPUT_RATIO / 1_000_000) * pricing.output_per_m;
  return inputCost + outputCost;
}

export interface SessionCostSummary {
  total_usd: number;
  total_tokens: number;
  by_model: Record<string, { tokens: number; cost_usd: number }>;
}

/**
 * Compute session cost from journal entries, broken down by model.
 */
export function computeSessionCost(entries: JournalEntry[]): SessionCostSummary {
  const byModel: Record<string, { tokens: number; cost_usd: number }> = {};
  let totalTokens = 0;
  let totalCost = 0;

  for (const entry of entries) {
    if (entry.type === "session_start" || entry.type === "session_end") continue;

    const tokens = estimateTokensForEntry(entry);
    const model = normalizeModel(entry.model);
    const cost = estimateCost(tokens, model);

    if (!byModel[model]) byModel[model] = { tokens: 0, cost_usd: 0 };
    byModel[model].tokens += tokens;
    byModel[model].cost_usd += cost;

    totalTokens += tokens;
    totalCost += cost;
  }

  return { total_usd: totalCost, total_tokens: totalTokens, by_model: byModel };
}

/**
 * Normalize model name to a pricing key.
 * Handles variants like "claude-opus-4-6", "opus", "claude-sonnet-4-6-20250514", etc.
 */
export function normalizeModel(model?: string): string {
  if (!model || model === "unknown") return DEFAULT_MODEL;
  const lower = model.toLowerCase();
  if (lower.includes("opus")) return "opus";
  if (lower.includes("haiku")) return "haiku";
  if (lower.includes("sonnet")) return "sonnet";
  return DEFAULT_MODEL;
}

// ── Cache-Aware Cost Estimation ──

export interface CacheAwareCost {
  cost_no_cache: number;        // total if no caching existed
  cost_with_cache: number;      // estimated actual cost with cache behavior
  cache_savings_est: number;    // dollars saved by caching
  cache_hit_ratio_est: number;  // 0-1, estimated ratio of cache hits
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
export function estimateCacheAwareCost(
  entries: JournalEntry[],
  sessionType?: string,
): CacheAwareCost {
  const turns = groupByPromptTurn(entries);
  if (turns.length === 0) {
    return { cost_no_cache: 0, cost_with_cache: 0, cache_savings_est: 0, cache_hit_ratio_est: 0 };
  }

  const model = entries.find(e => e.model)?.model;
  const pricing = MODEL_PRICING[normalizeModel(model)] ?? MODEL_PRICING[DEFAULT_MODEL];

  let costNoCache = 0;
  let costWithCache = 0;

  for (let i = 0; i < turns.length; i++) {
    const turnTokens = turns[i].reduce((sum, e) => sum + estimateTokensForEntry(e), 0);
    const inputTokens = turnTokens * INPUT_RATIO;
    const outputTokens = turnTokens * OUTPUT_RATIO;
    const staticTokens = inputTokens * STATIC_CONTENT_RATIO;
    const dynamicTokens = inputTokens - staticTokens;

    // No-cache baseline: full input price for everything
    const turnNoCacheCost =
      (inputTokens / 1_000_000) * pricing.input_per_m +
      (outputTokens / 1_000_000) * pricing.output_per_m;
    costNoCache += turnNoCacheCost;

    // Cache-aware cost depends on turn position and session type
    let inputCost: number;
    const isFirstTurn = i === 0;
    const isCacheInvalidated = sessionType === "resume" || sessionType === "compact";

    if (isFirstTurn && isCacheInvalidated) {
      // Resume or compact: first turn is full cache miss — no read savings, full write
      inputCost = (inputTokens / 1_000_000) * pricing.input_per_m * CACHE_WRITE_MULTIPLIER;
    } else if (isFirstTurn) {
      // Fresh start: first turn writes cache (1.25x for static, 1.0x for dynamic)
      inputCost =
        (staticTokens / 1_000_000) * pricing.input_per_m * CACHE_WRITE_MULTIPLIER +
        (dynamicTokens / 1_000_000) * pricing.input_per_m;
    } else {
      // Subsequent turns: read cached static (0.1x), full price for dynamic
      inputCost =
        (staticTokens / 1_000_000) * pricing.input_per_m * CACHE_READ_MULTIPLIER +
        (dynamicTokens / 1_000_000) * pricing.input_per_m;
    }

    const outputCost = (outputTokens / 1_000_000) * pricing.output_per_m;
    costWithCache += inputCost + outputCost;
  }

  const savings = costNoCache - costWithCache;
  const hitRatio = turns.length > 1
    ? (turns.length - 1) / turns.length  // all turns after first are hits
    : 0;

  return {
    cost_no_cache: costNoCache,
    cost_with_cache: costWithCache,
    cache_savings_est: Math.max(0, savings),
    cache_hit_ratio_est: hitRatio,
  };
}

// ── Cache Anomaly Detection ──

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
export function detectCacheAnomaly(
  entries: JournalEntry[],
  sessionType?: string,
): CacheAnomaly {
  const turns = groupByPromptTurn(entries);

  if (turns.length < 2) {
    return {
      detected: false,
      first_turn_tokens: turns.length > 0
        ? turns[0].reduce((s, e) => s + estimateTokensForEntry(e), 0)
        : 0,
      avg_subsequent_tokens: 0,
      ratio: 0,
      estimated_excess_cost: 0,
      session_type: sessionType,
    };
  }

  const firstTurnTokens = turns[0].reduce((s, e) => s + estimateTokensForEntry(e), 0);
  const subsequentTokens = turns.slice(1).map(
    turn => turn.reduce((s, e) => s + estimateTokensForEntry(e), 0),
  );
  const avgSubsequent = subsequentTokens.reduce((a, b) => a + b, 0) / subsequentTokens.length;

  const ratio = avgSubsequent > 0 ? firstTurnTokens / avgSubsequent : 0;
  const detected = ratio > CACHE_MISS_THRESHOLD;

  // Excess cost: the first-turn tokens that exceeded the expected average,
  // priced at cache-write rate instead of cache-read rate
  const excessTokens = detected ? firstTurnTokens - avgSubsequent : 0;
  const model = entries.find(e => e.model)?.model;
  const pricing = MODEL_PRICING[normalizeModel(model)] ?? MODEL_PRICING[DEFAULT_MODEL];
  const excessCost = (excessTokens * INPUT_RATIO / 1_000_000) * pricing.input_per_m *
    (CACHE_WRITE_MULTIPLIER - CACHE_READ_MULTIPLIER);

  return {
    detected,
    first_turn_tokens: firstTurnTokens,
    avg_subsequent_tokens: Math.round(avgSubsequent),
    ratio: Math.round(ratio * 100) / 100,
    estimated_excess_cost: Math.round(excessCost * 10000) / 10000,
    session_type: sessionType,
  };
}
