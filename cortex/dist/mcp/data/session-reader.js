/**
 * Session Reader — Parse session journal, edits, and skills data
 *
 * Backward-compatible: handles both old format ({type, ts}) and
 * enriched format ({type, ts, tool, sid, tokens_est, event}).
 */
import { readFileSync, readdirSync, existsSync, statSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
// ── Reader ──
export function getKnowledgeDir() {
    return process.env.CORTEX_KNOWLEDGE_DIR ?? join(homedir(), ".claude", "knowledge");
}
export function getHooksStateDir() {
    return join(homedir(), ".claude", "hooks", "state");
}
/** Validate session ID to prevent path traversal */
function isValidSessionId(id) {
    return /^[a-zA-Z0-9_\-]+$/.test(id);
}
/**
 * Read session-journal.jsonl asynchronously. Skips malformed lines.
 * Caps at the last 10,000 lines to prevent unbounded reads.
 */
export async function readJournalAsync(knowledgeDir) {
    const dir = knowledgeDir ?? getKnowledgeDir();
    const journalPath = join(dir, "session-journal.jsonl");
    if (!existsSync(journalPath))
        return [];
    const content = await readFile(journalPath, "utf-8");
    return parseJournalContent(content);
}
/**
 * Read session-journal.jsonl synchronously (for backward compat in tests).
 */
export function readJournal(knowledgeDir) {
    const dir = knowledgeDir ?? getKnowledgeDir();
    const journalPath = join(dir, "session-journal.jsonl");
    if (!existsSync(journalPath))
        return [];
    const content = readFileSync(journalPath, "utf-8");
    return parseJournalContent(content);
}
function parseJournalContent(content) {
    const lines = content.split("\n");
    // Cap at last 10,000 lines to prevent unbounded parsing
    const tail = lines.length > 10_000 ? lines.slice(-10_000) : lines;
    const entries = [];
    for (const line of tail) {
        const trimmed = line.trim();
        if (!trimmed)
            continue;
        try {
            entries.push(JSON.parse(trimmed));
        }
        catch {
            // Skip malformed lines
        }
    }
    return entries;
}
/**
 * Parse journal entries into session boundaries.
 * Shared by getSessionEntries and cross-session analytics.
 */
export function parseSessionBoundaries(all) {
    if (all.length === 0)
        return [];
    const sessions = [];
    let current = { entries: [] };
    for (const entry of all) {
        if (entry.type === "session_start") {
            current = { start: entry, entries: [], session_type: entry.session_type };
        }
        else if (entry.type === "session_end") {
            current.end = entry;
            current.entries.push(entry);
            sessions.push(current);
            current = { entries: [] };
        }
        else {
            current.entries.push(entry);
        }
    }
    // If there's an unclosed session, include it
    if (current.entries.length > 0 || current.start) {
        sessions.push(current);
    }
    return sessions;
}
/**
 * Extract entries for a specific session, or the latest session.
 * Sessions are bounded by session_start and session_end entries.
 */
export function getSessionEntries(sessionId, knowledgeDir) {
    if (sessionId && !isValidSessionId(sessionId)) {
        return { entries: [] };
    }
    const all = readJournal(knowledgeDir);
    const sessions = parseSessionBoundaries(all);
    if (sessions.length === 0)
        return { entries: [] };
    if (sessionId) {
        const match = sessions.find(s => s.start?.sid === sessionId || s.entries.some(e => e.sid === sessionId));
        return match ?? { entries: [] };
    }
    // Return latest session (last one)
    return sessions[sessions.length - 1] ?? { entries: [] };
}
/**
 * Generic reader for session state files (session-edits-*, skills-used-*).
 * Sorts by mtime to ensure "latest" is deterministic.
 */
function readSessionFile(prefix, defaultValue, sessionId) {
    if (sessionId && !isValidSessionId(sessionId)) {
        return defaultValue;
    }
    const stateDir = getHooksStateDir();
    if (!existsSync(stateDir))
        return defaultValue;
    try {
        const files = readdirSync(stateDir).filter(f => f.startsWith(prefix));
        if (sessionId) {
            const target = `${prefix}${sessionId}.json`;
            const match = files.find(f => f === target);
            if (match) {
                return JSON.parse(readFileSync(join(stateDir, match), "utf-8"));
            }
            return defaultValue;
        }
        if (files.length === 0)
            return defaultValue;
        // Sort by mtime (most recent last) for deterministic "latest"
        const sorted = files
            .map(f => ({ name: f, mtime: statSync(join(stateDir, f)).mtimeMs }))
            .sort((a, b) => a.mtime - b.mtime);
        const latest = sorted[sorted.length - 1].name;
        return JSON.parse(readFileSync(join(stateDir, latest), "utf-8"));
    }
    catch {
        return defaultValue;
    }
}
/**
 * Read session-edits-{SID}.json files from hooks state dir.
 */
export function readEdits(sessionId) {
    return readSessionFile("session-edits-", { files: [], subsystems_touched: [] }, sessionId);
}
/**
 * Read skills-used-{SID}.json files from hooks state dir.
 */
export function readSkills(sessionId) {
    return readSessionFile("skills-used-", [], sessionId);
}
/**
 * Estimate tokens for an old-format entry that lacks tokens_est.
 * Uses heuristic based on tool type.
 */
export function estimateTokensForEntry(entry) {
    if (entry.tokens_est !== undefined && entry.tokens_est > 0) {
        return entry.tokens_est;
    }
    // Heuristic estimates for old-format entries by tool type
    const estimates = {
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
/**
 * Group journal entries by prompt turn using prompt_id correlation.
 * Falls back to time-proximity grouping (2s window) for old entries without prompt_id.
 */
export function groupByPromptTurn(entries) {
    if (entries.length === 0)
        return [];
    // Filter out session boundary events
    const events = entries.filter(e => e.type !== "session_start" && e.type !== "session_end");
    if (events.length === 0)
        return [];
    // If entries have prompt_id, group by it
    const hasPromptIds = events.some(e => e.prompt_id);
    if (hasPromptIds) {
        const groups = new Map();
        for (const entry of events) {
            const key = entry.prompt_id ?? `orphan-${entry.ts}`;
            if (!groups.has(key))
                groups.set(key, []);
            groups.get(key).push(entry);
        }
        return [...groups.values()];
    }
    // Fallback: time-proximity grouping (entries within 2s belong to same turn)
    const TIME_GAP_MS = 2000;
    const turns = [];
    let currentTurn = [events[0]];
    for (let i = 1; i < events.length; i++) {
        const prevTime = new Date(events[i - 1].ts).getTime();
        const currTime = new Date(events[i].ts).getTime();
        if (currTime - prevTime <= TIME_GAP_MS) {
            currentTurn.push(events[i]);
        }
        else {
            turns.push(currentTurn);
            currentTurn = [events[i]];
        }
    }
    turns.push(currentTurn);
    return turns;
}
