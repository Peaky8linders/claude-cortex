/**
 * Cortex Knowledge Graph
 *
 * A live, in-memory knowledge graph that builds itself from Claude Code
 * hook events. Every tool call, file access, decision, and error becomes
 * a node or edge in the graph. This is NOT a static visualization —
 * it's a queryable, scorable, optimizable data structure.
 *
 * Graph Structure (based on latest KG research):
 *   Nodes: Entity (file, function, decision, error, tool, agent, pattern)
 *   Edges: Relationship (reads, writes, calls, decides, fixes, depends_on)
 *   Properties: timestamps, frequency, quality score, token cost
 *
 * Louvain community detection identifies clusters.
 * Centrality scoring identifies critical nodes.
 * Temporal decay weights recent activity higher.
 */
export type NodeType = "file" | "function" | "tool" | "decision" | "error" | "agent" | "pattern" | "hook" | "skill" | "query";
export type EdgeType = "reads" | "writes" | "modifies" | "calls" | "decides" | "fixes" | "causes" | "depends_on" | "spawns" | "triggers" | "follows" | "related_to";
export interface GraphNode {
    id: string;
    name: string;
    type: NodeType;
    properties: Record<string, string | number | boolean>;
    firstSeen: number;
    lastSeen: number;
    accessCount: number;
    tokenCost: number;
    qualityImpact: number;
}
export interface GraphEdge {
    source: string;
    target: string;
    type: EdgeType;
    weight: number;
    context: string;
    timestamp: number;
}
export interface GraphMetrics {
    nodeCount: number;
    edgeCount: number;
    density: number;
    clusters: ClusterInfo[];
    hotNodes: GraphNode[];
    coldNodes: GraphNode[];
    criticalPath: string[];
    qualityScore: number;
    tokenBudget: TokenBudget;
    recommendations: Recommendation[];
}
export interface ClusterInfo {
    id: number;
    name: string;
    nodes: string[];
    cohesion: number;
    dominantType: NodeType;
}
export interface TokenBudget {
    total: number;
    used: number;
    wasted: number;
    byNodeType: Record<NodeType, number>;
    efficiency: number;
}
export interface Recommendation {
    id: string;
    type: "optimize" | "warning" | "suggestion" | "critical";
    title: string;
    description: string;
    action: string;
    impact: string;
    affectedNodes: string[];
    estimatedSavings: number;
}
export declare class KnowledgeGraph {
    private nodes;
    private edges;
    private adjacency;
    addNode(id: string, name: string, type: NodeType, properties?: Record<string, string | number | boolean>): GraphNode;
    addEdge(source: string, target: string, type: EdgeType, context?: string): GraphEdge;
    updateTokenCost(nodeId: string, tokens: number): void;
    setQualityImpact(nodeId: string, impact: number): void;
    getNode(id: string): GraphNode | undefined;
    getAllNodes(): GraphNode[];
    getAllEdges(): GraphEdge[];
    getNodesByType(type: NodeType): GraphNode[];
    getNeighbors(nodeId: string): GraphNode[];
    getEdgesFor(nodeId: string): GraphEdge[];
    computeMetrics(): GraphMetrics;
    private detectClusters;
    private computeClusterCohesion;
    private computeTokenBudget;
    private computeQualityScore;
    private generateRecommendations;
    toJSON(): object;
    get size(): {
        nodes: number;
        edges: number;
    };
}
