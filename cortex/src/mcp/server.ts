#!/usr/bin/env node
/**
 * Cortex Dashboard MCP Server
 *
 * Exposes 4 tools for session visualization:
 *   - cortex_token_timeline: Token consumption with spike detection
 *   - cortex_activity_map: Skill/hook activation Gantt chart
 *   - cortex_quality_heatmap: 7-dimension context quality radar
 *   - cortex_graph_explorer: Interactive knowledge graph
 *
 * Runs as StdioServerTransport for Claude Code plugin integration.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { computeTokenTimeline } from "./tools/token-timeline.js";
import { computeActivityMap } from "./tools/activity-map.js";
import { computeQualityHeatmap } from "./tools/quality-heatmap.js";
import { computeGraphExplorer } from "./tools/graph-explorer.js";

const server = new Server(
  { name: "cortex-dashboard", version: "0.3.0" },
  { capabilities: { tools: {} } },
);

// ── Tool Definitions ──

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "cortex_token_timeline",
      description:
        "Token consumption timeline with spike detection. Shows minute-by-minute token usage, identifies sudden spikes, and summarizes cost. Use to find what's eating your context budget.",
      inputSchema: {
        type: "object" as const,
        properties: {
          session_id: { type: "string", description: "Session ID (default: latest)" },
          window_minutes: { type: "number", description: "Time window in minutes (default: 60)" },
        },
      },
    },
    {
      name: "cortex_activity_map",
      description:
        "Gantt-like timeline of skill, hook, and tool activations during a session. Shows what fired, when, and how often. Detects concurrency peaks and busiest periods.",
      inputSchema: {
        type: "object" as const,
        properties: {
          session_id: { type: "string", description: "Session ID (default: latest)" },
          include_hooks: { type: "boolean", description: "Include hook activations (default: true)" },
          include_skills: { type: "boolean", description: "Include skill activations (default: true)" },
        },
      },
    },
    {
      name: "cortex_quality_heatmap",
      description:
        "7-dimension context quality radar chart. Scores semantic relevance, redundancy, distractors, density, fragmentation, structure, and token economics. Shows where context quality is degrading.",
      inputSchema: {
        type: "object" as const,
        properties: {
          context: { type: "string", description: "Context text to score (default: latest snapshot)" },
          query: { type: "string", description: "Query to evaluate against (default: general quality)" },
        },
      },
    },
    {
      name: "cortex_graph_explorer",
      description:
        "Interactive knowledge graph visualization. JSON mode returns structured data for terminal display. HTML mode generates a force-directed graph in the browser with node size = token cost.",
      inputSchema: {
        type: "object" as const,
        properties: {
          mode: {
            type: "string",
            enum: ["json", "html"],
            description: "Output mode: json for terminal, html for browser (default: json)",
          },
          filter_type: {
            type: "string",
            enum: ["file", "function", "tool", "decision", "error", "agent", "pattern", "hook", "skill", "query"],
            description: "Filter by node type",
          },
          max_nodes: { type: "number", description: "Max nodes to return (default: 50)" },
        },
      },
    },
  ],
}));

// ── Tool Dispatch ──

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "cortex_token_timeline": {
        const windowMin = Math.max(1, Math.min((args?.window_minutes as number) ?? 60, 1440));
        const result = computeTokenTimeline(
          args?.session_id as string | undefined,
          windowMin,
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "cortex_activity_map": {
        const result = computeActivityMap(
          args?.session_id as string | undefined,
          (args?.include_hooks as boolean) ?? true,
          (args?.include_skills as boolean) ?? true,
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "cortex_quality_heatmap": {
        const result = computeQualityHeatmap(
          args?.context as string | undefined,
          (args?.query as string) ?? "general session quality",
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "cortex_graph_explorer": {
        const maxNodes = Math.max(1, Math.min((args?.max_nodes as number) ?? 50, 500));
        const result = await computeGraphExplorer(
          (args?.mode as "json" | "html") ?? "json",
          args?.filter_type as string | undefined,
          maxNodes,
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error in ${name}: ${message}` }],
      isError: true,
    };
  }
});

// ── Start Server ──

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Cortex Dashboard MCP server failed to start:", error);
  process.exit(1);
});
