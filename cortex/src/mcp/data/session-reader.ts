/**
 * Session Reader — Parse session journal, edits, and skills data
 *
 * Backward-compatible: handles both old format ({type, ts}) and
 * enriched format ({type, ts, tool, sid, tokens_est, event}).
 */

import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// ── Types ──

export interface JournalEntry {
  type: string;
  ts: string;
  tool?: string;
  sid?: string;
  tokens_est?: number;
  event?: string;
  total_events?: number;
}

export interface SessionEdit {
  path: string;
  subsystem: string;
  timestamp: string;
}

export interface SessionEditsData {
  files: SessionEdit[];
  subsystems_touched: string[];
}

export interface SessionBoundary {
  start?: JournalEntry;
  end?: JournalEntry;
  entries: JournalEntry[];
}

// ── Reader ──

export function getKnowledgeDir(): string {
  return process.env.CORTEX_KNOWLEDGE_DIR ?? join(homedir(), ".claude", "knowledge");
}

export function getHooksStateDir(): string {
  return join(homedir(), ".claude", "hooks", "state");
}

/**
 * Read session-journal.jsonl, parsing each line as JSON.
 * Skips malformed lines silently.
 */
export function readJournal(knowledgeDir?: string): JournalEntry[] {
  const dir = knowledgeDir ?? getKnowledgeDir();
  const journalPath = join(dir, "session-journal.jsonl");

  if (!existsSync(journalPath)) return [];

  const content = readFileSync(journalPath, "utf-8");
  const entries: JournalEntry[] = [];

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed));
    } catch {
      // Skip malformed lines
    }
  }

  return entries;
}

/**
 * Extract entries for a specific session, or the latest session.
 * Sessions are bounded by session_start and session_end entries.
 */
export function getSessionEntries(sessionId?: string, knowledgeDir?: string): SessionBoundary {
  // Validate sessionId to prevent path traversal
  if (sessionId && !/^[a-zA-Z0-9_\-]+$/.test(sessionId)) {
    return { entries: [] };
  }
  const all = readJournal(knowledgeDir);

  if (all.length === 0) return { entries: [] };

  // Find session boundaries
  const sessions: SessionBoundary[] = [];
  let current: SessionBoundary = { entries: [] };

  for (const entry of all) {
    if (entry.type === "session_start") {
      current = { start: entry, entries: [] };
    } else if (entry.type === "session_end") {
      current.end = entry;
      current.entries.push(entry);
      sessions.push(current);
      current = { entries: [] };
    } else {
      current.entries.push(entry);
    }
  }

  // If there's an unclosed session, include it
  if (current.entries.length > 0 || current.start) {
    sessions.push(current);
  }

  if (sessionId) {
    const match = sessions.find(
      s => s.start?.sid === sessionId || s.entries.some(e => e.sid === sessionId)
    );
    return match ?? { entries: [] };
  }

  // Return latest session (last one)
  return sessions[sessions.length - 1] ?? { entries: [] };
}

/**
 * Read session-edits-{SID}.json files from hooks state dir.
 */
export function readEdits(sessionId?: string): SessionEditsData {
  const stateDir = getHooksStateDir();
  if (!existsSync(stateDir)) return { files: [], subsystems_touched: [] };

  try {
    const files = readdirSync(stateDir).filter(f => f.startsWith("session-edits-"));

    if (sessionId) {
      const target = `session-edits-${sessionId}.json`;
      const match = files.find(f => f === target);
      if (match) {
        return JSON.parse(readFileSync(join(stateDir, match), "utf-8"));
      }
      return { files: [], subsystems_touched: [] };
    }

    // Return latest by modification time
    if (files.length === 0) return { files: [], subsystems_touched: [] };

    const latest = files[files.length - 1];
    return JSON.parse(readFileSync(join(stateDir, latest), "utf-8"));
  } catch {
    return { files: [], subsystems_touched: [] };
  }
}

/**
 * Read skills-used-{SID}.json files from hooks state dir.
 */
export function readSkills(sessionId?: string): string[] {
  const stateDir = getHooksStateDir();
  if (!existsSync(stateDir)) return [];

  try {
    const files = readdirSync(stateDir).filter(f => f.startsWith("skills-used-"));

    if (sessionId) {
      const target = `skills-used-${sessionId}.json`;
      const match = files.find(f => f === target);
      if (match) {
        return JSON.parse(readFileSync(join(stateDir, match), "utf-8"));
      }
      return [];
    }

    if (files.length === 0) return [];
    const latest = files[files.length - 1];
    return JSON.parse(readFileSync(join(stateDir, latest), "utf-8"));
  } catch {
    return [];
  }
}

/**
 * Estimate tokens for an old-format entry that lacks tokens_est.
 * Uses heuristic based on tool type.
 */
export function estimateTokensForEntry(entry: JournalEntry): number {
  if (entry.tokens_est !== undefined && entry.tokens_est > 0) {
    return entry.tokens_est;
  }

  // Heuristic estimates for old-format entries by tool type
  const estimates: Record<string, number> = {
    write: 500,
    read: 300,
    bash: 200,
    edit: 400,
    search: 150,
    session_start: 50,
    session_end: 10,
    unknown: 100,
  };

  return estimates[entry.type] ?? 100;
}
