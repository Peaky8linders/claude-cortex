#!/usr/bin/env node

import { ContextScorer } from "../core/scorer.js";
import { SnapshotExtractor } from "../snapshot/extractor.js";
import { SnapshotStore } from "../snapshot/store.js";
import { ContextRecovery } from "../snapshot/recovery.js";
import { estimateTokens } from "../core/utils.js";
import { readFileSync } from "fs";

const HELP = `
contextscore — Context quality scoring for Claude Code

Commands:
  score <file|->       Score context from a file or stdin
  watch                Lightweight quality check (for hooks)
  snapshot <file|->    Save critical context snapshot before compaction
  recover [sessionId]  Generate recovery context after compaction
  help                 Show this help

Options:
  --query, -q <text>   The current query/task
  --cost <number>      Cost per million tokens (default: 5.0)
  --json               Output as JSON
  --session <id>       Session ID for snapshots

Examples:
  contextscore score context.txt -q "How does auth work?"
  echo "context..." | contextscore score - -q "query" --json
  contextscore snapshot session.jsonl --session abc123
  contextscore recover abc123
`;

function parseArgs(args: string[]): { command: string; file?: string; query: string; cost: number; json: boolean; session: string } {
  const command = args[0] ?? "help";
  let file: string | undefined;
  let query = "";
  let cost = 5.0;
  let json = false;
  let session = `session-${Date.now()}`;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--query" || arg === "-q") { query = args[++i] ?? ""; }
    else if (arg === "--cost") { cost = parseFloat(args[++i] ?? "5"); }
    else if (arg === "--json") { json = true; }
    else if (arg === "--session") { session = args[++i] ?? session; }
    else if (!file) { file = arg; }
  }
  return { command, file, query, cost, json, session };
}

function readInput(file?: string): string {
  if (!file || file === "-") {
    // Read from stdin
    try {
      return readFileSync("/dev/stdin", "utf-8");
    } catch {
      return "";
    }
  }
  return readFileSync(file, "utf-8");
}

function cmdScore(opts: ReturnType<typeof parseArgs>) {
  const context = readInput(opts.file);
  if (!context.trim()) {
    console.error("Error: No context provided. Pass a file or pipe to stdin.");
    process.exit(1);
  }

  const scorer = new ContextScorer({ costPerMillion: opts.cost });
  const result = scorer.score(context, opts.query);

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Pretty output
  const bar = (score: number) => {
    const filled = Math.round(score / 5);
    return "█".repeat(filled) + "░".repeat(20 - filled);
  };
  const sevIcon: Record<string, string> = { critical: "🔴", high: "🟠", medium: "🟡", low: "🔵", info: "⚪" };

  console.log("══════════════════════════════════════════════");
  console.log(`  CONTEXT COHERENCE SCORE: ${result.score}/100  (${result.grade})`);
  console.log("══════════════════════════════════════════════");
  console.log(`\n${result.summary}\n`);

  console.log("── DIMENSIONS ──");
  for (const [, dim] of Object.entries(result.dimensions)) {
    console.log(`  ${dim.name.padEnd(22)} ${bar(dim.score)} ${dim.score.toFixed(0).padStart(3)}  (${dim.issues.length} issues)`);
  }

  const e = result.economics;
  console.log("\n── TOKEN ECONOMICS ──");
  console.log(`  Total: ${e.totalTokens.toLocaleString()} | Useful: ${e.usefulTokens.toLocaleString()} | Wasted: ${e.wastedTokens.toLocaleString()} (${e.wastePercentage.toFixed(0)}%)`);
  console.log(`  Cost: $${e.estimatedCost.toFixed(4)} | Wasted: $${e.wastedCost.toFixed(4)}`);

  if (result.issues.length) {
    console.log(`\n── ISSUES (${result.issues.length}) ──`);
    for (const issue of result.issues.slice(0, 10)) {
      console.log(`\n  ${sevIcon[issue.severity] ?? "⚪"} ${issue.cause} [${issue.severity.toUpperCase()}]`);
      console.log(`     ${issue.description}`);
      console.log(`     Fix: ${issue.fix}`);
      if (issue.estimatedTokenSavings > 0) {
        console.log(`     Saves: ~${issue.estimatedTokenSavings} tokens`);
      }
    }
    if (result.issues.length > 10) {
      console.log(`\n  ... and ${result.issues.length - 10} more issues`);
    }
  }
}

function cmdWatch(opts: ReturnType<typeof parseArgs>) {
  const context = readInput(opts.file);
  if (!context.trim()) { console.log("CCS: --/100 | No context"); return; }

  const scorer = new ContextScorer({ costPerMillion: opts.cost });
  const result = scorer.score(context, opts.query);
  const tokens = estimateTokens(context);
  const issueCount = result.issues.length;
  const waste = result.economics.wastePercentage;

  if (opts.json) {
    console.log(JSON.stringify({ score: result.score, grade: result.grade, tokens, issues: issueCount, waste: Math.round(waste) }));
  } else {
    const icon = result.score >= 80 ? "🟢" : result.score >= 60 ? "🟡" : result.score >= 40 ? "🟠" : "🔴";
    console.log(`${icon} CCS: ${result.score}/100 (${result.grade}) | ${tokens.toLocaleString()} tokens | ${Math.round(waste)}% waste | ${issueCount} issues`);
  }
}

function cmdSnapshot(opts: ReturnType<typeof parseArgs>) {
  const context = readInput(opts.file);
  if (!context.trim()) { console.error("Error: No context to snapshot."); process.exit(1); }

  const segments = context.split(/\n\n+/).filter(s => s.trim());
  const extractor = new SnapshotExtractor();
  const snapshot = extractor.extract(segments, opts.query, opts.session);

  const store = new SnapshotStore();
  const filepath = store.save(snapshot);

  if (opts.json) {
    console.log(JSON.stringify(snapshot, null, 2));
  } else {
    console.log(`✅ Snapshot saved: ${filepath}`);
    console.log(`   Score: ${snapshot.qualityScore}/100`);
    console.log(`   Decisions: ${snapshot.decisions.length}`);
    console.log(`   Entities: ${snapshot.entities.length}`);
    console.log(`   Files: ${snapshot.activeFiles.length}`);
    console.log(`   Patterns: ${snapshot.patterns.length}`);
    console.log(`   Errors resolved: ${snapshot.errorResolutions.length}`);
    console.log(`\n── Compact Instructions ──\n${snapshot.compactInstructions}`);
  }
}

function cmdRecover(opts: ReturnType<typeof parseArgs>) {
  const recovery = new ContextRecovery();
  const sessionId = opts.file !== "-" ? opts.file : undefined;
  const text = recovery.recover(sessionId);

  if (!text) {
    console.error("No snapshot found." + (sessionId ? ` (session: ${sessionId})` : ""));
    console.error("Run 'contextscore snapshot' before compaction to create one.");
    process.exit(1);
  }

  console.log(text);
}

// ── Main ──
const args = process.argv.slice(2);
const opts = parseArgs(args);

switch (opts.command) {
  case "score": cmdScore(opts); break;
  case "watch": cmdWatch(opts); break;
  case "snapshot": cmdSnapshot(opts); break;
  case "recover": cmdRecover(opts); break;
  case "help": case "--help": case "-h": console.log(HELP); break;
  default: console.error(`Unknown command: ${opts.command}`); console.log(HELP); process.exit(1);
}
