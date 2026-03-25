/**
 * Cost Tracker — Model-aware USD cost computation
 *
 * Tracks per-model token costs across sessions.
 * Computes per-model costs from token estimates using current pricing.
 */

import { type JournalEntry, estimateTokensForEntry } from "./session-reader.js";

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

/** Default model when none specified (most common in typical sessions) */
const DEFAULT_MODEL = "sonnet";

/** Assumed input/output token split (tool-heavy sessions skew toward input) */
const INPUT_RATIO = 0.7;
const OUTPUT_RATIO = 0.3;

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
