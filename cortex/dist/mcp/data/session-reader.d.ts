/**
 * Session Reader — Parse session journal, edits, and skills data
 *
 * Backward-compatible: handles both old format ({type, ts}) and
 * enriched format ({type, ts, tool, sid, tokens_est, event}).
 */
export interface JournalEntry {
    type: string;
    ts: string;
    tool?: string;
    sid?: string;
    tokens_est?: number;
    event?: string;
    total_events?: number;
    model?: string;
    cost_usd?: number;
    prompt_id?: string;
    success?: boolean;
    duration_ms?: number;
    decision?: "allow" | "deny";
    session_type?: "startup" | "resume" | "compact" | "clear";
    is_first_turn?: boolean;
    context_tokens_est?: number;
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
    session_type?: "startup" | "resume" | "compact" | "clear";
}
export declare function getKnowledgeDir(): string;
export declare function getHooksStateDir(): string;
/**
 * Read session-journal.jsonl asynchronously. Skips malformed lines.
 * Caps at the last 10,000 lines to prevent unbounded reads.
 */
export declare function readJournalAsync(knowledgeDir?: string): Promise<JournalEntry[]>;
/**
 * Read session-journal.jsonl synchronously (for backward compat in tests).
 */
export declare function readJournal(knowledgeDir?: string): JournalEntry[];
/**
 * Parse journal entries into session boundaries.
 * Shared by getSessionEntries and cross-session analytics.
 */
export declare function parseSessionBoundaries(all: JournalEntry[]): SessionBoundary[];
/**
 * Extract entries for a specific session, or the latest session.
 * Sessions are bounded by session_start and session_end entries.
 */
export declare function getSessionEntries(sessionId?: string, knowledgeDir?: string): SessionBoundary;
/**
 * Read session-edits-{SID}.json files from hooks state dir.
 */
export declare function readEdits(sessionId?: string): SessionEditsData;
/**
 * Read skills-used-{SID}.json files from hooks state dir.
 */
export declare function readSkills(sessionId?: string): string[];
/**
 * Estimate tokens for an old-format entry that lacks tokens_est.
 * Uses heuristic based on tool type.
 */
export declare function estimateTokensForEntry(entry: JournalEntry): number;
/**
 * Group journal entries by prompt turn using prompt_id correlation.
 * Falls back to time-proximity grouping (2s window) for old entries without prompt_id.
 */
export declare function groupByPromptTurn(entries: JournalEntry[]): JournalEntry[][];
