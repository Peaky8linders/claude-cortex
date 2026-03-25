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
import { ListToolsRequestSchema, CallToolRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { computeTokenTimeline } from "./tools/token-timeline.js";
import { computeActivityMap } from "./tools/activity-map.js";
import { computeQualityHeatmap } from "./tools/quality-heatmap.js";
import { computeGraphExplorer } from "./tools/graph-explorer.js";
import { computeUnifiedDashboard } from "./tools/unified-dashboard.js";
const VALID_NODE_TYPES = ["file", "function", "tool", "decision", "error", "agent", "pattern", "hook", "skill", "query"];
const server = new Server({ name: "cortex-dashboard", version: "0.3.0" }, { capabilities: { tools: {} } });
// ── Arg Validation Helpers ──
function asOptionalString(val) {
    return typeof val === "string" ? val : undefined;
}
function asNumber(val, fallback, min, max) {
    const n = typeof val === "number" ? val : fallback;
    return Math.max(min, Math.min(n, max));
}
function asBoolean(val, fallback) {
    return typeof val === "boolean" ? val : fallback;
}
// ── Tool Definitions ──
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: "cortex_token_timeline",
            description: "Token consumption timeline with spike detection. Shows minute-by-minute token usage, identifies sudden spikes, and summarizes cost. Use to find what's eating your context budget.",
            inputSchema: {
                type: "object",
                properties: {
                    session_id: { type: "string", description: "Session ID (default: latest)" },
                    window_minutes: { type: "number", description: "Time window in minutes (default: 60, max: 1440)" },
                },
            },
        },
        {
            name: "cortex_activity_map",
            description: "Gantt-like timeline of skill, hook, and tool activations during a session. Shows what fired, when, and how often. Detects concurrency peaks and busiest periods.",
            inputSchema: {
                type: "object",
                properties: {
                    session_id: { type: "string", description: "Session ID (default: latest)" },
                    include_hooks: { type: "boolean", description: "Include hook activations (default: true)" },
                    include_skills: { type: "boolean", description: "Include skill activations (default: true)" },
                },
            },
        },
        {
            name: "cortex_quality_heatmap",
            description: "7-dimension context quality radar chart. Scores semantic relevance, redundancy, distractors, density, fragmentation, structure, and token economics. Shows where context quality is degrading.",
            inputSchema: {
                type: "object",
                properties: {
                    context: { type: "string", description: "Context text to score (default: latest snapshot)" },
                    query: { type: "string", description: "Query to evaluate against (default: general quality)" },
                },
            },
        },
        {
            name: "cortex_graph_explorer",
            description: "Interactive knowledge graph visualization. JSON mode returns structured data for terminal display. HTML mode generates a force-directed graph in the browser with node size = token cost.",
            inputSchema: {
                type: "object",
                properties: {
                    mode: {
                        type: "string",
                        enum: ["json", "html"],
                        description: "Output mode: json for terminal, html for browser (default: json)",
                    },
                    filter_type: {
                        type: "string",
                        enum: [...VALID_NODE_TYPES],
                        description: "Filter by node type",
                    },
                    max_nodes: { type: "number", description: "Max nodes to return (default: 50, max: 500)" },
                },
            },
        },
        {
            name: "cortex_dashboard",
            description: "Unified session dashboard — KPIs, charts, timeline, quality radar, cost breakdown, and knowledge graph in one page. Opens in browser.",
            inputSchema: {
                type: "object",
                properties: {
                    session_id: { type: "string", description: "Session ID (default: latest)" },
                    cross_session: { type: "boolean", description: "Include cross-session history and trends (default: false)" },
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
                const result = computeTokenTimeline(asOptionalString(args?.session_id), asNumber(args?.window_minutes, 60, 1, 1440));
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
            }
            case "cortex_activity_map": {
                const result = computeActivityMap(asOptionalString(args?.session_id), asBoolean(args?.include_hooks, true), asBoolean(args?.include_skills, true));
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
            }
            case "cortex_quality_heatmap": {
                const result = await computeQualityHeatmap(asOptionalString(args?.context), typeof args?.query === "string" ? args.query : "general session quality");
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
            }
            case "cortex_graph_explorer": {
                const filterType = asOptionalString(args?.filter_type);
                if (filterType && !VALID_NODE_TYPES.includes(filterType)) {
                    return {
                        content: [{ type: "text", text: `Invalid filter_type: ${filterType}. Valid types: ${VALID_NODE_TYPES.join(", ")}` }],
                        isError: true,
                    };
                }
                const result = await computeGraphExplorer(asOptionalString(args?.mode) ?? "json", filterType, asNumber(args?.max_nodes, 50, 1, 500));
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
            }
            case "cortex_dashboard": {
                const result = await computeUnifiedDashboard(asOptionalString(args?.session_id), asBoolean(args?.cross_session, false));
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
            }
            default:
                return {
                    content: [{ type: "text", text: `Unknown tool: ${name}` }],
                    isError: true,
                };
        }
    }
    catch (error) {
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
