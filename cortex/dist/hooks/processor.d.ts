/**
 * Hook Event Processor
 *
 * Transforms raw Claude Code hook events into knowledge graph mutations.
 * Each hook event type has a specific handler that extracts entities,
 * relationships, and metrics from the event payload.
 */
import { KnowledgeGraph } from "../graph/knowledge-graph.js";
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
export declare class HookProcessor {
    private graph;
    constructor(graph: KnowledgeGraph);
    process(event: HookEvent): void;
}
