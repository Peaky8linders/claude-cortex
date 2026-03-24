/**
 * Context Hub Integration
 *
 * Bridges Andrew Ng's Context Hub (chub) into the Cortex knowledge graph.
 *
 * What this does:
 *   1. Tracks which chub docs agents fetch (PostToolUse on Bash containing "chub get")
 *   2. Detects when agents ignore chub and use stale training data instead
 *   3. Auto-generates chub annotations from error resolutions in the graph
 *   4. Recommends chub docs when agents hallucinate API calls
 *
 * For real engineers: this is NOT a wrapper around chub. Chub handles docs.
 * Cortex handles the graph that tells you whether those docs helped and
 * what your agent learned that should be annotated back.
 */
import { KnowledgeGraph } from "../graph/knowledge-graph.js";
import type { Recommendation } from "../graph/knowledge-graph.js";
export interface ChubDocUsage {
    docId: string;
    language: string;
    fetchCount: number;
    lastFetched: number;
    annotations: string[];
    impactScore: number;
}
export declare class ContextHubIntegration {
    private graph;
    private docUsage;
    constructor(graph: KnowledgeGraph);
    /**
     * Process a Bash tool event to detect chub usage.
     * Call this from the HookProcessor when tool_name === "Bash".
     */
    processBashCommand(command: string, output: string): void;
    /**
     * Scan code content for stale API patterns that chub could fix.
     * Call this from PostToolUse on Write/Edit events.
     */
    detectHallucinations(codeContent: string): Recommendation[];
    /**
     * Generate chub annotations from error resolutions in the graph.
     * This is the "agents get smarter" loop — what Cortex learns
     * gets annotated back to Context Hub for the whole community.
     */
    generateAutoAnnotations(): Array<{
        docId: string;
        annotation: string;
        command: string;
    }>;
    /**
     * Check if chub is installed and available.
     */
    isChubAvailable(): boolean;
    /**
     * Get all chub-related recommendations for the current session.
     */
    getRecommendations(): Recommendation[];
    private recordDocFetch;
    private recordAnnotation;
    /** Get usage stats for all tracked chub docs */
    getDocUsage(): ChubDocUsage[];
}
