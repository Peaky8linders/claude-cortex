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

/**
 * Estimate the duration of an event. Since hooks are async and we only
 * have timestamps, we estimate end time as the next event in the journal.
 */
function estimateActivations(entries: JournalEntry[], filterFn: (e: JournalEntry) => boolean): Activation[] {
  const filtered = entries.filter(filterFn);
  const activations: Activation[] = [];

  for (let i = 0; i < filtered.length; i++) {
    const start = new Date(filtered[i].ts).getTime();
    // End is either the next event or start + 5 seconds (default duration)
    const nextEntry = entries.find(
      e => new Date(e.ts).getTime() > start && e !== filtered[i]
    );
    const end = nextEntry
      ? Math.min(new Date(nextEntry.ts).getTime(), start + 30_000)
      : start + 5_000;

    activations.push({
      start: filtered[i].ts,
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
    const activations = estimateActivations(entries, e => (e.tool ?? e.type) === name);
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
    const hookEntries = entries.filter(e => e.event);
    const hookGroups = new Map<string, JournalEntry[]>();
    for (const entry of hookEntries) {
      const hookName = entry.event!;
      if (!hookGroups.has(hookName)) hookGroups.set(hookName, []);
      hookGroups.get(hookName)!.push(entry);
    }

    for (const [name, groupEntries] of hookGroups) {
      // Don't duplicate if same name as a tool track
      if (toolGroups.has(name)) continue;

      const activations = estimateActivations(entries, e => e.event === name);
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

  // Compute concurrency peak
  const concurrencyPeak = computeConcurrencyPeak(entries);

  // Find busiest minute
  const minuteBuckets = new Map<number, number>();
  for (const entry of entries) {
    const minute = Math.floor((new Date(entry.ts).getTime() - startTime) / 60_000);
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

function computeConcurrencyPeak(entries: JournalEntry[]): number {
  if (entries.length < 2) return entries.length;

  // Count max events within a 1-second window
  let maxConcurrent = 1;
  for (let i = 0; i < entries.length; i++) {
    const windowStart = new Date(entries[i].ts).getTime();
    let concurrent = 1;
    for (let j = i + 1; j < entries.length; j++) {
      const t = new Date(entries[j].ts).getTime();
      if (t - windowStart <= 1000) {
        concurrent++;
      } else {
        break;
      }
    }
    maxConcurrent = Math.max(maxConcurrent, concurrent);
  }

  return maxConcurrent;
}
