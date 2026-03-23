/**
 * Hook Event Processor
 *
 * Transforms raw Claude Code hook events into knowledge graph mutations.
 * Each hook event type has a specific handler that extracts entities,
 * relationships, and metrics from the event payload.
 */

import { KnowledgeGraph } from "../graph/knowledge-graph.js";
import type { NodeType, EdgeType } from "../graph/knowledge-graph.js";
import { ContextHubIntegration } from "../analyzer/chub-integration.js";

export interface HookEvent {
  hook_event_name: string;
  session_id: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: Record<string, unknown>;
  timestamp?: string;
  agent_type?: string;
  [key: string]: unknown;
}

export class HookProcessor {
  constructor(private graph: KnowledgeGraph) {}

  process(event: HookEvent): void {
    const handler = HANDLERS[event.hook_event_name];
    if (handler) {
      handler(this.graph, event);
    }
    // Always record the hook itself
    const hookNode = this.graph.addNode(
      `hook:${event.hook_event_name}`,
      event.hook_event_name,
      "hook",
      { session_id: event.session_id },
    );
    hookNode.tokenCost += 10; // overhead per hook
  }
}

// ── Per-Event Handlers ──

type EventHandler = (graph: KnowledgeGraph, event: HookEvent) => void;

const HANDLERS: Record<string, EventHandler> = {

  SessionStart(graph, event) {
    graph.addNode("session:current", `Session ${event.session_id}`, "agent", {
      session_id: event.session_id,
      model: String(event.model ?? "unknown"),
      start_type: String(event.source ?? "startup"),
    });
  },

  UserPromptSubmit(graph, event) {
    const content = String(event.tool_input?.prompt ?? event.tool_input?.content ?? "");
    if (!content) return;

    const queryId = `query:${Date.now()}`;
    const node = graph.addNode(queryId, content.slice(0, 80), "query", {
      full_text: content.slice(0, 500),
    });
    node.tokenCost = Math.floor(content.length / 4);

    // Link to session
    if (graph.getNode("session:current")) {
      graph.addEdge("session:current", queryId, "triggers", "user prompt");
    }
  },

  PreToolUse(graph, event) {
    const toolName = event.tool_name ?? "unknown";
    const toolId = `tool:${toolName}`;
    const node = graph.addNode(toolId, toolName, "tool", { tool_type: toolName });
    node.tokenCost += estimateToolTokens(toolName, event.tool_input);

    // Extract file references from tool input
    const filePath = extractFilePath(event.tool_input);
    if (filePath) {
      const fileNode = graph.addNode(`file:${filePath}`, filePath, "file", {});
      fileNode.tokenCost += estimateFileTokens(event.tool_input);

      if (toolName === "Read" || toolName === "Search" || toolName === "Grep") {
        graph.addEdge(toolId, fileNode.id, "reads", `${toolName} access`);
      } else if (toolName === "Write" || toolName === "Edit" || toolName === "MultiEdit") {
        graph.addEdge(toolId, fileNode.id, "writes", `${toolName} modification`);
      }
    }

    // Extract bash commands
    if (toolName === "Bash" && event.tool_input) {
      const cmd = String(event.tool_input.command ?? "");
      if (cmd.includes("test") || cmd.includes("pytest") || cmd.includes("vitest") || cmd.includes("jest")) {
        graph.addNode("pattern:testing", "Test execution", "pattern", { command: cmd.slice(0, 100) });
      }
      if (cmd.includes("git commit") || cmd.includes("git push")) {
        graph.addNode("pattern:git-commit", "Git commit", "pattern", { command: cmd.slice(0, 100) });
      }

      // Context Hub: track chub fetch/annotate commands
      const chub = new ContextHubIntegration(graph);
      chub.processBashCommand(cmd, "");
    }
  },

  PostToolUse(graph, event) {
    const toolName = event.tool_name ?? "unknown";
    const toolId = `tool:${toolName}`;

    // Update the tool node with response info
    const node = graph.getNode(toolId);
    if (node) {
      const responseTokens = estimateResponseTokens(event.tool_response);
      node.tokenCost += responseTokens;
    }

    // Extract decisions from write/edit outputs
    if ((toolName === "Write" || toolName === "Edit") && event.tool_input) {
      const content = String(event.tool_input.content ?? event.tool_input.new_string ?? "");
      extractDecisionsFromCode(graph, content);

      // Context Hub: detect stale API patterns
      const chub = new ContextHubIntegration(graph);
      chub.detectHallucinations(content);
    }

    // Extract errors from bash output
    if (toolName === "Bash" && event.tool_response) {
      const output = String(event.tool_response.stdout ?? event.tool_response.output ?? "");
      const stderr = String(event.tool_response.stderr ?? "");
      if (stderr || output.toLowerCase().includes("error") || output.toLowerCase().includes("fail")) {
        const errorId = `error:${Date.now()}`;
        const errorNode = graph.addNode(errorId, (stderr || output).slice(0, 80), "error", {
          full_output: (stderr || output).slice(0, 500),
          resolved: false,
        });
        errorNode.qualityImpact = -30;
        graph.addEdge(`tool:${toolName}`, errorId, "causes", "command produced error");
      }
    }
  },

  PostToolUseFailure(graph, event) {
    const toolName = event.tool_name ?? "unknown";
    const errorId = `error:fail:${Date.now()}`;
    const node = graph.addNode(errorId, `${toolName} failure`, "error", {
      tool: toolName,
      resolved: false,
    });
    node.qualityImpact = -50;
    if (graph.getNode(`tool:${toolName}`)) {
      graph.addEdge(`tool:${toolName}`, errorId, "causes", "tool execution failed");
    }
  },

  SubagentStart(graph, event) {
    const agentId = `agent:${event.agent_type ?? "subagent"}:${Date.now()}`;
    graph.addNode(agentId, event.agent_type ?? "subagent", "agent", {
      agent_type: String(event.agent_type ?? "Task"),
    });
    if (graph.getNode("session:current")) {
      graph.addEdge("session:current", agentId, "spawns", "delegated task");
    }
  },

  SubagentStop(graph, event) {
    // Mark agent as completed
    const agents = graph.getNodesByType("agent").filter(a => a.name !== "Session");
    const latest = agents.sort((a, b) => b.lastSeen - a.lastSeen)[0];
    if (latest) {
      latest.properties.completed = true;
    }
  },

  PostCompact(graph, event) {
    // Record compaction as a significant event
    const compactId = `event:compact:${Date.now()}`;
    graph.addNode(compactId, "Context Compaction", "pattern", {
      type: "compaction",
      tokens_before: 0,
    });

    // Mark all decisions as at-risk if not persisted
    for (const decision of graph.getNodesByType("decision")) {
      if ((graph.getEdgesFor(decision.id).length) === 0) {
        decision.qualityImpact = -80; // high risk of loss
      }
    }
  },

  Stop(graph, _event) {
    // Update session metrics
    const session = graph.getNode("session:current");
    if (session) {
      session.lastSeen = Date.now();
      session.properties.ended = true;
    }
  },

  Notification(graph, event) {
    // Track notification patterns
    const type = String(event.tool_input?.type ?? "unknown");
    graph.addNode(`notification:${type}`, `Notification: ${type}`, "hook", {
      notification_type: type,
    });
  },
};

// ── Extraction Helpers ──

function extractFilePath(input: Record<string, unknown> | undefined): string | null {
  if (!input) return null;
  const candidates = [input.file_path, input.path, input.filePath, input.file, input.target];
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0 && (c.includes("/") || c.includes("."))) {
      return c;
    }
  }
  return null;
}

function estimateToolTokens(toolName: string, input: Record<string, unknown> | undefined): number {
  if (!input) return 50;
  const str = JSON.stringify(input);
  return Math.floor(str.length / 4);
}

function estimateFileTokens(input: Record<string, unknown> | undefined): number {
  if (!input) return 0;
  const content = String(input.content ?? input.new_string ?? "");
  return Math.floor(content.length / 4);
}

function estimateResponseTokens(response: Record<string, unknown> | undefined): number {
  if (!response) return 0;
  const str = JSON.stringify(response);
  return Math.min(5000, Math.floor(str.length / 4));
}

function extractDecisionsFromCode(graph: KnowledgeGraph, content: string): void {
  // Look for decision-indicating comments
  const decisionPatterns = [
    /\/\/\s*(?:TODO|FIXME|HACK|NOTE|DECISION|IMPORTANT):\s*(.{10,80})/gi,
    /\/\*\*?\s*(?:@decision|@important|@note)\s+(.{10,80})/gi,
  ];
  for (const re of decisionPatterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const id = `decision:code:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`;
      graph.addNode(id, m[1].trim().slice(0, 100), "decision", {
        source: "code_comment",
      });
    }
  }
}
