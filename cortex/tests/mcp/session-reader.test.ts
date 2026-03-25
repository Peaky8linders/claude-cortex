import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  readJournal,
  getSessionEntries,
  estimateTokensForEntry,
  groupByPromptTurn,
} from "../../src/mcp/data/session-reader.js";
import type { JournalEntry } from "../../src/mcp/data/session-reader.js";

const TEST_DIR = join(tmpdir(), "cortex-test-session-reader-" + Date.now());

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

describe("readJournal", () => {
  it("reads enriched journal entries", () => {
    const journal = [
      '{"type":"write","ts":"2026-03-23T12:00:00Z","tool":"Edit","sid":"abc","tokens_est":400,"event":"PostToolUse"}',
      '{"type":"bash","ts":"2026-03-23T12:01:00Z","tool":"Bash","sid":"abc","tokens_est":200,"event":"PostToolUse"}',
    ].join("\n");
    writeFileSync(join(TEST_DIR, "session-journal.jsonl"), journal);

    const entries = readJournal(TEST_DIR);
    expect(entries).toHaveLength(2);
    expect(entries[0].tool).toBe("Edit");
    expect(entries[0].tokens_est).toBe(400);
    expect(entries[1].type).toBe("bash");
  });

  it("reads old-format entries (backward compatible)", () => {
    const journal = '{"type":"write","ts":"2026-03-23T12:00:00Z"}\n{"type":"read","ts":"2026-03-23T12:01:00Z"}';
    writeFileSync(join(TEST_DIR, "session-journal.jsonl"), journal);

    const entries = readJournal(TEST_DIR);
    expect(entries).toHaveLength(2);
    expect(entries[0].tool).toBeUndefined();
    expect(entries[0].type).toBe("write");
  });

  it("skips malformed lines", () => {
    const journal = '{"type":"write","ts":"2026-03-23T12:00:00Z"}\nINVALID JSON\n{"type":"read","ts":"2026-03-23T12:01:00Z"}';
    writeFileSync(join(TEST_DIR, "session-journal.jsonl"), journal);

    const entries = readJournal(TEST_DIR);
    expect(entries).toHaveLength(2);
  });

  it("returns empty for missing journal", () => {
    expect(readJournal(TEST_DIR)).toEqual([]);
  });

  it("handles empty file", () => {
    writeFileSync(join(TEST_DIR, "session-journal.jsonl"), "");
    expect(readJournal(TEST_DIR)).toEqual([]);
  });
});

describe("getSessionEntries", () => {
  it("extracts entries for the latest session", () => {
    const journal = [
      '{"type":"session_start","ts":"2026-03-23T10:00:00Z","sid":"s1"}',
      '{"type":"write","ts":"2026-03-23T10:01:00Z","sid":"s1"}',
      '{"type":"session_end","ts":"2026-03-23T10:30:00Z","sid":"s1"}',
      '{"type":"session_start","ts":"2026-03-23T11:00:00Z","sid":"s2"}',
      '{"type":"read","ts":"2026-03-23T11:01:00Z","sid":"s2"}',
      '{"type":"bash","ts":"2026-03-23T11:02:00Z","sid":"s2"}',
      '{"type":"session_end","ts":"2026-03-23T11:30:00Z","sid":"s2"}',
    ].join("\n");
    writeFileSync(join(TEST_DIR, "session-journal.jsonl"), journal);

    const session = getSessionEntries(undefined, TEST_DIR);
    expect(session.start?.sid).toBe("s2");
    // entries includes session_end
    expect(session.entries.filter(e => e.type !== "session_end")).toHaveLength(2);
  });

  it("extracts entries by session ID", () => {
    const journal = [
      '{"type":"session_start","ts":"2026-03-23T10:00:00Z","sid":"s1"}',
      '{"type":"write","ts":"2026-03-23T10:01:00Z","sid":"s1"}',
      '{"type":"session_end","ts":"2026-03-23T10:30:00Z","sid":"s1"}',
      '{"type":"session_start","ts":"2026-03-23T11:00:00Z","sid":"s2"}',
      '{"type":"read","ts":"2026-03-23T11:01:00Z","sid":"s2"}',
    ].join("\n");
    writeFileSync(join(TEST_DIR, "session-journal.jsonl"), journal);

    const session = getSessionEntries("s1", TEST_DIR);
    expect(session.start?.sid).toBe("s1");
    expect(session.end).toBeDefined();
  });

  it("handles unclosed sessions", () => {
    const journal = [
      '{"type":"session_start","ts":"2026-03-23T10:00:00Z","sid":"s1"}',
      '{"type":"write","ts":"2026-03-23T10:01:00Z","sid":"s1"}',
    ].join("\n");
    writeFileSync(join(TEST_DIR, "session-journal.jsonl"), journal);

    const session = getSessionEntries(undefined, TEST_DIR);
    expect(session.start?.sid).toBe("s1");
    expect(session.end).toBeUndefined();
    expect(session.entries).toHaveLength(1);
  });
});

describe("estimateTokensForEntry", () => {
  it("uses tokens_est when available", () => {
    expect(estimateTokensForEntry({ type: "write", ts: "2026-03-23T12:00:00Z", tokens_est: 500 })).toBe(500);
  });

  it("falls back to heuristic for old format", () => {
    expect(estimateTokensForEntry({ type: "write", ts: "2026-03-23T12:00:00Z" })).toBe(500);
    expect(estimateTokensForEntry({ type: "read", ts: "2026-03-23T12:00:00Z" })).toBe(300);
    expect(estimateTokensForEntry({ type: "bash", ts: "2026-03-23T12:00:00Z" })).toBe(200);
  });

  it("defaults to 100 for unknown types", () => {
    expect(estimateTokensForEntry({ type: "something_new", ts: "2026-03-23T12:00:00Z" })).toBe(100);
  });
});

describe("groupByPromptTurn", () => {
  it("groups entries by prompt_id", () => {
    const entries: JournalEntry[] = [
      { type: "write", ts: "2026-01-01T00:00:00Z", prompt_id: "s1-100" },
      { type: "read", ts: "2026-01-01T00:00:01Z", prompt_id: "s1-100" },
      { type: "bash", ts: "2026-01-01T00:01:00Z", prompt_id: "s1-160" },
    ];
    const turns = groupByPromptTurn(entries);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toHaveLength(2);
    expect(turns[1]).toHaveLength(1);
  });

  it("falls back to time-proximity for entries without prompt_id", () => {
    const entries: JournalEntry[] = [
      { type: "write", ts: "2026-01-01T00:00:00Z" },
      { type: "read", ts: "2026-01-01T00:00:01Z" },    // 1s gap → same turn
      { type: "bash", ts: "2026-01-01T00:01:00Z" },    // 59s gap → new turn
    ];
    const turns = groupByPromptTurn(entries);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toHaveLength(2);
    expect(turns[1]).toHaveLength(1);
  });

  it("skips session_start and session_end entries", () => {
    const entries: JournalEntry[] = [
      { type: "session_start", ts: "2026-01-01T00:00:00Z" },
      { type: "write", ts: "2026-01-01T00:00:01Z", prompt_id: "s1-100" },
      { type: "session_end", ts: "2026-01-01T00:01:00Z" },
    ];
    const turns = groupByPromptTurn(entries);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toHaveLength(1);
    expect(turns[0][0].type).toBe("write");
  });

  it("returns empty array for empty input", () => {
    expect(groupByPromptTurn([])).toHaveLength(0);
  });

  it("handles single entry", () => {
    const entries: JournalEntry[] = [
      { type: "write", ts: "2026-01-01T00:00:00Z" },
    ];
    const turns = groupByPromptTurn(entries);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toHaveLength(1);
  });
});
