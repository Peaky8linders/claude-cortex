/**
 * Cache Analyzer — Detect cache anomalies and generate cost optimization recommendations
 *
 * Since hooks cannot intercept API response headers, cache behavior is inferred
 * from observable signals: per-turn token counts, session types, and cost spikes.
 * A first turn > 3x the average of subsequent turns is a strong proxy for cache miss.
 */
import { getKnowledgeDir, readJournal, parseSessionBoundaries, groupByPromptTurn, } from "./session-reader.js";
import { estimateCacheAwareCost, detectCacheAnomaly, } from "./cost-tracker.js";
// ── Per-Turn Data ──
// ── Cache Efficiency Analysis ──
/**
 * Analyze cache efficiency for the current or specified session.
 */
export function analyzeCacheEfficiency(sessionId, knowledgeDir) {
    const dir = knowledgeDir ?? getKnowledgeDir();
    const all = readJournal(dir);
    const sessions = parseSessionBoundaries(all);
    if (sessions.length === 0) {
        return emptyReport();
    }
    // Find the target session
    const session = sessionId
        ? sessions.find(s => s.start?.sid === sessionId || s.entries.some(e => e.sid === sessionId))
        : sessions[sessions.length - 1];
    if (!session || session.entries.length === 0) {
        return emptyReport();
    }
    const sessionType = session.session_type ?? session.start?.session_type ?? "startup";
    const anomaly = detectCacheAnomaly(session.entries, sessionType);
    const cacheAware = estimateCacheAwareCost(session.entries, sessionType);
    const turns = groupByPromptTurn(session.entries);
    const efficiency = cacheAware.cost_no_cache > 0
        ? (cacheAware.cache_savings_est / cacheAware.cost_no_cache) * 100
        : 0;
    const recommendations = generateCostRecommendations(anomaly, sessionType, turns.length, cacheAware);
    return {
        session_type: sessionType,
        total_turns: turns.length,
        first_turn_tokens: anomaly.first_turn_tokens,
        avg_subsequent_turn_tokens: anomaly.avg_subsequent_tokens,
        first_turn_cost_ratio: anomaly.ratio,
        cache_miss_detected: anomaly.detected,
        estimated_cache_savings_usd: cacheAware.cache_savings_est,
        estimated_cache_waste_usd: anomaly.estimated_excess_cost,
        cache_efficiency_pct: Math.round(efficiency),
        recommendations,
    };
}
// ── Sentinel Risk Detection ──
/**
 * Scan journal entries for patterns that suggest sentinel bug risk.
 * The sentinel bug triggers when billing-related strings appear in conversation
 * content, causing the cache prefix to change on every request.
 *
 * Note: hooks cannot see actual conversation content, only tool names and types.
 * This is a best-effort heuristic based on CC-related tool interactions.
 */
export function detectSentinelRisk(entries) {
    const indicators = [];
    // Heuristic: if session has tool ops on CC-related paths, flag risk
    for (const entry of entries) {
        const toolLower = (entry.tool ?? "").toLowerCase();
        if (toolLower.includes("cli.js") || toolLower.includes("claude-code")) {
            indicators.push(`Tool interaction with CC internals: ${entry.tool}`);
        }
    }
    if (indicators.length === 0) {
        return {
            risk_level: "none",
            indicators: [],
            recommendation: "",
        };
    }
    const riskLevel = indicators.length >= 3 ? "high" : "low";
    return {
        risk_level: riskLevel,
        indicators,
        recommendation: riskLevel === "high"
            ? "High sentinel risk: conversation may discuss CC billing internals. Consider using `npx @anthropic-ai/claude-code` instead of the standalone binary to avoid cache prefix corruption."
            : "Low sentinel risk: some CC-related tool interactions detected. Monitor cache costs.",
    };
}
// ── Optimal Session Length ──
/**
 * Analyze historical sessions to find the duration where cost-per-token is minimized.
 * Longer sessions benefit from cache hits, but compaction events reset the cache.
 */
export function computeOptimalSessionLength(summaries) {
    if (summaries.length < 3) {
        return {
            optimal_minutes: 30,
            cost_per_token_at_optimal: 0,
            current_avg_minutes: summaries.length > 0
                ? Math.round(summaries.reduce((a, s) => a + s.duration_minutes, 0) / summaries.length)
                : 0,
            recommendation: "Not enough session history (need 3+) for optimal length analysis.",
        };
    }
    // Bucket sessions by duration ranges and compute cost-per-token
    const buckets = {
        "short": { totalCost: 0, totalTokens: 0, count: 0 }, // <15 min
        "medium": { totalCost: 0, totalTokens: 0, count: 0 }, // 15-45 min
        "long": { totalCost: 0, totalTokens: 0, count: 0 }, // 45-90 min
        "extended": { totalCost: 0, totalTokens: 0, count: 0 }, // >90 min
    };
    for (const s of summaries) {
        const bucket = s.duration_minutes < 15 ? "short"
            : s.duration_minutes < 45 ? "medium"
                : s.duration_minutes < 90 ? "long"
                    : "extended";
        buckets[bucket].totalCost += s.cost_usd;
        buckets[bucket].totalTokens += s.total_tokens;
        buckets[bucket].count++;
    }
    // Find bucket with best cost-per-token ratio
    let bestBucket = "medium";
    let bestCPT = Infinity;
    for (const [name, b] of Object.entries(buckets)) {
        if (b.count > 0 && b.totalTokens > 0) {
            const cpt = b.totalCost / b.totalTokens;
            if (cpt < bestCPT) {
                bestCPT = cpt;
                bestBucket = name;
            }
        }
    }
    const optimalMinutes = bestBucket === "short" ? 10
        : bestBucket === "medium" ? 30
            : bestBucket === "long" ? 60
                : 90;
    const currentAvg = Math.round(summaries.reduce((a, s) => a + s.duration_minutes, 0) / summaries.length);
    const recommendation = currentAvg > optimalMinutes * 1.5
        ? `Your sessions average ${currentAvg}min but ${optimalMinutes}min shows best cost/token ratio. Consider splitting long sessions.`
        : currentAvg < optimalMinutes * 0.5
            ? `Your sessions average ${currentAvg}min. Slightly longer sessions (${optimalMinutes}min) would improve cache utilization.`
            : `Session length (avg ${currentAvg}min) is near optimal (${optimalMinutes}min) for cost efficiency.`;
    return {
        optimal_minutes: optimalMinutes,
        cost_per_token_at_optimal: bestCPT,
        current_avg_minutes: currentAvg,
        recommendation,
    };
}
// ── Recommendation Generation ──
function generateCostRecommendations(anomaly, sessionType, turnCount, cacheAware) {
    const recs = [];
    if (anomaly.detected && sessionType === "resume") {
        recs.push(`Resume cache miss detected: first turn used ${anomaly.first_turn_tokens} tokens vs avg ${anomaly.avg_subsequent_tokens} (~$${anomaly.estimated_excess_cost.toFixed(4)} excess). Consider starting fresh for small tasks.`);
    }
    if (anomaly.detected && sessionType !== "resume") {
        recs.push(`First-turn spike detected (${anomaly.ratio}x average). This may indicate a compaction event or large initial context. Check for unnecessary context in system prompt.`);
    }
    if (turnCount < 3) {
        recs.push("Very short session (<3 turns). Cache benefits increase with session length — batch related tasks into fewer sessions.");
    }
    if (cacheAware.cache_savings_est > 0.01) {
        recs.push(`Estimated cache savings this session: $${cacheAware.cache_savings_est.toFixed(4)} (${Math.round((cacheAware.cache_savings_est / cacheAware.cost_no_cache) * 100)}% of uncached cost).`);
    }
    if (sessionType === "resume" && !anomaly.detected && turnCount > 2) {
        recs.push("Resume session with good cache behavior after first turn. Cache is working normally.");
    }
    return recs;
}
function emptyReport() {
    return {
        session_type: "unknown",
        total_turns: 0,
        first_turn_tokens: 0,
        avg_subsequent_turn_tokens: 0,
        first_turn_cost_ratio: 0,
        cache_miss_detected: false,
        estimated_cache_savings_usd: 0,
        estimated_cache_waste_usd: 0,
        cache_efficiency_pct: 0,
        recommendations: ["No session data available."],
    };
}
