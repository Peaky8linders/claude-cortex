/**
 * Activity Map Tool — Gantt-like skill/hook/tool activation timeline
 */

import {
  getSessionEntries,
  readSkills,
  type JournalEntry,
} from "../data/session-reader.js";

export interface Activation {
  start: string;
  end: string;
  duration_ms: number;
}

export interface ActivityTrack {
  name: string;
  type: "hook" | "skill" | "tool";
  activations: Activation[];
  total_count: number;
  total_duration_ms: number;
}

export interface ActivityMapResult {
  session_start: string;
  session_end: string;
  duration_minutes: number;
  tracks: ActivityTrack[];
  concurrency_peak: number;
  busiest_period: string;
  tools_summary: Record<string, number>;
  skills_used: string[];
}

/** Pre-parsed entry with cached timestamp for O(1) access */
interface TimedEntry {
  entry: JournalEntry;
  timeMs: number;
}

/**
 * Estimate activation durations using index-based next-event lookup.
 * Entries must be pre-sorted by timeMs.
 */
function estimateActivations(
  timedEntries: TimedEntry[],
  filterFn: (e: JournalEntry) => boolean,
): Activation[] {
  const activations: Activation[] = [];

  for (let i = 0; i < timedEntries.length; i++) {
    if (!filterFn(timedEntries[i].entry)) continue;

    const start = timedEntries[i].timeMs;
    // Next event is simply i+1 (entries are sorted by time)
    const nextTime = i + 1 < timedEntries.length ? timedEntries[i + 1].timeMs : start + 5_000;
    const end = Math.min(nextTime, start + 30_000);

    activations.push({
      start: timedEntries[i].entry.ts,
      end: new Date(end).toISOString(),
      duration_ms: end - start,
    });
  }

  return activations;
}

export function computeActivityMap(
  sessionId?: string,
  includeHooks: boolean = true,
  includeSkills: boolean = true,
  knowledgeDir?: string,
): ActivityMapResult {
  const session = getSessionEntries(sessionId, knowledgeDir);
  const entries = session.entries;
  const startTs = session.start?.ts ?? entries[0]?.ts ?? new Date().toISOString();
  const endTs = session.end?.ts ?? entries[entries.length - 1]?.ts ?? startTs;
  const startTime = new Date(startTs).getTime();
  const endTime = new Date(endTs).getTime();
  const durationMinutes = Math.max(1, Math.floor((endTime - startTime) / 60_000));

  // Pre-parse timestamps once (avoids repeated Date parsing)
  const timedEntries: TimedEntry[] = entries.map(e => ({
    entry: e,
    timeMs: new Date(e.ts).getTime(),
  }));

  const tracks: ActivityTrack[] = [];
  const toolCounts: Record<string, number> = {};

  // Group entries by tool name
  const toolGroups = new Map<string, JournalEntry[]>();
  for (const entry of entries) {
    if (entry.type === "session_start" || entry.type === "session_end") continue;
    const name = entry.tool ?? entry.type;
    toolCounts[name] = (toolCounts[name] ?? 0) + 1;
    if (!toolGroups.has(name)) toolGroups.set(name, []);
    toolGroups.get(name)!.push(entry);
  }

  // Create tool tracks
  for (const [name, groupEntries] of toolGroups) {
    const activations = estimateActivations(timedEntries, e => (e.tool ?? e.type) === name);
    const totalDuration = activations.reduce((a, b) => a + b.duration_ms, 0);

    tracks.push({
      name,
      type: "tool",
      activations,
      total_count: groupEntries.length,
      total_duration_ms: totalDuration,
    });
  }

  // Hook tracks (from event field)
  if (includeHooks) {
    const hookGroups = new Map<string, JournalEntry[]>();
    for (const entry of entries) {
      if (!entry.event) continue;
      const hookName = entry.event;
      if (!hookGroups.has(hookName)) hookGroups.set(hookName, []);
      hookGroups.get(hookName)!.push(entry);
    }

    for (const [name, groupEntries] of hookGroups) {
      // Don't duplicate if same name as a tool track
      if (toolGroups.has(name)) continue;

      const activations = estimateActivations(timedEntries, e => e.event === name);
      tracks.push({
        name,
        type: "hook",
        activations,
        total_count: groupEntries.length,
        total_duration_ms: activations.reduce((a, b) => a + b.duration_ms, 0),
      });
    }
  }

  // Skills used
  const skills = includeSkills ? readSkills(sessionId) : [];
  for (const skill of skills) {
    tracks.push({
      name: `/${skill}`,
      type: "skill",
      activations: [],  // Skills don't have precise timestamps
      total_count: 1,
      total_duration_ms: 0,
    });
  }

  // Sort tracks by total count (most active first)
  tracks.sort((a, b) => b.total_count - a.total_count);

  // Compute concurrency peak using sliding window (O(n) since entries are sorted)
  const concurrencyPeak = computeConcurrencyPeak(timedEntries);

  // Find busiest minute
  const minuteBuckets = new Map<number, number>();
  for (const { timeMs } of timedEntries) {
    const minute = Math.floor((timeMs - startTime) / 60_000);
    minuteBuckets.set(minute, (minuteBuckets.get(minute) ?? 0) + 1);
  }
  let busiestMinute = 0;
  let busiestCount = 0;
  for (const [minute, count] of minuteBuckets) {
    if (count > busiestCount) {
      busiestCount = count;
      busiestMinute = minute;
    }
  }

  return {
    session_start: startTs,
    session_end: endTs,
    duration_minutes: durationMinutes,
    tracks,
    concurrency_peak: concurrencyPeak,
    busiest_period: new Date(startTime + busiestMinute * 60_000).toISOString(),
    tools_summary: toolCounts,
    skills_used: skills,
  };
}

/** Sliding window O(n) concurrency peak (entries must be sorted by timeMs) */
function computeConcurrencyPeak(timedEntries: TimedEntry[]): number {
  if (timedEntries.length < 2) return timedEntries.length;

  let maxConcurrent = 1;
  let j = 0;
  for (let i = 0; i < timedEntries.length; i++) {
    // Advance j to include all entries within 1 second of entry[i]
    while (j + 1 < timedEntries.length && timedEntries[j + 1].timeMs - timedEntries[i].timeMs <= 1000) {
      j++;
    }
    maxConcurrent = Math.max(maxConcurrent, j - i + 1);
  }

  return maxConcurrent;
}
