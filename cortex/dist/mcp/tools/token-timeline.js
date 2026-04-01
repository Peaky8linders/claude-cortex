/**
 * Token Timeline Tool — Time-series token consumption with spike detection
 */
import { getSessionEntries, estimateTokensForEntry, groupByPromptTurn } from "../data/session-reader.js";
import { computeSessionCost, detectCacheAnomaly, estimateCacheAwareCost } from "../data/cost-tracker.js";
export function computeTokenTimeline(sessionId, windowMinutes = 60, knowledgeDir) {
    const session = getSessionEntries(sessionId, knowledgeDir);
    const entries = session.entries.filter(e => e.type !== "session_start" && e.type !== "session_end");
    if (entries.length === 0) {
        return {
            timeline: [],
            spikes: [],
            summary: {
                total_tokens: 0,
                duration_minutes: 0,
                avg_tokens_per_minute: 0,
                peak_tokens_per_minute: 0,
                peak_time: "",
                estimated_cost: 0,
                by_tool: {},
            },
        };
    }
    // Parse timestamps and compute minute offsets
    const startTime = new Date(session.start?.ts ?? entries[0].ts).getTime();
    const endTime = new Date(session.end?.ts ?? entries[entries.length - 1].ts).getTime();
    // Bucket entries by minute
    const bucketMap = new Map();
    for (const entry of entries) {
        const entryTime = new Date(entry.ts).getTime();
        const minuteBucket = Math.floor((entryTime - startTime) / 60_000);
        if (minuteBucket < 0 || minuteBucket > windowMinutes)
            continue;
        if (!bucketMap.has(minuteBucket)) {
            bucketMap.set(minuteBucket, { tokens: 0, tool_counts: {}, entries: [] });
        }
        const bucket = bucketMap.get(minuteBucket);
        const tokens = estimateTokensForEntry(entry);
        bucket.tokens += tokens;
        const toolName = entry.tool ?? entry.type;
        bucket.tool_counts[toolName] = (bucket.tool_counts[toolName] ?? 0) + 1;
        bucket.entries.push(entry);
    }
    // Build timeline
    let cumulative = 0;
    const timeline = [];
    const byTool = {};
    // Fill in all minutes (including empty ones for visualization)
    const maxMinute = Math.min(windowMinutes, Math.floor((endTime - startTime) / 60_000));
    for (let m = 0; m <= maxMinute; m++) {
        const bucket = bucketMap.get(m);
        const tokens = bucket?.tokens ?? 0;
        cumulative += tokens;
        // Find dominant tool
        let dominantTool = "idle";
        if (bucket?.tool_counts) {
            const sorted = Object.entries(bucket.tool_counts).sort((a, b) => b[1] - a[1]);
            if (sorted.length > 0)
                dominantTool = sorted[0][0];
            for (const [tool, count] of Object.entries(bucket.tool_counts)) {
                byTool[tool] = (byTool[tool] ?? 0) + count;
            }
        }
        const bucketTs = new Date(startTime + m * 60_000).toISOString();
        timeline.push({
            ts: bucketTs,
            minute_bucket: m,
            tokens_in: tokens,
            cumulative,
            tool: dominantTool,
            event_count: bucket?.entries.length ?? 0,
        });
    }
    // Detect spikes (>2x rolling 5-minute average)
    const spikes = [];
    const WINDOW = 5;
    for (let i = WINDOW; i < timeline.length; i++) {
        const windowTokens = timeline.slice(i - WINDOW, i).reduce((a, b) => a + b.tokens_in, 0);
        const avgTokens = windowTokens / WINDOW;
        if (timeline[i].tokens_in > avgTokens * 2 && timeline[i].tokens_in > 100) {
            // Find the dominant tool that caused the spike
            const bucket = bucketMap.get(timeline[i].minute_bucket);
            const cause = bucket?.entries
                .sort((a, b) => estimateTokensForEntry(b) - estimateTokensForEntry(a))
                .map(e => `${e.tool ?? e.type}`)
                .slice(0, 2)
                .join(", ") ?? "unknown";
            spikes.push({
                ts: timeline[i].ts,
                tokens: timeline[i].tokens_in,
                cause: `Spike from: ${cause}`,
                minute_bucket: timeline[i].minute_bucket,
            });
        }
    }
    // Summary
    const durationMinutes = Math.max(1, Math.floor((endTime - startTime) / 60_000));
    const totalTokens = cumulative;
    const peakBucket = timeline.reduce((a, b) => b.tokens_in > a.tokens_in ? b : a, timeline[0]);
    // Model-aware cost (defaults to sonnet pricing for entries without model field)
    const sessionCost = computeSessionCost(entries);
    // Cache efficiency analysis
    const sessionType = session.session_type ?? session.start?.session_type ?? "startup";
    const anomaly = detectCacheAnomaly(entries, sessionType);
    const cacheAware = estimateCacheAwareCost(entries, sessionType);
    // Annotate cache-related spikes (spikes on first turn of resume sessions)
    const turns = groupByPromptTurn(entries);
    const firstTurnTs = turns.length > 0 && turns[0].length > 0
        ? new Date(turns[0][0].ts).getTime()
        : 0;
    for (const spike of spikes) {
        const spikeTime = new Date(spike.ts).getTime();
        // If spike is within 1 minute of first turn and session is resume, it's cache-related
        if (sessionType === "resume" && Math.abs(spikeTime - firstTurnTs) < 60_000) {
            spike.cache_related = true;
            spike.cause = `${spike.cause} (likely cache miss on resume)`;
        }
    }
    return {
        timeline,
        spikes,
        summary: {
            total_tokens: totalTokens,
            duration_minutes: durationMinutes,
            avg_tokens_per_minute: Math.round(totalTokens / durationMinutes),
            peak_tokens_per_minute: peakBucket?.tokens_in ?? 0,
            peak_time: peakBucket?.ts ?? "",
            estimated_cost: sessionCost.total_usd,
            by_tool: byTool,
            cost_by_model: Object.keys(sessionCost.by_model).length > 0 ? sessionCost.by_model : undefined,
            cache_efficiency: {
                session_type: sessionType,
                first_turn_ratio: anomaly.ratio,
                cache_miss_detected: anomaly.detected,
                estimated_savings_usd: cacheAware.cache_savings_est,
                cache_hit_ratio_est: cacheAware.cache_hit_ratio_est,
            },
        },
    };
}
