/**
 * Graph Explorer Tool — Interactive knowledge graph (JSON + HTML)
 *
 * JSON mode: returns structured data for terminal rendering
 * HTML mode: generates self-contained HTML file and opens in browser
 */
import { type GraphMetrics, type ClusterInfo } from "../../graph/knowledge-graph.js";
export interface GraphExplorerNode {
    id: string;
    name: string;
    type: string;
    brainiac_type: string;
    token_cost: number;
    access_count: number;
    quality_impact: number;
    cluster_id: number;
    keywords: string[];
    degree: number;
}
export interface GraphExplorerEdge {
    source: string;
    target: string;
    type: string;
    weight: number;
}
export interface GraphMetricsSummary {
    qualityScore: number;
    tokenBudget: GraphMetrics["tokenBudget"];
    clusterCount: number;
}
export interface GraphExplorerJsonResult {
    mode: "json";
    nodes: GraphExplorerNode[];
    edges: GraphExplorerEdge[];
    metrics: GraphMetricsSummary;
    clusters: ClusterInfo[];
}
export interface GraphExplorerHtmlResult {
    mode: "html";
    path: string;
    message: string;
    node_count: number;
    edge_count: number;
}
export type GraphExplorerResult = GraphExplorerJsonResult | GraphExplorerHtmlResult;
export declare function computeGraphExplorer(mode?: "json" | "html", filterType?: string, maxNodes?: number, knowledgeDir?: string): Promise<GraphExplorerResult>;
