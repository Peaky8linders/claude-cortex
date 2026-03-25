import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { computeTokenTimeline } from "../../src/mcp/tools/token-timeline.js";

const TEST_DIR = join(tmpdir(), "cortex-test-timeline-" + Date.now());

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

function writeJournal(lines: string[]) {
  writeFileSync(join(TEST_DIR, "session-journal.jsonl"), lines.join("\n"));
}

describe("computeTokenTimeline", () => {
  it("returns empty result for missing journal", () => {
    const result = computeTokenTimeline(undefined, 60, TEST_DIR);
    expect(result.timeline).toEqual([]);
    expect(result.spikes).toEqual([]);
    expect(result.summary.total_tokens).toBe(0);
  });

  it("buckets entries by minute", () => {
    writeJournal([
      '{"type":"session_start","ts":"2026-03-23T12:00:00Z","sid":"s1"}',
      '{"type":"write","ts":"2026-03-23T12:00:30Z","tool":"Edit","tokens_est":400}',
      '{"type":"write","ts":"2026-03-23T12:00:45Z","tool":"Edit","tokens_est":300}',
      '{"type":"read","ts":"2026-03-23T12:01:30Z","tool":"Read","tokens_est":200}',
      '{"type":"session_end","ts":"2026-03-23T12:02:00Z","sid":"s1"}',
    ]);

    const result = computeTokenTimeline(undefined, 60, TEST_DIR);
    expect(result.timeline.length).toBeGreaterThanOrEqual(2);
    // First minute bucket should have 700 tokens (400+300)
    expect(result.timeline[0].tokens_in).toBe(700);
    expect(result.timeline[0].tool).toBe("Edit");
  });

  it("computes cumulative tokens", () => {
    writeJournal([
      '{"type":"session_start","ts":"2026-03-23T12:00:00Z","sid":"s1"}',
      '{"type":"write","ts":"2026-03-23T12:00:30Z","tokens_est":100}',
      '{"type":"read","ts":"2026-03-23T12:01:30Z","tokens_est":200}',
      '{"type":"bash","ts":"2026-03-23T12:02:30Z","tokens_est":300}',
      '{"type":"session_end","ts":"2026-03-23T12:03:00Z","sid":"s1"}',
    ]);

    const result = computeTokenTimeline(undefined, 60, TEST_DIR);
    const lastBucket = result.timeline[result.timeline.length - 1];
    expect(lastBucket.cumulative).toBe(600);
  });

  it("detects spikes above rolling average", () => {
    // Create a session with gradual usage then a spike
    const lines = [
      '{"type":"session_start","ts":"2026-03-23T12:00:00Z","sid":"s1"}',
    ];
    // 6 minutes of low usage
    for (let m = 0; m < 6; m++) {
      const min = String(m).padStart(2, "0");
      lines.push(`{"type":"read","ts":"2026-03-23T12:${min}:30Z","tokens_est":50}`);
    }
    // Big spike at minute 6
    lines.push('{"type":"write","ts":"2026-03-23T12:06:30Z","tokens_est":5000}');
    lines.push('{"type":"session_end","ts":"2026-03-23T12:07:00Z","sid":"s1"}');
    writeJournal(lines);

    const result = computeTokenTimeline(undefined, 60, TEST_DIR);
    expect(result.spikes.length).toBeGreaterThanOrEqual(1);
    expect(result.spikes[0].tokens).toBe(5000);
  });

  it("computes summary with cost estimate", () => {
    writeJournal([
      '{"type":"session_start","ts":"2026-03-23T12:00:00Z","sid":"s1"}',
      '{"type":"write","ts":"2026-03-23T12:00:30Z","tokens_est":1000}',
      '{"type":"session_end","ts":"2026-03-23T12:01:00Z","sid":"s1"}',
    ]);

    const result = computeTokenTimeline(undefined, 60, TEST_DIR);
    expect(result.summary.total_tokens).toBe(1000);
    // Model-aware cost: 1000 tokens on sonnet (default) = 700*$3/M + 300*$15/M = $0.0066
    expect(result.summary.estimated_cost).toBeCloseTo(0.0066, 4);
    expect(result.summary.duration_minutes).toBeGreaterThanOrEqual(1);
  });

  it("tracks tokens by tool in summary", () => {
    writeJournal([
      '{"type":"session_start","ts":"2026-03-23T12:00:00Z","sid":"s1"}',
      '{"type":"write","ts":"2026-03-23T12:00:10Z","tool":"Edit","tokens_est":100}',
      '{"type":"read","ts":"2026-03-23T12:00:20Z","tool":"Read","tokens_est":200}',
      '{"type":"write","ts":"2026-03-23T12:00:30Z","tool":"Edit","tokens_est":150}',
      '{"type":"session_end","ts":"2026-03-23T12:01:00Z","sid":"s1"}',
    ]);

    const result = computeTokenTimeline(undefined, 60, TEST_DIR);
    expect(result.summary.by_tool["Edit"]).toBe(2);
    expect(result.summary.by_tool["Read"]).toBe(1);
  });
});
