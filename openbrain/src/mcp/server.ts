/**
 * OpenBrain MCP Server
 *
 * Model Context Protocol server that exposes the Open Brain to ANY AI tool.
 * This is what breaks the memory silos — Claude, ChatGPT, Cursor, Copilot
 * all read/write to the same brain via MCP.
 *
 * Tools exposed:
 *   - save_thought       → Capture raw thoughts into the brain
 *   - search_brain       → Semantic search across all thoughts + entities
 *   - get_context        → Get structured context for a query (L2)
 *   - get_intent         → Derive intent from context (L3)
 *   - get_spec           → Generate agent-ready spec (L4)
 *   - run_pipeline       → Full L1→L4 transformation
 *   - list_decisions     → List all captured decisions
 *   - list_entities      → List all known entities
 */

import type { MCPTool, MCPToolCall, MCPToolResult, Thought, ThoughtSource } from "../core/types.js";
import { runPipeline, extractContextGraph, deriveIntent, generateSpecification } from "../pipeline/transform.js";
import { generateId } from "../pipeline/utils.js";

// ── In-memory store (replace with Supabase in production) ──
const thoughtStore: Thought[] = [];
const TOOLS: MCPTool[] = [
  {
    name: "save_thought",
    description: "Save a thought, note, or observation to the Open Brain. Extracts entities, decisions, and patterns automatically.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "The raw thought or note content" },
        source: { type: "string", enum: ["meeting_notes","slack_message","voice_memo","manual_entry","email","document","code_comment","chat_history"], description: "Where this thought came from" },
        tags: { type: "array", items: { type: "string" }, description: "Optional tags for categorization" },
      },
      required: ["content"],
    },
  },
  {
    name: "search_brain",
    description: "Search the Open Brain for relevant thoughts, entities, and decisions. Uses keyword matching (semantic search with pgvector in production).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search for" },
        limit: { type: "number", description: "Max results (default: 5)" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_context",
    description: "Get structured context (Level 2) for a query — entities, decisions, open questions, patterns extracted from matching thoughts.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The topic or question to get context for" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_intent",
    description: "Derive strategic intent (Level 3) from structured context — goals, constraints, success criteria, tradeoffs.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The goal or project to derive intent for" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_spec",
    description: "Generate an agent-ready specification (Level 4) — phased tasks, agent instructions, quality gates. The AUTOPILOT output.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to generate a spec for" },
      },
      required: ["query"],
    },
  },
  {
    name: "run_pipeline",
    description: "Run the full transformation pipeline: Thought → Context → Intent → Spec. Returns the complete result with quality score.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Raw thought or meeting notes to transform" },
        source: { type: "string", description: "Where this came from" },
      },
      required: ["content"],
    },
  },
  {
    name: "list_decisions",
    description: "List all decisions captured in the Open Brain, with reasoning and status.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_entities",
    description: "List all known entities (people, orgs, tech, projects) in the Open Brain.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", description: "Filter by entity type (person, organization, technology, project)" },
      },
    },
  },
];

// ── Tool Handlers ──

const MAX_CONTENT_LENGTH = 50_000;

function validateContent(content: string): MCPToolResult | null {
  if (content.length > MAX_CONTENT_LENGTH) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: `Content too large (${content.length} chars). Max: ${MAX_CONTENT_LENGTH}.` }) }],
      isError: true,
    };
  }
  return null;
}

function handleSaveThought(args: Record<string, unknown>): MCPToolResult {
  const content = String(args.content ?? "");
  const sizeErr = validateContent(content);
  if (sizeErr) return sizeErr;

  const thought: Thought = {
    id: generateId("thought"),
    content,
    source: (args.source as ThoughtSource) ?? "manual_entry",
    timestamp: new Date().toISOString(),
    tags: (args.tags as string[]) ?? [],
    metadata: {},
  };
  thoughtStore.push(thought);

  const ctx = extractContextGraph(thought);
  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        status: "saved",
        thoughtId: thought.id,
        extracted: {
          entities: ctx.entities.length,
          decisions: ctx.decisions.length,
          openQuestions: ctx.openQuestions.length,
          patterns: ctx.patterns.length,
        },
        qualityScore: ctx.metadata.qualityScore,
      }, null, 2),
    }],
  };
}

function handleSearchBrain(args: Record<string, unknown>): MCPToolResult {
  const query = String(args.query ?? "").toLowerCase();
  const limit = Number(args.limit ?? 5);

  // Keyword search (semantic search via pgvector in production)
  const queryWords = query.split(/\s+/).filter(w => w.length > 2);
  const results = thoughtStore
    .map(t => {
      const content = t.content.toLowerCase();
      const score = queryWords.reduce((s, w) => s + (content.includes(w) ? 1 : 0), 0);
      return { thought: t, score };
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        results: results.map(r => ({
          id: r.thought.id,
          content: r.thought.content.slice(0, 200),
          source: r.thought.source,
          relevance: r.score / queryWords.length,
          timestamp: r.thought.timestamp,
        })),
        total: results.length,
      }, null, 2),
    }],
  };
}

function handleGetContext(args: Record<string, unknown>): MCPToolResult {
  const query = String(args.query ?? "");
  const combined = getMergedThoughtContent(query);
  const thought: Thought = { id: "query", content: combined, source: "manual_entry", timestamp: new Date().toISOString(), tags: [], metadata: {} };
  const ctx = extractContextGraph(thought);

  return {
    content: [{ type: "text", text: JSON.stringify(ctx, null, 2) }],
  };
}

function handleGetIntent(args: Record<string, unknown>): MCPToolResult {
  const query = String(args.query ?? "");
  const combined = getMergedThoughtContent(query);
  const thought: Thought = { id: "query", content: combined, source: "manual_entry", timestamp: new Date().toISOString(), tags: [], metadata: {} };
  const ctx = extractContextGraph(thought);
  const intent = deriveIntent(ctx, thought);

  return {
    content: [{ type: "text", text: JSON.stringify(intent, null, 2) }],
  };
}

function handleGetSpec(args: Record<string, unknown>): MCPToolResult {
  const query = String(args.query ?? "");
  const combined = getMergedThoughtContent(query);
  const thought: Thought = { id: "query", content: combined, source: "manual_entry", timestamp: new Date().toISOString(), tags: [], metadata: {} };
  const ctx = extractContextGraph(thought);
  const intent = deriveIntent(ctx, thought);
  const spec = generateSpecification(intent, ctx);

  return {
    content: [{ type: "text", text: JSON.stringify(spec, null, 2) }],
  };
}

function handleRunPipeline(args: Record<string, unknown>): MCPToolResult {
  const thought: Thought = {
    id: generateId("thought"),
    content: String(args.content ?? ""),
    source: (args.source as ThoughtSource) ?? "manual_entry",
    timestamp: new Date().toISOString(),
    tags: [],
    metadata: {},
  };
  thoughtStore.push(thought);
  const result = runPipeline(thought);

  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        qualityScore: result.qualityScore,
        processingTime: `${result.processingTime}ms`,
        tokensSaved: result.tokensSaved,
        context: {
          entities: result.context.entities.length,
          decisions: result.context.decisions.length,
          openQuestions: result.context.openQuestions.length,
        },
        intent: {
          goal: result.intent.goal,
          constraints: result.intent.constraints.length,
          tradeoffs: result.intent.tradeoffs.length,
        },
        specification: {
          phases: result.specification.phases.length,
          totalTasks: result.specification.phases.reduce((a, p) => a + p.tasks.length, 0),
          title: result.specification.title,
        },
        fullSpec: result.specification,
      }, null, 2),
    }],
  };
}

function handleListDecisions(): MCPToolResult {
  const allDecisions = thoughtStore.flatMap(t => extractContextGraph(t).decisions);
  return {
    content: [{ type: "text", text: JSON.stringify(allDecisions, null, 2) }],
  };
}

function handleListEntities(args: Record<string, unknown>): MCPToolResult {
  const typeFilter = args.type ? String(args.type) : undefined;
  const allEntities = thoughtStore.flatMap(t => extractContextGraph(t).entities);
  const filtered = typeFilter ? allEntities.filter(e => e.type === typeFilter) : allEntities;
  // Deduplicate by name
  const unique = new Map<string, typeof filtered[0]>();
  for (const e of filtered) {
    const key = e.name.toLowerCase();
    if (!unique.has(key)) unique.set(key, e);
    else {
      const existing = unique.get(key)!;
      existing.mentionCount += 1;
      existing.lastSeen = e.lastSeen;
    }
  }

  return {
    content: [{ type: "text", text: JSON.stringify([...unique.values()], null, 2) }],
  };
}

// ── Helpers ──

function getMergedThoughtContent(query: string): string {
  // Get all thoughts that match the query, or all if no match
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const matching = thoughtStore.filter(t => {
    const lower = t.content.toLowerCase();
    return queryWords.some(w => lower.includes(w));
  });
  const source = matching.length > 0 ? matching : thoughtStore;
  return source.map(t => t.content).join("\n\n") || query;
}

// ── MCP Router ──

export function handleToolCall(call: MCPToolCall): MCPToolResult {
  switch (call.tool) {
    case "save_thought": return handleSaveThought(call.arguments);
    case "search_brain": return handleSearchBrain(call.arguments);
    case "get_context": return handleGetContext(call.arguments);
    case "get_intent": return handleGetIntent(call.arguments);
    case "get_spec": return handleGetSpec(call.arguments);
    case "run_pipeline": return handleRunPipeline(call.arguments);
    case "list_decisions": return handleListDecisions();
    case "list_entities": return handleListEntities(call.arguments);
    default:
      return { content: [{ type: "text", text: `Unknown tool: ${call.tool}` }], isError: true };
  }
}

export function getToolDefinitions(): MCPTool[] {
  return TOOLS;
}

export function getThoughtCount(): number {
  return thoughtStore.length;
}
