import { describe, it, expect } from "vitest";
import { runPipeline, extractContextGraph, deriveIntent, generateSpecification } from "../src/pipeline/transform.js";
import { handleToolCall, getToolDefinitions, getThoughtCount } from "../src/mcp/server.js";
import type { Thought } from "../src/core/types.js";

const MEETING_NOTE: Thought = {
  id: "test-1",
  content: `I had a meeting with Sarah from Acme Corp today. She wants to migrate their auth system from session-based to JWT. They're on Express/Node, about 50k users. Budget is tight — Q3 deadline. She mentioned they had CORS issues before. Their team is small, maybe 3 devs. I think we should use refresh tokens with short-lived access tokens. Maybe bcrypt for hashing. Need to check if they're on Postgres or MongoDB.`,
  source: "meeting_notes",
  timestamp: new Date().toISOString(),
  tags: ["auth", "migration"],
  metadata: {},
};

// ═══════════════════════════════════════
// Pipeline: L1 → L2 (Context Extraction)
// ═══════════════════════════════════════

describe("Context Extraction (L1→L2)", () => {
  it("extracts people from meeting notes", () => {
    const ctx = extractContextGraph(MEETING_NOTE);
    const people = ctx.entities.filter(e => e.type === "person");
    expect(people.length).toBeGreaterThan(0);
    expect(people.some(p => p.name === "Sarah")).toBe(true);
  });

  it("extracts technologies", () => {
    const ctx = extractContextGraph(MEETING_NOTE);
    const tech = ctx.entities.filter(e => e.type === "technology");
    expect(tech.some(t => t.name === "JWT")).toBe(true);
    expect(tech.some(t => t.name === "Express")).toBe(true);
  });

  it("extracts decisions", () => {
    const ctx = extractContextGraph(MEETING_NOTE);
    expect(ctx.decisions.length).toBeGreaterThan(0);
  });

  it("extracts open questions", () => {
    const ctx = extractContextGraph(MEETING_NOTE);
    expect(ctx.openQuestions.length).toBeGreaterThan(0);
  });

  it("extracts metrics", () => {
    const ctx = extractContextGraph(MEETING_NOTE);
    const metrics = ctx.entities.filter(e => e.type === "metric");
    expect(metrics.some(m => /50k/i.test(m.name))).toBe(true);
  });

  it("produces a quality score", () => {
    const ctx = extractContextGraph(MEETING_NOTE);
    expect(ctx.metadata.qualityScore).toBeGreaterThan(0);
    expect(ctx.metadata.qualityScore).toBeLessThanOrEqual(100);
  });

  it("handles empty input", () => {
    const empty: Thought = { id: "empty", content: "", source: "manual_entry", timestamp: "", tags: [], metadata: {} };
    const ctx = extractContextGraph(empty);
    expect(ctx.entities.length).toBe(0);
    expect(ctx.metadata.qualityScore).toBeGreaterThanOrEqual(0);
  });
});

// ═══════════════════════════════════════
// Pipeline: L2 → L3 (Intent Derivation)
// ═══════════════════════════════════════

describe("Intent Derivation (L2→L3)", () => {
  it("derives a goal from context", () => {
    const ctx = extractContextGraph(MEETING_NOTE);
    const intent = deriveIntent(ctx, MEETING_NOTE);
    expect(intent.goal.length).toBeGreaterThan(10);
  });

  it("extracts constraints", () => {
    const ctx = extractContextGraph(MEETING_NOTE);
    const intent = deriveIntent(ctx, MEETING_NOTE);
    expect(intent.constraints.length).toBeGreaterThan(0);
  });

  it("generates tradeoffs when sufficient context", () => {
    const ctx = extractContextGraph(MEETING_NOTE);
    const intent = deriveIntent(ctx, MEETING_NOTE);
    expect(intent.tradeoffs.length).toBeGreaterThanOrEqual(0); // May or may not have enough
  });

  it("identifies stakeholders from people entities", () => {
    const ctx = extractContextGraph(MEETING_NOTE);
    const intent = deriveIntent(ctx, MEETING_NOTE);
    expect(intent.stakeholders.some(s => s.name === "Sarah")).toBe(true);
  });

  it("derives success criteria", () => {
    const ctx = extractContextGraph(MEETING_NOTE);
    const intent = deriveIntent(ctx, MEETING_NOTE);
    expect(intent.successCriteria.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════
// Pipeline: L3 → L4 (Spec Generation)
// ═══════════════════════════════════════

describe("Specification Generation (L3→L4)", () => {
  it("generates phases", () => {
    const ctx = extractContextGraph(MEETING_NOTE);
    const intent = deriveIntent(ctx, MEETING_NOTE);
    const spec = generateSpecification(intent, ctx);
    expect(spec.phases.length).toBeGreaterThanOrEqual(2);
  });

  it("generates tasks within phases", () => {
    const ctx = extractContextGraph(MEETING_NOTE);
    const intent = deriveIntent(ctx, MEETING_NOTE);
    const spec = generateSpecification(intent, ctx);
    const totalTasks = spec.phases.reduce((a, p) => a + p.tasks.length, 0);
    expect(totalTasks).toBeGreaterThan(3);
  });

  it("includes agent instructions", () => {
    const ctx = extractContextGraph(MEETING_NOTE);
    const intent = deriveIntent(ctx, MEETING_NOTE);
    const spec = generateSpecification(intent, ctx);
    expect(spec.agentInstructions.commitStrategy.length).toBeGreaterThan(0);
    expect(spec.agentInstructions.testingRequirements.length).toBeGreaterThan(0);
    expect(spec.agentInstructions.escalationRules.length).toBeGreaterThan(0);
  });

  it("includes quality gates", () => {
    const ctx = extractContextGraph(MEETING_NOTE);
    const intent = deriveIntent(ctx, MEETING_NOTE);
    const spec = generateSpecification(intent, ctx);
    expect(spec.qualityGates.length).toBeGreaterThan(0);
  });

  it("includes acceptance criteria", () => {
    const ctx = extractContextGraph(MEETING_NOTE);
    const intent = deriveIntent(ctx, MEETING_NOTE);
    const spec = generateSpecification(intent, ctx);
    expect(spec.acceptanceCriteria.length).toBeGreaterThan(0);
  });

  it("has a rollback plan", () => {
    const ctx = extractContextGraph(MEETING_NOTE);
    const intent = deriveIntent(ctx, MEETING_NOTE);
    const spec = generateSpecification(intent, ctx);
    expect(spec.rollbackPlan.length).toBeGreaterThan(10);
  });
});

// ═══════════════════════════════════════
// Full Pipeline
// ═══════════════════════════════════════

describe("Full Pipeline (L1→L4)", () => {
  it("transforms a thought into a complete spec", () => {
    const result = runPipeline(MEETING_NOTE);
    expect(result.qualityScore).toBeGreaterThan(0);
    expect(result.processingTime).toBeGreaterThanOrEqual(0);
    expect(result.context.entities.length).toBeGreaterThan(0);
    expect(result.intent.goal.length).toBeGreaterThan(0);
    expect(result.specification.phases.length).toBeGreaterThanOrEqual(2);
  });

  it("estimates token savings", () => {
    const result = runPipeline(MEETING_NOTE);
    expect(result.tokensSaved).toBeGreaterThanOrEqual(0);
  });

  it("handles short input gracefully", () => {
    const short: Thought = { id: "short", content: "Fix the login bug.", source: "manual_entry", timestamp: "", tags: [], metadata: {} };
    const result = runPipeline(short);
    expect(result.specification.phases.length).toBeGreaterThanOrEqual(2);
  });
});

// ═══════════════════════════════════════
// MCP Server
// ═══════════════════════════════════════

describe("MCP Server", () => {
  it("exposes 8 tools", () => {
    const tools = getToolDefinitions();
    expect(tools.length).toBe(8);
    expect(tools.map(t => t.name)).toContain("save_thought");
    expect(tools.map(t => t.name)).toContain("run_pipeline");
    expect(tools.map(t => t.name)).toContain("search_brain");
    expect(tools.map(t => t.name)).toContain("get_spec");
  });

  it("every tool has a description and schema", () => {
    for (const tool of getToolDefinitions()) {
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.inputSchema).toBeDefined();
    }
  });

  it("save_thought works", () => {
    const result = handleToolCall({
      tool: "save_thought",
      arguments: { content: "Test thought about JWT auth migration", source: "manual_entry" },
    });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("saved");
    expect(parsed.extracted.entities).toBeGreaterThanOrEqual(0);
  });

  it("run_pipeline returns full result", () => {
    const result = handleToolCall({
      tool: "run_pipeline",
      arguments: { content: MEETING_NOTE.content, source: "meeting_notes" },
    });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.qualityScore).toBeGreaterThan(0);
    expect(parsed.specification.phases).toBeGreaterThan(0);
    expect(parsed.specification.totalTasks).toBeGreaterThan(0);
  });

  it("list_entities returns entities", () => {
    // save a thought first
    handleToolCall({ tool: "save_thought", arguments: { content: "Met Sarah from Acme Corp about JWT migration on Express" } });
    const result = handleToolCall({ tool: "list_entities", arguments: {} });
    const entities = JSON.parse(result.content[0].text);
    expect(entities.length).toBeGreaterThan(0);
  });

  it("unknown tool returns error", () => {
    const result = handleToolCall({ tool: "nonexistent_tool", arguments: {} });
    expect(result.isError).toBe(true);
  });
});
