import { describe, it, expect, beforeEach } from "vitest";
import { KnowledgeGraph } from "../src/graph/knowledge-graph.js";
import { HookProcessor, type HookEvent } from "../src/hooks/processor.js";

let graph: KnowledgeGraph;
let processor: HookProcessor;

beforeEach(() => {
  graph = new KnowledgeGraph();
  processor = new HookProcessor(graph);
});

// ═══════════════════════════════════════
// Knowledge Graph Core
// ═══════════════════════════════════════

describe("KnowledgeGraph", () => {
  it("adds and retrieves nodes", () => {
    graph.addNode("f1", "src/app.ts", "file");
    expect(graph.getNode("f1")).toBeDefined();
    expect(graph.getNode("f1")?.name).toBe("src/app.ts");
  });

  it("deduplicates nodes, incrementing access count", () => {
    graph.addNode("f1", "src/app.ts", "file");
    graph.addNode("f1", "src/app.ts", "file");
    expect(graph.getNode("f1")?.accessCount).toBe(2);
  });

  it("adds edges between existing nodes", () => {
    graph.addNode("t1", "Read", "tool");
    graph.addNode("f1", "src/app.ts", "file");
    graph.addEdge("t1", "f1", "reads");
    expect(graph.getAllEdges()).toHaveLength(1);
  });

  it("throws on edge to missing node", () => {
    graph.addNode("t1", "Read", "tool");
    expect(() => graph.addEdge("t1", "missing", "reads")).toThrow();
  });

  it("strengthens existing edge weight on re-add", () => {
    graph.addNode("t1", "Read", "tool");
    graph.addNode("f1", "app.ts", "file");
    const e1 = graph.addEdge("t1", "f1", "reads");
    const w1 = e1.weight;
    graph.addEdge("t1", "f1", "reads");
    expect(graph.getAllEdges()[0].weight).toBeGreaterThan(w1);
  });

  it("returns neighbors", () => {
    graph.addNode("a", "A", "file");
    graph.addNode("b", "B", "file");
    graph.addNode("c", "C", "file");
    graph.addEdge("a", "b", "reads");
    graph.addEdge("a", "c", "reads");
    expect(graph.getNeighbors("a")).toHaveLength(2);
  });

  it("filters by node type", () => {
    graph.addNode("f1", "app.ts", "file");
    graph.addNode("f2", "index.ts", "file");
    graph.addNode("t1", "Read", "tool");
    expect(graph.getNodesByType("file")).toHaveLength(2);
    expect(graph.getNodesByType("tool")).toHaveLength(1);
  });

  it("tracks token costs", () => {
    graph.addNode("f1", "big-file.ts", "file");
    graph.updateTokenCost("f1", 500);
    graph.updateTokenCost("f1", 300);
    expect(graph.getNode("f1")?.tokenCost).toBe(800);
  });

  it("tracks quality impact", () => {
    graph.addNode("e1", "TypeError", "error");
    graph.setQualityImpact("e1", -50);
    expect(graph.getNode("e1")?.qualityImpact).toBe(-50);
  });

  it("clamps quality impact to [-100, 100]", () => {
    graph.addNode("e1", "err", "error");
    graph.setQualityImpact("e1", -200);
    expect(graph.getNode("e1")?.qualityImpact).toBe(-100);
    graph.setQualityImpact("e1", 200);
    expect(graph.getNode("e1")?.qualityImpact).toBe(100);
  });
});

// ═══════════════════════════════════════
// Graph Metrics & Recommendations
// ═══════════════════════════════════════

describe("Graph Metrics", () => {
  it("computes metrics on empty graph", () => {
    const m = graph.computeMetrics();
    expect(m.nodeCount).toBe(0);
    expect(m.qualityScore).toBeGreaterThanOrEqual(0);
  });

  it("computes metrics with nodes and edges", () => {
    graph.addNode("f1", "app.ts", "file");
    graph.addNode("f2", "index.ts", "file");
    graph.addNode("t1", "Edit", "tool");
    graph.addEdge("t1", "f1", "writes");
    graph.addEdge("t1", "f2", "writes");

    const m = graph.computeMetrics();
    expect(m.nodeCount).toBe(3);
    expect(m.edgeCount).toBe(2);
    expect(m.density).toBeGreaterThan(0);
    expect(m.clusters.length).toBeGreaterThan(0);
  });

  it("identifies hot nodes", () => {
    const f1 = graph.addNode("f1", "hot-file.ts", "file");
    f1.accessCount = 20;
    graph.addNode("f2", "cold-file.ts", "file");
    graph.addEdge("f1", "f2", "reads");

    const m = graph.computeMetrics();
    expect(m.hotNodes[0].name).toBe("hot-file.ts");
  });

  it("detects clusters", () => {
    graph.addNode("a", "a.ts", "file");
    graph.addNode("b", "b.ts", "file");
    graph.addNode("c", "c.ts", "file");
    graph.addNode("x", "x.ts", "file");
    graph.addEdge("a", "b", "reads");
    graph.addEdge("b", "c", "reads");
    // x is isolated

    const m = graph.computeMetrics();
    expect(m.clusters.length).toBe(2); // {a,b,c} and {x}
  });

  it("generates recommendations for stale reads", () => {
    for (let i = 0; i < 5; i++) {
      const n = graph.addNode(`f${i}`, `file${i}.ts`, "file");
      n.tokenCost = 200;
      graph.addNode(`t${i}`, "Read", "tool");
      graph.addEdge(`t${i}`, `f${i}`, "reads");
    }

    const m = graph.computeMetrics();
    const staleRec = m.recommendations.find(r => r.title.includes("Stale file reads"));
    expect(staleRec).toBeDefined();
    expect(staleRec!.estimatedSavings).toBeGreaterThan(0);
  });

  it("recommends missing hooks", () => {
    // No hooks in graph
    const m = graph.computeMetrics();
    const hookRec = m.recommendations.find(r => r.title.includes("Missing recommended hooks"));
    expect(hookRec).toBeDefined();
  });

  it("warns on high token budget", () => {
    const big = graph.addNode("big", "huge-file.ts", "file");
    big.tokenCost = 120_000;

    const m = graph.computeMetrics();
    const budgetRec = m.recommendations.find(r => r.title.includes("context limit"));
    expect(budgetRec).toBeDefined();
  });

  it("flags unanchored decisions", () => {
    graph.addNode("d1", "Use JWT", "decision");
    // No edges

    const m = graph.computeMetrics();
    const decRec = m.recommendations.find(r => r.title.includes("Unanchored decisions"));
    expect(decRec).toBeDefined();
    expect(decRec!.type).toBe("critical");
  });

  it("suggests subagent for large clusters", () => {
    for (let i = 0; i < 7; i++) {
      graph.addNode(`f${i}`, `mod/file${i}.ts`, "file");
      if (i > 0) graph.addEdge(`f${i - 1}`, `f${i}`, "reads");
    }

    const m = graph.computeMetrics();
    const subRec = m.recommendations.find(r => r.title.includes("Subagent candidate"));
    expect(subRec).toBeDefined();
  });
});

// ═══════════════════════════════════════
// Hook Processor
// ═══════════════════════════════════════

describe("HookProcessor", () => {
  it("processes SessionStart", () => {
    processor.process({ hook_event_name: "SessionStart", session_id: "s1", model: "opus-4.6" });
    expect(graph.getNode("session:current")).toBeDefined();
    expect(graph.getNode("session:current")?.properties.model).toBe("opus-4.6");
  });

  it("processes PreToolUse with file path", () => {
    processor.process({
      hook_event_name: "PreToolUse", session_id: "s1",
      tool_name: "Read", tool_input: { file_path: "src/app.ts" },
    });
    expect(graph.getNode("tool:Read")).toBeDefined();
    expect(graph.getNode("file:src/app.ts")).toBeDefined();
    expect(graph.getAllEdges().some(e => e.type === "reads")).toBe(true);
  });

  it("processes PostToolUse with error detection", () => {
    graph.addNode("tool:Bash", "Bash", "tool");
    processor.process({
      hook_event_name: "PostToolUse", session_id: "s1",
      tool_name: "Bash", tool_response: { stderr: "TypeError: x is not a function" },
    });
    const errors = graph.getNodesByType("error");
    expect(errors.length).toBeGreaterThan(0);
  });

  it("processes PostToolUse Write with decision extraction", () => {
    graph.addNode("tool:Write", "Write", "tool");
    processor.process({
      hook_event_name: "PostToolUse", session_id: "s1",
      tool_name: "Write",
      tool_input: { content: "// DECISION: Use bcrypt instead of argon2 for Alpine compat\nconst hash = bcrypt.hash(pw);" },
    });
    const decisions = graph.getNodesByType("decision");
    expect(decisions.length).toBeGreaterThan(0);
  });

  it("processes SubagentStart", () => {
    processor.process({ hook_event_name: "SessionStart", session_id: "s1" });
    processor.process({ hook_event_name: "SubagentStart", session_id: "s1", agent_type: "Task" });
    const agents = graph.getNodesByType("agent");
    expect(agents.length).toBe(2); // session + subagent
  });

  it("processes PostCompact and marks unlinked decisions", () => {
    graph.addNode("d1", "Use JWT", "decision");
    processor.process({ hook_event_name: "PostCompact", session_id: "s1" });
    expect(graph.getNode("d1")?.qualityImpact).toBeLessThan(0);
  });

  it("always records the hook event itself", () => {
    processor.process({ hook_event_name: "Stop", session_id: "s1" });
    expect(graph.getNode("hook:Stop")).toBeDefined();
  });

  it("handles unknown event gracefully", () => {
    processor.process({ hook_event_name: "FutureEvent", session_id: "s1" });
    expect(graph.getNode("hook:FutureEvent")).toBeDefined(); // recorded but not processed
  });
});

// ═══════════════════════════════════════
// Integration: Full Session Simulation
// ═══════════════════════════════════════

describe("Full Session Simulation", () => {
  it("simulates a real coding session and produces useful metrics", () => {
    // Session start
    processor.process({ hook_event_name: "SessionStart", session_id: "sim", model: "opus-4.6" });

    // User asks a question
    processor.process({ hook_event_name: "UserPromptSubmit", session_id: "sim", tool_input: { prompt: "Implement JWT auth for the Express app" } });

    // Claude reads files
    for (const file of ["src/auth.ts", "src/middleware.ts", "src/app.ts", "package.json"]) {
      processor.process({ hook_event_name: "PreToolUse", session_id: "sim", tool_name: "Read", tool_input: { file_path: file } });
      const n = graph.getNode(`file:${file}`);
      if (n) n.tokenCost = 500;
    }

    // Claude writes code
    processor.process({
      hook_event_name: "PreToolUse", session_id: "sim", tool_name: "Write",
      tool_input: { file_path: "src/auth.ts", content: "// DECISION: Use refresh tokens with 15min TTL\nexport function generateToken() {}" },
    });
    processor.process({
      hook_event_name: "PostToolUse", session_id: "sim", tool_name: "Write",
      tool_input: { content: "// DECISION: Use refresh tokens with 15min TTL\nexport function generateToken() {}" },
    });

    // Claude runs tests
    processor.process({ hook_event_name: "PreToolUse", session_id: "sim", tool_name: "Bash", tool_input: { command: "npm test" } });
    processor.process({ hook_event_name: "PostToolUse", session_id: "sim", tool_name: "Bash", tool_response: { stdout: "All tests passed" } });

    // Get metrics
    const metrics = graph.computeMetrics();

    expect(metrics.nodeCount).toBeGreaterThan(5);
    expect(metrics.edgeCount).toBeGreaterThan(2);
    expect(metrics.qualityScore).toBeGreaterThan(0);
    expect(metrics.qualityScore).toBeLessThanOrEqual(100);
    expect(metrics.tokenBudget.total).toBeGreaterThan(0);

    // Should have file nodes, tool nodes, and at least one decision
    expect(graph.getNodesByType("file").length).toBeGreaterThanOrEqual(4);
    expect(graph.getNodesByType("tool").length).toBeGreaterThanOrEqual(2);
    expect(graph.getNodesByType("decision").length).toBeGreaterThanOrEqual(1);

    // Should generate at least one recommendation
    expect(metrics.recommendations.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════
// Serialization
// ═══════════════════════════════════════

describe("Serialization", () => {
  it("toJSON produces valid structure", () => {
    graph.addNode("a", "test", "file");
    const json = graph.toJSON() as Record<string, unknown>;
    expect(json.nodes).toBeDefined();
    expect(json.edges).toBeDefined();
    expect(json.metrics).toBeDefined();
    expect(json.exportedAt).toBeDefined();
  });

  it("size returns correct counts", () => {
    graph.addNode("a", "a", "file");
    graph.addNode("b", "b", "file");
    graph.addEdge("a", "b", "reads");
    expect(graph.size).toEqual({ nodes: 2, edges: 1 });
  });
});
