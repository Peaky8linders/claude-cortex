/**
 * Cost Tracker — Model-aware USD cost computation
 *
 * Inspired by Dynatrace's claude_code.cost.usage metric.
 * Computes per-model costs from token estimates using current pricing.
 */
import { type JournalEntry } from "./session-reader.js";
export interface ModelPricing {
    input_per_m: number;
    output_per_m: number;
}
/** Current Claude model pricing (USD per 1M tokens) */
export declare const MODEL_PRICING: Record<string, ModelPricing>;
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
