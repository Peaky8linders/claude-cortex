/**
 * Quality Bridge — Shell out to Python contextscore for 7-dimension scoring.
 *
 * The Python contextscore module is the single source of truth for quality analysis.
 * This bridge calls it via subprocess and parses the JSON output.
 */
/** Cost per token at $5/1M tokens */
export declare const COST_PER_TOKEN = 0.000005;
export interface QualityDimension {
    score: number;
    weight: number;
    issue_count: number;
    top_issue?: string;
}
export interface QualityEconomics {
    total_tokens: number;
    wasted_tokens: number;
    waste_percentage: number;
    estimated_cost: number;
}
export interface QualityIssue {
    cause: string;
    severity: string;
    category: string;
    fix: string;
    estimated_token_savings: number;
}
export interface QualityResult {
    score: number;
    grade: string;
    dimensions: Record<string, QualityDimension>;
    economics: QualityEconomics;
    issues: QualityIssue[];
}
/**
 * Score context using Python contextscore module.
 * Falls back to a lightweight local analysis if Python is unavailable.
 */
export declare function scoreContext(context: string, query?: string): Promise<QualityResult>;
/**
 * Read the latest context snapshot and score it.
 */
export declare function scoreLatestSnapshot(query?: string): Promise<QualityResult>;
