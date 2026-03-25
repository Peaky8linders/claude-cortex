/**
 * Cross-Session Analytics — Aggregate data across multiple sessions
 *
 * Inspired by Dynatrace's cross-session trend dashboards.
 * Enables historical comparison of tokens, cost, and tool usage.
 */

import { readJournal, parseSessionBoundaries, estimateTokensForEntry, type JournalEntry } from "./session-reader.js";
import { estimateCost, normalizeModel } from "./cost-tracker.js";

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
}

export interface TrendData {
  sessions: SessionSummary[];
  avg_tokens: number;
  avg_cost: number;
  avg_duration: number;
  token_trend: "up" | "down" | "stable";
  cost_trend: "up" | "down" | "stable";
}

/**
 * Parse all sessions from the journal and compute per-session summaries.
 */
export function getAllSessionSummaries(knowledgeDir?: string): SessionSummary[] {
  const all = readJournal(knowledgeDir);
  const sessions = parseSessionBoundaries(all);

  if (sessions.length === 0) return [];

  return sessions.map(s => {
    const toolEntries = s.entries.filter(
      e => e.type !== "session_start" && e.type !== "session_end"
    );

    const startTs = s.start?.ts ?? toolEntries[0]?.ts ?? "";
    const endTs = s.end?.ts ?? toolEntries[toolEntries.length - 1]?.ts ?? startTs;
    const startTime = new Date(startTs).getTime();
    const endTime = new Date(endTs).getTime();

    let totalTokens = 0;
    let totalCost = 0;
    const modelMix: Record<string, number> = {};

    for (const entry of toolEntries) {
      const tokens = estimateTokensForEntry(entry);
      totalTokens += tokens;
      totalCost += estimateCost(tokens, entry.model);

      const model = normalizeModel(entry.model);
      modelMix[model] = (modelMix[model] ?? 0) + tokens;
    }

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
    };
  }).filter(s => s.event_count > 0);
}

/**
 * Compute trends across sessions (direction based on last 3 vs overall average).
 */
export function computeTrends(summaries: SessionSummary[]): TrendData {
  if (summaries.length === 0) {
    return {
      sessions: [],
      avg_tokens: 0,
      avg_cost: 0,
      avg_duration: 0,
      token_trend: "stable",
      cost_trend: "stable",
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

  return {
    sessions: summaries,
    avg_tokens: Math.round(avgTokens),
    avg_cost: avgCost,
    avg_duration: Math.round(avgDuration),
    token_trend: detectTrend(recentAvgTokens, avgTokens, THRESHOLD),
    cost_trend: detectTrend(recentAvgCost, avgCost, THRESHOLD),
  };
}

function detectTrend(recent: number, overall: number, threshold: number): "up" | "down" | "stable" {
  if (overall === 0) return "stable";
  const ratio = recent / overall;
  if (ratio > 1 + threshold) return "up";
  if (ratio < 1 - threshold) return "down";
  return "stable";
}
