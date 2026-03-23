import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { computeActivityMap } from "../../src/mcp/tools/activity-map.js";

const TEST_DIR = join(tmpdir(), "cortex-test-actmap-" + Date.now());

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

function writeJournal(lines: string[]) {
  writeFileSync(join(TEST_DIR, "session-journal.jsonl"), lines.join("\n"));
}

describe("computeActivityMap", () => {
  it("groups events into tool tracks", () => {
    writeJournal([
      '{"type":"session_start","ts":"2026-03-23T12:00:00Z","sid":"s1"}',
      '{"type":"write","ts":"2026-03-23T12:00:10Z","tool":"Edit","event":"PostToolUse"}',
      '{"type":"write","ts":"2026-03-23T12:00:20Z","tool":"Edit","event":"PostToolUse"}',
      '{"type":"read","ts":"2026-03-23T12:00:30Z","tool":"Read","event":"PostToolUse"}',
      '{"type":"session_end","ts":"2026-03-23T12:01:00Z","sid":"s1"}',
    ]);

    const result = computeActivityMap(undefined, true, false, TEST_DIR);
    const editTrack = result.tracks.find(t => t.name === "Edit");
    const readTrack = result.tracks.find(t => t.name === "Read");

    expect(editTrack).toBeDefined();
    expect(editTrack!.total_count).toBe(2);
    expect(editTrack!.type).toBe("tool");
    expect(readTrack).toBeDefined();
    expect(readTrack!.total_count).toBe(1);
  });

  it("sorts tracks by activity count", () => {
    writeJournal([
      '{"type":"session_start","ts":"2026-03-23T12:00:00Z","sid":"s1"}',
      '{"type":"read","ts":"2026-03-23T12:00:10Z","tool":"Read"}',
      '{"type":"write","ts":"2026-03-23T12:00:20Z","tool":"Edit"}',
      '{"type":"write","ts":"2026-03-23T12:00:30Z","tool":"Edit"}',
      '{"type":"write","ts":"2026-03-23T12:00:40Z","tool":"Edit"}',
      '{"type":"session_end","ts":"2026-03-23T12:01:00Z","sid":"s1"}',
    ]);

    const result = computeActivityMap(undefined, false, false, TEST_DIR);
    expect(result.tracks[0].name).toBe("Edit");
    expect(result.tracks[0].total_count).toBe(3);
  });

  it("computes session duration", () => {
    writeJournal([
      '{"type":"session_start","ts":"2026-03-23T12:00:00Z","sid":"s1"}',
      '{"type":"write","ts":"2026-03-23T12:00:30Z","tool":"Edit"}',
      '{"type":"session_end","ts":"2026-03-23T12:10:00Z","sid":"s1"}',
    ]);

    const result = computeActivityMap(undefined, false, false, TEST_DIR);
    expect(result.duration_minutes).toBe(10);
    expect(result.session_start).toContain("12:00:00");
    expect(result.session_end).toContain("12:10:00");
  });

  it("includes tool counts summary", () => {
    writeJournal([
      '{"type":"session_start","ts":"2026-03-23T12:00:00Z","sid":"s1"}',
      '{"type":"write","ts":"2026-03-23T12:00:10Z","tool":"Edit"}',
      '{"type":"bash","ts":"2026-03-23T12:00:20Z","tool":"Bash"}',
      '{"type":"bash","ts":"2026-03-23T12:00:30Z","tool":"Bash"}',
      '{"type":"session_end","ts":"2026-03-23T12:01:00Z","sid":"s1"}',
    ]);

    const result = computeActivityMap(undefined, false, false, TEST_DIR);
    expect(result.tools_summary["Edit"]).toBe(1);
    expect(result.tools_summary["Bash"]).toBe(2);
  });

  it("handles old-format entries", () => {
    writeJournal([
      '{"type":"write","ts":"2026-03-23T12:00:10Z"}',
      '{"type":"read","ts":"2026-03-23T12:00:20Z"}',
    ]);

    const result = computeActivityMap(undefined, false, false, TEST_DIR);
    expect(result.tracks).toHaveLength(2);
    expect(result.tracks.find(t => t.name === "write")).toBeDefined();
  });
});
