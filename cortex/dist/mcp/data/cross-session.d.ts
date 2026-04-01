/**
 * Cross-Session Analytics — Aggregate data across multiple sessions
 *
 * Aggregates historical data for trend analysis.
 * Enables historical comparison of tokens, cost, and tool usage.
 */
export interface SessionSummary {
    session_id: string;
    start_ts: string;
    end_ts: string;
    duration_minutes: number;
    total_tokens: number;
    cost_usd: number;
    tool_count: number;
    event_count: number;
    model_mix: Record<string, number>;
    session_type?: "startup" | "resume" | "compact" | "clear";
    first_turn_tokens?: number;
    cache_miss_detected?: boolean;
    cache_savings_est?: number;
}
export interface TrendData {
    sessions: SessionSummary[];
    avg_tokens: number;
    avg_cost: number;
    avg_duration: number;
    token_trend: "up" | "down" | "stable";
    cost_trend: "up" | "down" | "stable";
    resume_session_count: number;
    avg_resume_overhead_usd: number;
    total_cache_savings_est: number;
    cache_efficiency_trend: "improving" | "degrading" | "stable";
}
/**
 * Parse all sessions from the journal and compute per-session summaries.
 */
export declare function getAllSessionSummaries(knowledgeDir?: string): SessionSummary[];
/**
 * Compute trends across sessions (direction based on last 3 vs overall average).
 */
export declare function computeTrends(summaries: SessionSummary[]): TrendData;
