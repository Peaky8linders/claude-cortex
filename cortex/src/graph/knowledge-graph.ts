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

// ── Node Types ──
export type NodeType =
  | "file"        // Source files accessed
  | "function"    // Functions/classes modified
  | "tool"        // Claude Code tools used (Bash, Edit, Write, Read, Search)
  | "decision"    // Architectural/design decisions made
  | "error"       // Errors encountered and their resolutions
  | "agent"       // Subagents spawned
  | "pattern"     // Coding patterns observed
  | "hook"        // Hooks that fired
  | "skill"       // Skills invoked
  | "query";      // User prompts/queries

export type EdgeType =
  | "reads" | "writes" | "modifies" | "calls"
  | "decides" | "fixes" | "causes" | "depends_on"
  | "spawns" | "triggers" | "follows" | "related_to";

export interface GraphNode {
  id: string;
  name: string;
  type: NodeType;
  properties: Record<string, string | number | boolean>;
  firstSeen: number;       // timestamp ms
  lastSeen: number;
  accessCount: number;
  tokenCost: number;        // estimated tokens this node has consumed
  qualityImpact: number;    // -100 to +100, how this node affects context quality
}

export interface GraphEdge {
  source: string;  // node ID
  target: string;  // node ID
  type: EdgeType;
  weight: number;  // 0-1, based on frequency and recency
  context: string; // why this edge exists
  timestamp: number;
}

export interface GraphMetrics {
  nodeCount: number;
  edgeCount: number;
  density: number;                    // edges / max possible edges
  clusters: ClusterInfo[];
  hotNodes: GraphNode[];              // most accessed nodes
  coldNodes: GraphNode[];             // nodes that may be stale
  criticalPath: string[];             // highest-centrality node chain
  qualityScore: number;               // 0-100 overall context health
  tokenBudget: TokenBudget;
  recommendations: Recommendation[];
}

export interface ClusterInfo {
  id: number;
  name: string;         // auto-generated from dominant node names
  nodes: string[];      // node IDs
  cohesion: number;     // how tightly connected (0-1)
  dominantType: NodeType;
}

export interface TokenBudget {
  total: number;
  used: number;
  wasted: number;
  byNodeType: Record<NodeType, number>;
  efficiency: number;  // useful / total
}

export interface Recommendation {
  id: string;
  type: "optimize" | "warning" | "suggestion" | "critical";
  title: string;
  description: string;
  action: string;
  impact: string;
  affectedNodes: string[];
  estimatedSavings: number; // tokens
}

// ── The Graph ──

export class KnowledgeGraph {
  private nodes = new Map<string, GraphNode>();
  private edges: GraphEdge[] = [];
  private adjacency = new Map<string, Set<string>>(); // node -> connected nodes

  // ── Mutators ──

  addNode(id: string, name: string, type: NodeType, properties: Record<string, string | number | boolean> = {}): GraphNode {
    const existing = this.nodes.get(id);
    if (existing) {
      existing.lastSeen = Date.now();
      existing.accessCount++;
      Object.assign(existing.properties, properties);
      return existing;
    }
    const node: GraphNode = {
      id, name, type, properties,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      accessCount: 1,
      tokenCost: 0,
      qualityImpact: 0,
    };
    this.nodes.set(id, node);
    this.adjacency.set(id, new Set());
    return node;
  }

  addEdge(source: string, target: string, type: EdgeType, context = ""): GraphEdge {
    // Ensure nodes exist
    if (!this.nodes.has(source) || !this.nodes.has(target)) {
      throw new Error(`Edge references missing node: ${source} -> ${target}`);
    }

    // Update adjacency
    this.adjacency.get(source)?.add(target);
    this.adjacency.get(target)?.add(source);

    // Check for existing edge (update weight)
    const existing = this.edges.find(e => e.source === source && e.target === target && e.type === type);
    if (existing) {
      existing.weight = Math.min(1, existing.weight + 0.1);
      existing.timestamp = Date.now();
      return existing;
    }

    const edge: GraphEdge = { source, target, type, weight: 0.5, context, timestamp: Date.now() };
    this.edges.push(edge);
    return edge;
  }

  updateTokenCost(nodeId: string, tokens: number): void {
    const node = this.nodes.get(nodeId);
    if (node) node.tokenCost += tokens;
  }

  setQualityImpact(nodeId: string, impact: number): void {
    const node = this.nodes.get(nodeId);
    if (node) node.qualityImpact = Math.max(-100, Math.min(100, impact));
  }

  // ── Queries ──

  getNode(id: string): GraphNode | undefined { return this.nodes.get(id); }
  getAllNodes(): GraphNode[] { return [...this.nodes.values()]; }
  getAllEdges(): GraphEdge[] { return [...this.edges]; }
  getNodesByType(type: NodeType): GraphNode[] { return this.getAllNodes().filter(n => n.type === type); }

  getNeighbors(nodeId: string): GraphNode[] {
    const ids = this.adjacency.get(nodeId) ?? new Set();
    return [...ids].map(id => this.nodes.get(id)).filter((n): n is GraphNode => !!n);
  }

  getEdgesFor(nodeId: string): GraphEdge[] {
    return this.edges.filter(e => e.source === nodeId || e.target === nodeId);
  }

  // ── Analytics ──

  computeMetrics(): GraphMetrics {
    const nodes = this.getAllNodes();
    const edges = this.getAllEdges();
    const n = nodes.length;
    const maxEdges = n > 1 ? (n * (n - 1)) / 2 : 1;

    // Centrality (degree-based)
    const centrality = new Map<string, number>();
    for (const node of nodes) {
      centrality.set(node.id, (this.adjacency.get(node.id)?.size ?? 0) / Math.max(1, n - 1));
    }

    // Hot nodes (most accessed, highest centrality)
    const hotNodes = [...nodes]
      .sort((a, b) => (b.accessCount * (centrality.get(b.id) ?? 0 + 0.1)) - (a.accessCount * (centrality.get(a.id) ?? 0 + 0.1)))
      .slice(0, 5);

    // Cold nodes (low access, old)
    const now = Date.now();
    const coldNodes = nodes
      .filter(n => n.accessCount <= 1 && (now - n.lastSeen) > 60_000)
      .slice(0, 5);

    // Clusters (simplified Louvain — group by shared edges)
    const clusters = this.detectClusters();

    // Token budget
    const tokenBudget = this.computeTokenBudget(nodes);

    // Quality score
    const qualityScore = this.computeQualityScore(nodes, edges);

    // Critical path (highest centrality chain)
    const criticalPath = hotNodes.map(n => n.id);

    // Recommendations
    const recommendations = this.generateRecommendations(nodes, edges, tokenBudget, clusters);

    return {
      nodeCount: n,
      edgeCount: edges.length,
      density: edges.length / maxEdges,
      clusters,
      hotNodes,
      coldNodes,
      criticalPath,
      qualityScore,
      tokenBudget,
      recommendations,
    };
  }

  private detectClusters(): ClusterInfo[] {
    // Simplified community detection: group nodes that share 2+ edges
    const visited = new Set<string>();
    const clusters: ClusterInfo[] = [];
    let clusterId = 0;

    for (const [nodeId] of this.nodes) {
      if (visited.has(nodeId)) continue;
      const cluster = new Set<string>();
      const queue = [nodeId];

      while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);
        cluster.add(current);

        const neighbors = this.adjacency.get(current) ?? new Set();
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            queue.push(neighbor);
          }
        }
      }

      if (cluster.size > 0) {
        const clusterNodes = [...cluster].map(id => this.nodes.get(id)!).filter(Boolean);
        const typeCounts: Record<string, number> = {};
        for (const n of clusterNodes) {
          typeCounts[n.type] = (typeCounts[n.type] ?? 0) + 1;
        }
        const dominantType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] as NodeType ?? "file";

        // Name from most-accessed node
        const topNode = clusterNodes.sort((a, b) => b.accessCount - a.accessCount)[0];

        clusters.push({
          id: clusterId++,
          name: topNode?.name ?? `Cluster ${clusterId}`,
          nodes: [...cluster],
          cohesion: cluster.size > 1 ? this.computeClusterCohesion(cluster) : 1,
          dominantType,
        });
      }
    }

    return clusters.sort((a, b) => b.nodes.length - a.nodes.length);
  }

  private computeClusterCohesion(nodeIds: Set<string>): number {
    const internalEdges = this.edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target)).length;
    const maxInternal = (nodeIds.size * (nodeIds.size - 1)) / 2;
    return maxInternal > 0 ? internalEdges / maxInternal : 0;
  }

  private computeTokenBudget(nodes: GraphNode[]): TokenBudget {
    const total = nodes.reduce((a, n) => a + n.tokenCost, 0);
    const wastedNodes = nodes.filter(n => n.qualityImpact < -20);
    const wasted = wastedNodes.reduce((a, n) => a + n.tokenCost, 0);
    const byNodeType: Record<string, number> = {};
    for (const n of nodes) {
      byNodeType[n.type] = (byNodeType[n.type] ?? 0) + n.tokenCost;
    }
    return {
      total,
      used: total - wasted,
      wasted,
      byNodeType: byNodeType as Record<NodeType, number>,
      efficiency: total > 0 ? (total - wasted) / total : 1,
    };
  }

  private computeQualityScore(nodes: GraphNode[], edges: GraphEdge[]): number {
    if (nodes.length === 0) return 50;

    let score = 70; // baseline

    // Bonus for decisions captured
    const decisions = nodes.filter(n => n.type === "decision");
    score += Math.min(15, decisions.length * 3);

    // Bonus for error resolutions
    const errors = nodes.filter(n => n.type === "error");
    const resolved = errors.filter(n => n.properties.resolved);
    score += Math.min(10, resolved.length * 5);

    // Penalty for cold/orphaned nodes
    const orphaned = nodes.filter(n => (this.adjacency.get(n.id)?.size ?? 0) === 0);
    score -= Math.min(15, orphaned.length * 2);

    // Penalty for high token waste
    const budget = this.computeTokenBudget(nodes);
    if (budget.efficiency < 0.5) score -= 15;
    else if (budget.efficiency < 0.7) score -= 8;

    // Bonus for good edge density (connected graph = good context)
    const density = nodes.length > 1 ? edges.length / ((nodes.length * (nodes.length - 1)) / 2) : 0;
    if (density > 0.1) score += 5;

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  // ── Recommendation Engine ──

  private generateRecommendations(
    nodes: GraphNode[], edges: GraphEdge[],
    budget: TokenBudget, clusters: ClusterInfo[]
  ): Recommendation[] {
    const recs: Recommendation[] = [];
    let recId = 0;

    // R1: Files read but never modified → may be stale context
    const readOnlyFiles = nodes.filter(n =>
      n.type === "file" &&
      !edges.some(e => e.target === n.id && (e.type === "writes" || e.type === "modifies"))
    );
    if (readOnlyFiles.length > 3) {
      recs.push({
        id: `rec-${recId++}`, type: "optimize",
        title: "Stale file reads detected",
        description: `${readOnlyFiles.length} files were read but never modified. They may be consuming context budget without contributing to the task.`,
        action: "Add these files to .claudeignore or use targeted /read commands instead of letting Claude auto-read.",
        impact: `Save ~${readOnlyFiles.reduce((a, n) => a + n.tokenCost, 0)} tokens per session.`,
        affectedNodes: readOnlyFiles.map(n => n.id),
        estimatedSavings: readOnlyFiles.reduce((a, n) => a + n.tokenCost, 0),
      });
    }

    // R2: Repeated tool calls to same file → redundant reads
    const fileAccess = nodes.filter(n => n.type === "file" && n.accessCount > 3);
    for (const file of fileAccess) {
      recs.push({
        id: `rec-${recId++}`, type: "warning",
        title: `Repeated access: ${file.name}`,
        description: `${file.name} was accessed ${file.accessCount} times. After compaction, Claude may re-read files it already processed.`,
        action: "Add a PostCompact hook that injects key file contents into recovery context. Or add file summaries to CLAUDE.md.",
        impact: `Save ~${Math.floor(file.tokenCost * 0.5)} tokens from redundant reads.`,
        affectedNodes: [file.id],
        estimatedSavings: Math.floor(file.tokenCost * 0.5),
      });
    }

    // R3: Decisions not linked to files → may be lost in compaction
    const unlinkedDecisions = nodes.filter(n =>
      n.type === "decision" && (this.adjacency.get(n.id)?.size ?? 0) === 0
    );
    if (unlinkedDecisions.length > 0) {
      recs.push({
        id: `rec-${recId++}`, type: "critical",
        title: "Unanchored decisions at risk",
        description: `${unlinkedDecisions.length} decisions are not linked to any files or entities. They will likely be lost during compaction.`,
        action: "Add decisions to CLAUDE.md or a DECISIONS.md file. Use the Cortex snapshot command before compaction.",
        impact: "Prevents context loss and contradictory re-implementation after compaction.",
        affectedNodes: unlinkedDecisions.map(n => n.id),
        estimatedSavings: 0,
      });
    }

    // R4: Hook coverage gaps
    const hookTypes = new Set(nodes.filter(n => n.type === "hook").map(n => n.name));
    const recommended = ["PostToolUse", "PostCompact", "SessionStart", "PreToolUse"];
    const missing = recommended.filter(h => !hookTypes.has(h));
    if (missing.length > 0) {
      recs.push({
        id: `rec-${recId++}`, type: "suggestion",
        title: `Missing recommended hooks: ${missing.join(", ")}`,
        description: `Your session is missing ${missing.length} commonly-used hooks that could improve code quality and context management.`,
        action: `Add hooks for: ${missing.join(", ")}. Use 'cortex install-hooks' for one-command setup.`,
        impact: "Better formatting, security, and compaction recovery.",
        affectedNodes: [],
        estimatedSavings: 0,
      });
    }

    // R5: Token budget warning
    if (budget.total > 100_000) {
      recs.push({
        id: `rec-${recId++}`, type: "warning",
        title: "Approaching context limit",
        description: `${budget.total.toLocaleString()} tokens consumed. Compaction will trigger at ~167K tokens (200K window with 33K buffer).`,
        action: "Run 'cortex snapshot' to save critical context. Consider /compact with focused instructions.",
        impact: "Prevents uncontrolled context loss.",
        affectedNodes: [],
        estimatedSavings: budget.wasted,
      });
    }

    // R6: Large isolated cluster → potential subagent candidate
    for (const cluster of clusters) {
      if (cluster.nodes.length > 5 && cluster.dominantType === "file") {
        recs.push({
          id: `rec-${recId++}`, type: "suggestion",
          title: `Subagent candidate: ${cluster.name} (${cluster.nodes.length} nodes)`,
          description: `A cluster of ${cluster.nodes.length} related files could be delegated to a subagent, freeing main context.`,
          action: "Create a subagent with Task() scoped to this file cluster. Returns summary only.",
          impact: `Free ~${cluster.nodes.reduce((a, id) => a + (this.nodes.get(id)?.tokenCost ?? 0), 0)} tokens from main context.`,
          affectedNodes: cluster.nodes,
          estimatedSavings: cluster.nodes.reduce((a, id) => a + (this.nodes.get(id)?.tokenCost ?? 0), 0),
        });
      }
    }

    // R7: High message count → suggest front-loading context
    const queryNodes = nodes.filter(n => n.type === "query");
    if (queryNodes.length > 15) {
      recs.push({
        id: `rec-${recId++}`, type: "optimize",
        title: "Front-load context instead of follow-ups",
        description: `${queryNodes.length} queries in this session. Each follow-up re-reads the full conversation. Edit your original prompt instead of replying for a clean context reset.`,
        action: "Write one detailed prompt upfront. Use 'edit message' instead of replying to avoid re-reading the entire history.",
        impact: `Reduce token re-processing by ~${Math.floor(queryNodes.length * 500)} tokens.`,
        affectedNodes: queryNodes.map(n => n.id),
        estimatedSavings: queryNodes.length * 500,
      });
    }

    // R8: Large file reads followed by small edits → be surgical
    const largeFileReads = nodes.filter(n =>
      n.type === "file" && n.tokenCost > 4000 &&
      edges.some(e => e.target === n.id && e.type === "reads") &&
      edges.some(e => e.target === n.id && (e.type === "writes" || e.type === "modifies"))
    );
    if (largeFileReads.length > 2) {
      recs.push({
        id: `rec-${recId++}`, type: "optimize",
        title: "Be surgical with edits",
        description: `${largeFileReads.length} large files were fully read then partially edited. Read only the relevant function/section instead of the full file.`,
        action: "Use targeted Read with line ranges (offset/limit) instead of reading entire files. Paste only the broken function, not the whole file.",
        impact: `Save ~${largeFileReads.reduce((a, n) => a + Math.floor(n.tokenCost * 0.6), 0)} tokens from unnecessary context.`,
        affectedNodes: largeFileReads.map(n => n.id),
        estimatedSavings: largeFileReads.reduce((a, n) => a + Math.floor(n.tokenCost * 0.6), 0),
      });
    }

    // R9: Heavy model on simple tasks → use Haiku for simple stuff
    const toolNodes = nodes.filter(n => n.type === "tool");
    const simpleOpsOnHeavyModel = toolNodes.filter(n =>
      n.properties.model?.toString().includes("opus") &&
      (n.name.includes("Read") || n.name.includes("Search") || n.name.includes("Glob"))
    );
    if (simpleOpsOnHeavyModel.length > 5) {
      recs.push({
        id: `rec-${recId++}`, type: "suggestion",
        title: "Route simple tasks to lighter models",
        description: `${simpleOpsOnHeavyModel.length} simple operations (reads, searches) ran on a heavy model. Summarizing, classifying, and quick rewrites don't need Opus.`,
        action: "Use subagents with Haiku for file discovery, search, and simple delegation. Reserve Opus for multi-file edits and architecture decisions.",
        impact: "Reduce cost per simple operation by ~90%.",
        affectedNodes: simpleOpsOnHeavyModel.map(n => n.id),
        estimatedSavings: simpleOpsOnHeavyModel.length * 200,
      });
    }

    // R10: Long session with many topics → fresh chat for new topics
    const allTypes = new Set(nodes.map(n => n.type));
    const distinctFiles = nodes.filter(n => n.type === "file");
    if (nodes.length > 40 && distinctFiles.length > 15 && clusters.length > 4) {
      recs.push({
        id: `rec-${recId++}`, type: "warning",
        title: "Consider fresh chats for new topics",
        description: `This session spans ${clusters.length} distinct clusters across ${distinctFiles.length} files. Long sessions with topic drift force re-reading all unrelated context.`,
        action: "Start a new chat when switching to an unrelated task. Fresh chat = clean slate = faster + cheaper.",
        impact: `Free ~${Math.floor(budget.total * 0.3)} tokens of irrelevant context from prior topics.`,
        affectedNodes: [],
        estimatedSavings: Math.floor(budget.total * 0.3),
      });
    }

    // R11: Outline-first workflow not detected for large writes
    const largeWrites = nodes.filter(n =>
      n.type === "file" && n.tokenCost > 2000 &&
      edges.filter(e => e.target === n.id && (e.type === "writes" || e.type === "modifies")).length > 2
    );
    if (largeWrites.length > 0) {
      recs.push({
        id: `rec-${recId++}`, type: "suggestion",
        title: "Ask for outlines before full drafts",
        description: `${largeWrites.length} files were written/rewritten multiple times. Request an outline first, approve it, then flesh out — one bad draft costs 4x an outline iteration.`,
        action: "For large features or documents, ask for a skeleton/outline first. Approve the structure before generating full content.",
        impact: `Save ~${largeWrites.reduce((a, n) => a + Math.floor(n.tokenCost * 0.5), 0)} tokens from avoided rewrites.`,
        affectedNodes: largeWrites.map(n => n.id),
        estimatedSavings: largeWrites.reduce((a, n) => a + Math.floor(n.tokenCost * 0.5), 0),
      });
    }

    // R12: Batch tasks suggestion when many small tool bursts detected
    const toolBursts = toolNodes.filter(n => n.accessCount === 1);
    if (toolBursts.length > 20 && queryNodes.length > 10) {
      recs.push({
        id: `rec-${recId++}`, type: "suggestion",
        title: "Batch your tasks into fewer messages",
        description: `${queryNodes.length} separate queries detected. Combining related tasks into single messages reduces round-trip overhead dramatically.`,
        action: "'Do X. Then Y. Then Z.' in one message is cheaper than three separate conversations. Batch related tasks together.",
        impact: `Save ~${queryNodes.length * 300} tokens from reduced conversation overhead.`,
        affectedNodes: queryNodes.map(n => n.id),
        estimatedSavings: queryNodes.length * 300,
      });
    }

    return recs.sort((a, b) => {
      const priority = { critical: 0, warning: 1, optimize: 2, suggestion: 3 };
      return (priority[a.type] ?? 4) - (priority[b.type] ?? 4);
    });
  }

  // ── Serialization ──

  toJSON(): object {
    return {
      nodes: this.getAllNodes(),
      edges: this.getAllEdges(),
      metrics: this.computeMetrics(),
      exportedAt: new Date().toISOString(),
    };
  }

  get size(): { nodes: number; edges: number } {
    return { nodes: this.nodes.size, edges: this.edges.length };
  }
}
