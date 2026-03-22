import { describe, it, expect } from "vitest";
import {
  estimateTokens, wordTokenize, splitSegments, contentHash,
  cosineSimilarityBow, jaccardSimilarity, informationDensity,
  detectFormattingOverhead, detectFillerPhrases, detectReferences,
} from "../src/core/utils.js";
import { ContextScorer } from "../src/core/scorer.js";
import {
  SemanticRelevanceAnalyzer, RedundancyAnalyzer, DistractorAnalyzer,
  DensityAnalyzer, FragmentationAnalyzer, StructureAnalyzer, EconomicsAnalyzer,
} from "../src/core/analyzers/index.js";
import { IssueCause, CAUSE_CATALOG, Severity, createIssue } from "../src/core/models.js";
import { SnapshotExtractor } from "../src/snapshot/extractor.js";

// ═══════════════════════════════════════
// UTILS
// ═══════════════════════════════════════

describe("Utils", () => {
  it("estimateTokens scales with text length", () => {
    expect(estimateTokens("hi")).toBeGreaterThan(0);
    expect(estimateTokens("hello ".repeat(100))).toBeGreaterThan(estimateTokens("hello"));
  });

  it("wordTokenize lowercases and extracts words", () => {
    const tokens = wordTokenize("Hello, World! Test 123.");
    expect(tokens).toContain("hello");
    expect(tokens).toContain("world");
    expect(tokens).not.toContain(",");
  });

  it("splitSegments on double newlines", () => {
    expect(splitSegments("A\n\nB\n\nC")).toHaveLength(3);
  });

  it("contentHash is deterministic and normalizes", () => {
    expect(contentHash("Hello World")).toBe(contentHash("hello   world"));
  });

  it("cosineSimilarityBow: identical = 1.0", () => {
    expect(cosineSimilarityBow("machine learning", "machine learning")).toBeCloseTo(1.0);
  });

  it("cosineSimilarityBow: unrelated ≈ 0", () => {
    expect(cosineSimilarityBow("machine learning optimization", "cooking recipes pasta")).toBeLessThan(0.1);
  });

  it("cosineSimilarityBow: empty = 0", () => {
    expect(cosineSimilarityBow("", "")).toBe(0);
    expect(cosineSimilarityBow("hello", "")).toBe(0);
  });

  it("jaccardSimilarity: identical = 1, disjoint = 0", () => {
    expect(jaccardSimilarity(new Set(["a","b"]), new Set(["a","b"]))).toBe(1);
    expect(jaccardSimilarity(new Set(["a"]), new Set(["b"]))).toBe(0);
    expect(jaccardSimilarity(new Set(), new Set())).toBe(1);
  });

  it("informationDensity: dense > fluffy", () => {
    const dense = informationDensity("TensorFlow implements automatic differentiation using computational graphs.");
    const fluffy = informationDensity("It is very important to note that this is something we should be aware of.");
    expect(dense).toBeGreaterThan(fluffy);
  });

  it("detectFormattingOverhead: formatted > plain", () => {
    expect(detectFormattingOverhead("plain text")).toBeLessThan(
      detectFormattingOverhead("# Header\n**bold** and *italic*\n---\n| col |")
    );
  });

  it("detectFillerPhrases catches filler", () => {
    expect(detectFillerPhrases("As mentioned above, in order to achieve this goal.").length).toBeGreaterThanOrEqual(2);
  });

  it("detectReferences catches dangling refs", () => {
    expect(detectReferences("See Table 3 above. Refer to the appendix.").length).toBeGreaterThanOrEqual(2);
  });
});

// ═══════════════════════════════════════
// MODELS
// ═══════════════════════════════════════

describe("Models", () => {
  it("every IssueCause has a catalog entry with description and fix", () => {
    for (const cause of Object.values(IssueCause)) {
      const entry = CAUSE_CATALOG[cause];
      expect(entry, `Missing catalog for ${cause}`).toBeDefined();
      expect(entry.description.length).toBeGreaterThan(10);
      expect(entry.fix.length).toBeGreaterThan(10);
      expect(entry.category.length).toBeGreaterThan(0);
    }
  });

  it("createIssue populates from catalog", () => {
    const issue = createIssue(IssueCause.DUPLICATE_CONTENT, Severity.HIGH, {
      affectedSegments: [0, 1], estimatedImprovement: 5,
    });
    expect(issue.cause).toBe(IssueCause.DUPLICATE_CONTENT);
    expect(issue.severity).toBe(Severity.HIGH);
    expect(issue.description.length).toBeGreaterThan(0);
    expect(issue.fix.length).toBeGreaterThan(0);
    expect(issue.category).toBe("redundancy");
  });
});

// ═══════════════════════════════════════
// ANALYZERS
// ═══════════════════════════════════════

describe("SemanticRelevanceAnalyzer", () => {
  const analyzer = new SemanticRelevanceAnalyzer();

  it("scores relevant context higher", () => {
    const good = analyzer.analyze([
      "Gradient descent optimizes neural network loss functions.",
      "Learning rate controls gradient descent step size.",
    ], "How does gradient descent optimize neural networks?");
    expect(good.score).toBeGreaterThan(30);
  });

  it("flags irrelevant segments", () => {
    const bad = analyzer.analyze([
      "The recipe calls for two cups of flour.",
      "Paris is the capital of France.",
    ], "How does gradient descent work?");
    expect(bad.issues.some(i => i.cause === IssueCause.IRRELEVANT_SEGMENT)).toBe(true);
  });

  it("handles empty input", () => {
    expect(analyzer.analyze([], "test").score).toBe(50);
  });
});

describe("RedundancyAnalyzer", () => {
  const analyzer = new RedundancyAnalyzer();

  it("detects exact duplicates", () => {
    const result = analyzer.analyze([
      "Gradient descent optimizes loss.",
      "Something else entirely.",
      "Gradient descent optimizes loss.",
    ], "test");
    expect(result.issues.some(i => i.cause === IssueCause.DUPLICATE_CONTENT)).toBe(true);
  });

  it("scores unique content high", () => {
    const result = analyzer.analyze([
      "First unique piece of information.",
      "Second completely different content.",
      "Third distinct segment about another topic.",
    ], "test");
    expect(result.score).toBeGreaterThan(70);
  });

  it("single segment = 100", () => {
    expect(analyzer.analyze(["One segment"], "test").score).toBe(100);
  });
});

describe("DistractorAnalyzer", () => {
  const analyzer = new DistractorAnalyzer();

  it("detects contradictions", () => {
    const result = analyzer.analyze([
      "The system is currently active and processing.",
      "The system is not active and has been offline.",
    ], "Is the system running?");
    expect(result.issues.some(i => i.cause === IssueCause.CONTRADICTORY_INFORMATION)).toBe(true);
  });

  it("detects stale content", () => {
    const result = analyzer.analyze([
      "As of 2019, the recommended instance was P3.",
    ], "What instance should I use?");
    expect(result.issues.some(i => i.cause === IssueCause.STALE_INFORMATION)).toBe(true);
  });
});

describe("DensityAnalyzer", () => {
  const analyzer = new DensityAnalyzer();

  it("scores dense content higher than fluffy", () => {
    const dense = analyzer.analyze(["TensorFlow 2.15 XLA compilation reduces latency 40% on TPU v5e."], "test");
    const fluffy = analyzer.analyze([
      "It is very important to note that in this particular context we should be very aware of the fact that there are many things.",
    ], "test");
    expect(dense.score).toBeGreaterThan(fluffy.score);
  });

  it("detects filler phrases", () => {
    const result = analyzer.analyze([
      "As mentioned above, it is important to note that in order to achieve results, due to the fact that things work well.",
    ], "test");
    expect(result.issues.some(i => i.cause === IssueCause.FILLER_CONTENT)).toBe(true);
  });
});

describe("FragmentationAnalyzer", () => {
  const analyzer = new FragmentationAnalyzer();

  it("detects broken references", () => {
    const result = analyzer.analyze([
      "As described above in Section 3, see Table 5 for details.",
    ], "test");
    expect(result.issues.some(i => i.cause === IssueCause.BROKEN_REFERENCES)).toBe(true);
  });
});

describe("StructureAnalyzer", () => {
  const analyzer = new StructureAnalyzer();

  it("scores structured context higher", () => {
    const structured = analyzer.analyze([
      "[SYSTEM] You are an AI assistant.",
      "[RETRIEVED_CONTEXT] Source: Docs | Date: 2024\nGradient descent optimizes functions.",
    ], "test");
    const unstructured = analyzer.analyze([
      "Some info.", "More info.", "Yet more.", "And more.",
    ], "test");
    expect(structured.score).toBeGreaterThan(unstructured.score);
  });
});

describe("EconomicsAnalyzer", () => {
  const analyzer = new EconomicsAnalyzer();

  it("flags oversized context", () => {
    const result = analyzer.analyze(
      Array(250).fill("word ".repeat(500)),
      "test",
    );
    expect(result.issues.some(i =>
      i.cause === IssueCause.OVERSIZED_CONTEXT || i.cause === IssueCause.ATTENTION_BUDGET_EXCEEDED
    )).toBe(true);
  });

  it("detects cacheable static content", () => {
    const result = analyzer.analyze([
      "You are an AI assistant. You must always be helpful. Your role is to answer questions. You must never fabricate. Always cite sources. ".repeat(6),
      "Revenue was $5.2 billion in Q3.",
    ], "What were earnings?");
    expect(result.issues.some(i => i.cause === IssueCause.CACHEABLE_CONTENT_NOT_CACHED)).toBe(true);
  });
});

// ═══════════════════════════════════════
// SCORER INTEGRATION
// ═══════════════════════════════════════

describe("ContextScorer", () => {
  const scorer = new ContextScorer();

  it("produces a complete ScoreResult", () => {
    const result = scorer.score(
      "ML uses gradient descent.\n\nLearning rate is a hyperparameter.",
      "gradient descent",
    );
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.grade).toMatch(/^[A-F][+-]?$/);
    expect(Object.keys(result.dimensions)).toHaveLength(7);
    expect(result.economics.totalTokens).toBeGreaterThan(0);
    expect(result.summary.length).toBeGreaterThan(10);
  });

  it("poor context scores lower than good context", () => {
    const good = scorer.score(
      "Gradient descent computes loss gradients.\n\nParameters update by stepping opposite the gradient.",
      "How does gradient descent work?",
    );
    const bad = scorer.score(
      "The weather is sunny.\n\nI had pizza for lunch.\n\nThe stock market went up.",
      "How does gradient descent work?",
    );
    expect(good.score).toBeGreaterThan(bad.score);
  });

  it("issues are sorted by severity", () => {
    const result = scorer.score(
      "Irrelevant.\n\nAlso irrelevant.\n\nStill irrelevant.\n\nIrrelevant.\n\nIrrelevant.",
      "specific technical question",
    );
    const sevOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    for (let i = 1; i < result.issues.length; i++) {
      expect(sevOrder[result.issues[i].severity]).toBeGreaterThanOrEqual(
        sevOrder[result.issues[i - 1].severity]
      );
    }
  });

  it("every issue has a meaningful fix", () => {
    const result = scorer.score(
      "Garbage.\n\nGarbage.\n\nMore garbage.\n\nDuplicate garbage.\n\nDuplicate garbage.",
      "important query",
    );
    for (const issue of result.issues) {
      expect(issue.fix.length, `No fix for ${issue.cause}`).toBeGreaterThan(10);
      expect(issue.description.length).toBeGreaterThan(5);
    }
  });

  it("score stays 0-100 on edge cases", () => {
    for (const [ctx, q] of [["", ""], ["a", "b"], ["x ".repeat(10000), "y"]]) {
      const r = scorer.score(ctx, q);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
    }
  });

  it("wasted tokens never exceed total", () => {
    const result = scorer.score("Dup.\n\nDup.\n\nDup.\n\nDup.", "test");
    expect(result.economics.wastedTokens).toBeLessThanOrEqual(result.economics.totalTokens);
  });

  it("maxSegments caps processing", () => {
    const scorer5 = new ContextScorer({ maxSegments: 5 });
    const ctx = Array(20).fill("Segment about a topic.").join("\n\n");
    const result = scorer5.score(ctx, "topic");
    expect(result.segmentCount).toBe(5);
  });
});

// ═══════════════════════════════════════
// SNAPSHOT (Product 2)
// ═══════════════════════════════════════

describe("SnapshotExtractor", () => {
  const extractor = new SnapshotExtractor();

  it("extracts decisions from context", () => {
    const snap = extractor.extract([
      "We decided to use JWT-based auth with refresh tokens.",
      "Switched to bcrypt instead of argon2 for Alpine compatibility.",
      "Using Repository pattern throughout the codebase.",
    ], "Implement auth", "test-session");

    expect(snap.decisions.length).toBeGreaterThan(0);
    expect(snap.sessionId).toBe("test-session");
    expect(snap.qualityScore).toBeGreaterThanOrEqual(0);
  });

  it("extracts file paths", () => {
    const snap = extractor.extract([
      "Modified src/services/auth.ts and src/app.ts for CORS fix.",
      "The config lives in ./config/database.yml",
    ], "auth work", "sess-2");

    expect(snap.activeFiles.length).toBeGreaterThan(0);
    expect(snap.activeFiles.some(f => f.includes("src/"))).toBe(true);
  });

  it("extracts code entities", () => {
    const snap = extractor.extract([
      "The UserService handles auth. Uses UserRepository for DB access.",
      "Set API_SECRET_KEY in the environment.",
    ], "auth", "sess-3");

    expect(snap.entities.some(e => e.name === "UserService")).toBe(true);
    expect(snap.entities.some(e => e.name === "UserRepository")).toBe(true);
    expect(snap.entities.some(e => e.name === "API_SECRET_KEY")).toBe(true);
  });

  it("extracts error resolutions", () => {
    const snap = extractor.extract([
      "Fixed the CORS error by adding origin whitelist to Express middleware.",
    ], "debugging", "sess-4");

    expect(snap.errorResolutions.length).toBeGreaterThan(0);
    expect(snap.errorResolutions[0]).toContain("CORS");
  });

  it("generates compaction instructions", () => {
    const snap = extractor.extract([
      "Decided to use PostgreSQL. Modified src/db/connection.ts.",
      "Fixed timeout bug in the connection pool configuration.",
    ], "db setup", "sess-5");

    expect(snap.compactInstructions).toContain("MUST PRESERVE");
    expect(snap.compactInstructions).toContain("CAN DISCARD");
  });

  it("handles empty input gracefully", () => {
    const snap = extractor.extract([], "", "empty-sess");
    expect(snap.decisions).toHaveLength(0);
    expect(snap.entities).toHaveLength(0);
    expect(snap.qualityScore).toBeGreaterThanOrEqual(0);
  });
});
