/**
 * Cross-Session Analytics — Aggregate data across multiple sessions
 *
 * Aggregates historical data for trend analysis.
 * Enables historical comparison of tokens, cost, and tool usage.
 */
import { readJournal, parseSessionBoundaries, estimateTokensForEntry } from "./session-reader.js";
import { estimateCost, normalizeModel, detectCacheAnomaly, estimateCacheAwareCost, MODEL_PRICING } from "./cost-tracker.js";
/**
 * Parse all sessions from the journal and compute per-session summaries.
 */
export function getAllSessionSummaries(knowledgeDir) {
    const all = readJournal(knowledgeDir);
    const sessions = parseSessionBoundaries(all);
    if (sessions.length === 0)
        return [];
    return sessions.map(s => {
        const toolEntries = s.entries.filter(e => e.type !== "session_start" && e.type !== "session_end");
        const startTs = s.start?.ts ?? toolEntries[0]?.ts ?? "";
        const endTs = s.end?.ts ?? toolEntries[toolEntries.length - 1]?.ts ?? startTs;
        const startTime = new Date(startTs).getTime();
        const endTime = new Date(endTs).getTime();
        let totalTokens = 0;
        let totalCost = 0;
        const modelMix = {};
        for (const entry of toolEntries) {
            const tokens = estimateTokensForEntry(entry);
            totalTokens += tokens;
            totalCost += estimateCost(tokens, entry.model);
            const model = normalizeModel(entry.model);
            modelMix[model] = (modelMix[model] ?? 0) + tokens;
        }
        // Cache-aware metrics
        const sessionType = s.session_type ?? s.start?.session_type;
        const anomaly = detectCacheAnomaly(toolEntries, sessionType);
        const cacheAware = estimateCacheAwareCost(toolEntries, sessionType);
        return {
            session_id: s.start?.sid ?? s.entries[0]?.sid ?? "unknown",
            start_ts: startTs,
            end_ts: endTs,
            duration_minutes: Math.max(1, Math.round((endTime - startTime) / 60_000)),
            total_tokens: totalTokens,
            cost_usd: totalCost,
            tool_count: new Set(toolEntries.map(e => e.tool ?? e.type)).size,
            event_count: toolEntries.length,
            model_mix: modelMix,
            session_type: sessionType,
            first_turn_tokens: anomaly.first_turn_tokens,
            cache_miss_detected: anomaly.detected,
            cache_savings_est: cacheAware.cache_savings_est,
        };
    }).filter(s => s.event_count > 0);
}
/**
 * Compute trends across sessions (direction based on last 3 vs overall average).
 */
export function computeTrends(summaries) {
    if (summaries.length === 0) {
        return {
            sessions: [],
            avg_tokens: 0,
            avg_cost: 0,
            avg_duration: 0,
            token_trend: "stable",
            cost_trend: "stable",
            resume_session_count: 0,
            avg_resume_overhead_usd: 0,
            total_cache_savings_est: 0,
            cache_efficiency_trend: "stable",
        };
    }
    const avgTokens = summaries.reduce((a, s) => a + s.total_tokens, 0) / summaries.length;
    const avgCost = summaries.reduce((a, s) => a + s.cost_usd, 0) / summaries.length;
    const avgDuration = summaries.reduce((a, s) => a + s.duration_minutes, 0) / summaries.length;
    // Compare last 3 sessions to overall average for trend
    const recent = summaries.slice(-3);
    const recentAvgTokens = recent.reduce((a, s) => a + s.total_tokens, 0) / recent.length;
    const recentAvgCost = recent.reduce((a, s) => a + s.cost_usd, 0) / recent.length;
    const THRESHOLD = 0.15; // 15% change = trend
    // Cache-aware trends
    const resumeSessions = summaries.filter(s => s.session_type === "resume");
    const resumeCount = resumeSessions.length;
    const resumeWithMiss = resumeSessions.filter(s => s.cache_miss_detected);
    const avgResumeOverhead = resumeWithMiss.length > 0
        ? resumeWithMiss.reduce((a, s) => {
            // Estimate overhead as excess first-turn tokens at input pricing (use dominant model or sonnet default)
            const modelKey = Object.keys(s.model_mix).sort((a, b) => (s.model_mix[b] ?? 0) - (s.model_mix[a] ?? 0))[0] ?? "sonnet";
            const inputRate = (MODEL_PRICING[modelKey] ?? MODEL_PRICING.sonnet).input_per_m;
            const excess = (s.first_turn_tokens ?? 0) * 0.7 / 1_000_000 * inputRate;
            return a + excess;
        }, 0) / resumeWithMiss.length
        : 0;
    const totalSavings = summaries.reduce((a, s) => a + (s.cache_savings_est ?? 0), 0);
    // Cache efficiency trend: compare recent savings rate to overall
    const recentSavings = recent.reduce((a, s) => a + (s.cache_savings_est ?? 0), 0) / recent.length;
    const overallSavings = totalSavings / summaries.length;
    return {
        sessions: summaries,
        avg_tokens: Math.round(avgTokens),
        avg_cost: avgCost,
        avg_duration: Math.round(avgDuration),
        token_trend: detectTrend(recentAvgTokens, avgTokens, THRESHOLD),
        cost_trend: detectTrend(recentAvgCost, avgCost, THRESHOLD),
        resume_session_count: resumeCount,
        avg_resume_overhead_usd: avgResumeOverhead,
        total_cache_savings_est: totalSavings,
        cache_efficiency_trend: overallSavings === 0 ? "stable"
            : recentSavings > overallSavings * (1 + THRESHOLD) ? "improving"
                : recentSavings < overallSavings * (1 - THRESHOLD) ? "degrading"
                    : "stable",
    };
}
function detectTrend(recent, overall, threshold) {
    if (overall === 0)
        return "stable";
    const ratio = recent / overall;
    if (ratio > 1 + threshold)
        return "up";
    if (ratio < 1 - threshold)
        return "down";
    return "stable";
}
