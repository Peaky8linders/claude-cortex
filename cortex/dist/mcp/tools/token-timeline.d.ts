/**
 * Token Timeline Tool — Time-series token consumption with spike detection
 */
export interface TimelineBucket {
    ts: string;
    minute_bucket: number;
    tokens_in: number;
    cumulative: number;
    tool: string;
    event_count: number;
}
export interface Spike {
    ts: string;
    tokens: number;
    cause: string;
    minute_bucket: number;
    cache_related?: boolean;
}
export interface CacheEfficiencySummary {
    session_type: string;
    first_turn_ratio: number;
    cache_miss_detected: boolean;
    estimated_savings_usd: number;
    cache_hit_ratio_est: number;
}
export interface TokenSummary {
    total_tokens: number;
    duration_minutes: number;
    avg_tokens_per_minute: number;
    peak_tokens_per_minute: number;
    peak_time: string;
    estimated_cost: number;
    by_tool: Record<string, number>;
    cost_by_model?: Record<string, {
        tokens: number;
        cost_usd: number;
    }>;
    cache_efficiency?: CacheEfficiencySummary;
}
export interface TokenTimelineResult {
    timeline: TimelineBucket[];
    spikes: Spike[];
    summary: TokenSummary;
}
export declare function computeTokenTimeline(sessionId?: string, windowMinutes?: number, knowledgeDir?: string): TokenTimelineResult;
