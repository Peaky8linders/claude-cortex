/**
 * Graph Explorer Tool — Interactive knowledge graph (JSON + HTML)
 *
 * JSON mode: returns structured data for terminal rendering
 * HTML mode: generates self-contained HTML file and opens in browser
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { KnowledgeGraph, type GraphNode, type GraphEdge, type GraphMetrics, type ClusterInfo } from "../../graph/knowledge-graph.js";
import { getKnowledgeDir } from "../data/session-reader.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface GraphExplorerNode {
  id: string;
  name: string;
  type: string;
  token_cost: number;
  access_count: number;
  quality_impact: number;
  cluster_id: number;
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

/**
 * Load the knowledge graph from Brainiac JSON files.
 * Brainiac nodes have a different schema than KnowledgeGraph nodes,
 * so we translate between them.
 */
function loadBrainiacGraph(knowledgeDir: string): KnowledgeGraph {
  const graph = new KnowledgeGraph();
  const graphDir = join(knowledgeDir, "graph");

  // Load Brainiac nodes
  const nodesPath = join(graphDir, "nodes.json");
  if (existsSync(nodesPath)) {
    try {
      const nodes = JSON.parse(readFileSync(nodesPath, "utf-8"));
      for (const node of nodes) {
        const type = mapBrainiacType(node.type ?? "pattern");
        const gNode = graph.addNode(
          node.id,
          node.content?.substring(0, 50) ?? node.id,
          type,
          {
            brainiac_type: node.type ?? "unknown",
            status: node.metadata?.status ?? "active",
            ...(node.keywords ? { keywords: node.keywords.join(",") } : {}),
          }
        );
        // Set token cost based on content length
        if (node.content) {
          gNode.tokenCost = Math.max(1, Math.floor(node.content.length / 4));
        }
      }
    } catch {
      // Skip if nodes can't be parsed
    }
  }

  // Load Brainiac edges
  const edgesPath = join(graphDir, "edges.json");
  if (existsSync(edgesPath)) {
    try {
      const edges = JSON.parse(readFileSync(edgesPath, "utf-8"));
      for (const edge of edges) {
        try {
          const edgeType = mapBrainiacEdgeType(edge.relation ?? "related_to");
          // Support both field name conventions: source/target (Brainiac) and from_id/to_id (legacy)
          const sourceId = edge.source ?? edge.from_id;
          const targetId = edge.target ?? edge.to_id;
          const gEdge = graph.addEdge(sourceId, targetId, edgeType, edge.relation);
          gEdge.weight = edge.weight ?? 0.5;
        } catch {
          // Skip edges with missing nodes
        }
      }
    } catch {
      // Skip if edges can't be parsed
    }
  }

  return graph;
}

function mapBrainiacType(type: string): GraphNode["type"] {
  const mapping: Record<string, GraphNode["type"]> = {
    pattern: "pattern",
    antipattern: "pattern",
    solution: "decision",
    decision: "decision",
    hypothesis: "query",
    workflow: "skill",
  };
  return mapping[type] ?? "pattern";
}

function mapBrainiacEdgeType(relation: string): GraphEdge["type"] {
  const mapping: Record<string, GraphEdge["type"]> = {
    semantic: "related_to",
    temporal: "follows",
    entity: "related_to",
    causal: "causes",
  };
  return mapping[relation] ?? "related_to";
}

export async function computeGraphExplorer(
  mode: "json" | "html" = "json",
  filterType?: string,
  maxNodes: number = 50,
  knowledgeDir?: string,
): Promise<GraphExplorerResult> {
  const dir = knowledgeDir ?? getKnowledgeDir();
  const graph = loadBrainiacGraph(dir);

  let nodes = graph.getAllNodes();

  // Filter by type if requested
  if (filterType) {
    const validTypes: GraphNode["type"][] = ["file", "function", "tool", "decision", "error", "agent", "pattern", "hook", "skill", "query"];
    if (!validTypes.includes(filterType as GraphNode["type"])) {
      return mode === "json"
        ? { mode: "json", nodes: [], edges: [], metrics: { qualityScore: 0, tokenBudget: graph.computeMetrics().tokenBudget, clusterCount: 0 }, clusters: [] }
        : { mode: "html", path: "", message: `Invalid filter_type: ${filterType}`, node_count: 0, edge_count: 0 };
    }
    nodes = nodes.filter(n => n.type === (filterType as GraphNode["type"]));
  }

  // Limit nodes (keep highest access count)
  if (nodes.length > maxNodes) {
    nodes.sort((a, b) => b.accessCount - a.accessCount);
    nodes = nodes.slice(0, maxNodes);
  }

  // Filter edges once after all node filtering is done (DRY)
  const nodeIds = new Set(nodes.map(n => n.id));
  let edges = graph.getAllEdges().filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));

  const metrics = graph.computeMetrics();

  // Assign cluster IDs to nodes
  const nodeClusterMap = new Map<string, number>();
  for (const cluster of metrics.clusters) {
    for (const nodeId of cluster.nodes) {
      nodeClusterMap.set(nodeId, cluster.id);
    }
  }

  const explorerNodes: GraphExplorerNode[] = nodes.map(n => ({
    id: n.id,
    name: n.name,
    type: n.type,
    token_cost: n.tokenCost,
    access_count: n.accessCount,
    quality_impact: n.qualityImpact,
    cluster_id: nodeClusterMap.get(n.id) ?? -1,
  }));

  const explorerEdges: GraphExplorerEdge[] = edges.map(e => ({
    source: e.source,
    target: e.target,
    type: e.type,
    weight: e.weight,
  }));

  if (mode === "json") {
    // Return lightweight summary to avoid oversized payloads
    const { clusters, qualityScore, tokenBudget } = metrics;
    return {
      mode: "json",
      nodes: explorerNodes,
      edges: explorerEdges,
      metrics: { qualityScore, tokenBudget, clusterCount: clusters.length },
      clusters,
    };
  }

  // HTML mode: generate self-contained HTML
  const htmlPath = generateExplorerHtml(dir, explorerNodes, explorerEdges, metrics);

  // Try to open in browser
  try {
    const platform = process.platform;
    if (platform === "win32") {
      execSync(`start "" "${htmlPath}"`, { stdio: "ignore" });
    } else if (platform === "darwin") {
      execSync(`open "${htmlPath}"`, { stdio: "ignore" });
    } else {
      execSync(`xdg-open "${htmlPath}"`, { stdio: "ignore" });
    }
  } catch {
    // Browser open is best-effort
  }

  return {
    mode: "html",
    path: htmlPath,
    message: `Graph explorer generated with ${explorerNodes.length} nodes and ${explorerEdges.length} edges.`,
    node_count: explorerNodes.length,
    edge_count: explorerEdges.length,
  };
}

function generateExplorerHtml(
  knowledgeDir: string,
  nodes: GraphExplorerNode[],
  edges: GraphExplorerEdge[],
  metrics: GraphMetrics,
): string {
  const dashboardDir = join(knowledgeDir, "dashboard");
  mkdirSync(dashboardDir, { recursive: true });

  // Escape </script> to prevent XSS breakout from graph data
  const graphData = JSON.stringify({ nodes, edges, metrics }, null, 2)
    .replace(/<\//g, "<\\/");
  const templatePath = join(__dirname, "..", "templates", "graph-explorer.html");

  let html: string;
  if (existsSync(templatePath)) {
    html = readFileSync(templatePath, "utf-8");
    html = html.replace("__GRAPH_DATA_PLACEHOLDER__", graphData);
  } else {
    html = buildInlineHtml(graphData);
  }

  const outputPath = join(dashboardDir, "graph-explorer.html");
  writeFileSync(outputPath, html, "utf-8");
  return outputPath;
}

function buildInlineHtml(graphDataJson: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline'">
  <title>Cortex Graph Explorer</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0d1117; color: #c9d1d9; overflow: hidden; }
    #header { padding: 12px 20px; background: #161b22; border-bottom: 1px solid #30363d; display: flex; justify-content: space-between; align-items: center; }
    #header h1 { font-size: 16px; font-weight: 600; }
    #header .stats { font-size: 13px; color: #8b949e; }
    #canvas { width: 100vw; height: calc(100vh - 48px); }
    #tooltip { position: absolute; display: none; background: #1c2128; border: 1px solid #30363d; border-radius: 8px; padding: 12px; font-size: 13px; max-width: 300px; z-index: 10; pointer-events: none; box-shadow: 0 4px 12px rgba(0,0,0,0.4); }
    #tooltip .label { font-weight: 600; margin-bottom: 4px; }
    #tooltip .type { color: #8b949e; font-size: 12px; }
    #tooltip .metric { margin-top: 6px; }
    #legend { position: absolute; bottom: 20px; left: 20px; background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 12px; font-size: 12px; }
    #legend .item { display: flex; align-items: center; gap: 8px; margin: 4px 0; }
    #legend .dot { width: 10px; height: 10px; border-radius: 50%; }
    #controls { position: absolute; top: 60px; right: 20px; display: flex; flex-direction: column; gap: 8px; }
    #controls button { background: #21262d; border: 1px solid #30363d; color: #c9d1d9; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; }
    #controls button:hover { background: #30363d; }
  </style>
</head>
<body>
  <div id="header">
    <h1>Cortex Graph Explorer</h1>
    <span class="stats" id="stats"></span>
  </div>
  <canvas id="canvas"></canvas>
  <div id="tooltip"></div>
  <div id="legend"></div>
  <div id="controls">
    <button onclick="resetView()">Reset View</button>
    <button onclick="toggleLabels()">Toggle Labels</button>
  </div>
  <script>
    window.__GRAPH_DATA__ = ${graphDataJson};

    const TYPE_COLORS = {
      file: '#58a6ff', function: '#d2a8ff', tool: '#7ee787',
      decision: '#ffa657', error: '#f85149', agent: '#79c0ff',
      pattern: '#d29922', hook: '#56d4dd', skill: '#f778ba', query: '#8b949e'
    };

    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    const tooltip = document.getElementById('tooltip');
    let showLabels = true;
    let nodes = [], edges = [];
    let dragNode = null, offsetX = 0, offsetY = 0;
    let viewX = 0, viewY = 0, zoom = 1;

    function init() {
      const data = window.__GRAPH_DATA__;
      document.getElementById('stats').textContent =
        data.nodes.length + ' nodes | ' + data.edges.length + ' edges | quality: ' + (data.metrics?.qualityScore ?? '?') + '/100';

      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;

      // Init node positions (force-directed seed)
      const cx = canvas.width / 2, cy = canvas.height / 2;
      nodes = data.nodes.map((n, i) => ({
        ...n,
        x: cx + (Math.cos(i * 2.399) * 200) + (Math.random() - 0.5) * 100,
        y: cy + (Math.sin(i * 2.399) * 200) + (Math.random() - 0.5) * 100,
        vx: 0, vy: 0,
        radius: Math.max(6, Math.min(30, Math.sqrt(n.token_cost / 10))),
      }));

      edges = data.edges.map(e => ({
        ...e,
        sourceNode: nodes.find(n => n.id === e.source),
        targetNode: nodes.find(n => n.id === e.target),
      })).filter(e => e.sourceNode && e.targetNode);

      // Build legend
      const types = new Set(nodes.map(n => n.type));
      const legend = document.getElementById('legend');
      legend.innerHTML = '<div style="font-weight:600;margin-bottom:6px;">Node Types</div>' +
        [...types].map(t => '<div class="item"><div class="dot" style="background:' + (TYPE_COLORS[t]||'#8b949e') + '"></div>' + t + '</div>').join('');

      // Run force simulation
      simulate();
    }

    function simulate() {
      const ITERATIONS = 200;
      for (let iter = 0; iter < ITERATIONS; iter++) {
        const alpha = 1 - iter / ITERATIONS;
        // Repulsion
        for (let i = 0; i < nodes.length; i++) {
          for (let j = i + 1; j < nodes.length; j++) {
            let dx = nodes[j].x - nodes[i].x;
            let dy = nodes[j].y - nodes[i].y;
            let d = Math.sqrt(dx*dx + dy*dy) || 1;
            let force = (500 * alpha) / (d * d);
            nodes[i].vx -= dx / d * force;
            nodes[i].vy -= dy / d * force;
            nodes[j].vx += dx / d * force;
            nodes[j].vy += dy / d * force;
          }
        }
        // Attraction along edges
        for (const e of edges) {
          let dx = e.targetNode.x - e.sourceNode.x;
          let dy = e.targetNode.y - e.sourceNode.y;
          let d = Math.sqrt(dx*dx + dy*dy) || 1;
          let force = (d - 100) * 0.01 * alpha * e.weight;
          e.sourceNode.vx += dx / d * force;
          e.sourceNode.vy += dy / d * force;
          e.targetNode.vx -= dx / d * force;
          e.targetNode.vy -= dy / d * force;
        }
        // Center gravity
        const cx = canvas.width / 2, cy = canvas.height / 2;
        for (const n of nodes) {
          n.vx += (cx - n.x) * 0.001 * alpha;
          n.vy += (cy - n.y) * 0.001 * alpha;
          n.x += n.vx * 0.5;
          n.y += n.vy * 0.5;
          n.vx *= 0.9;
          n.vy *= 0.9;
        }
      }
      draw();
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.translate(viewX, viewY);
      ctx.scale(zoom, zoom);

      // Edges
      for (const e of edges) {
        ctx.beginPath();
        ctx.moveTo(e.sourceNode.x, e.sourceNode.y);
        ctx.lineTo(e.targetNode.x, e.targetNode.y);
        ctx.strokeStyle = 'rgba(48, 54, 61, ' + (0.3 + e.weight * 0.5) + ')';
        ctx.lineWidth = 1 + e.weight;
        ctx.stroke();
      }

      // Nodes
      for (const n of nodes) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
        ctx.fillStyle = TYPE_COLORS[n.type] || '#8b949e';
        ctx.globalAlpha = 0.85;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#0d1117';
        ctx.lineWidth = 2;
        ctx.stroke();

        if (showLabels && n.radius > 8) {
          ctx.font = '10px -apple-system, sans-serif';
          ctx.fillStyle = '#c9d1d9';
          ctx.textAlign = 'center';
          ctx.fillText(n.name.substring(0, 20), n.x, n.y + n.radius + 14);
        }
      }

      ctx.restore();
    }

    // Interaction
    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left - viewX) / zoom;
      const my = (e.clientY - rect.top - viewY) / zoom;

      if (dragNode) {
        dragNode.x = mx;
        dragNode.y = my;
        draw();
        return;
      }

      const hit = nodes.find(n => Math.hypot(n.x - mx, n.y - my) < n.radius);
      if (hit) {
        tooltip.style.display = 'block';
        tooltip.style.left = (e.clientX + 12) + 'px';
        tooltip.style.top = (e.clientY + 12) + 'px';
        // Use textContent to prevent XSS from node names
        tooltip.textContent = '';
        var items = [
          ['label', hit.name],
          ['type', hit.type + ' (cluster ' + hit.cluster_id + ')'],
          ['metric', 'Tokens: ' + hit.token_cost.toLocaleString()],
          ['metric', 'Access: ' + hit.access_count + 'x'],
          ['metric', 'Quality: ' + (hit.quality_impact > 0 ? '+' : '') + hit.quality_impact]
        ];
        items.forEach(function(item) {
          var div = document.createElement('div');
          div.className = item[0];
          div.textContent = item[1];
          tooltip.appendChild(div);
        });
        canvas.style.cursor = 'pointer';
      } else {
        tooltip.style.display = 'none';
        canvas.style.cursor = 'default';
      }
    });

    canvas.addEventListener('mousedown', (e) => {
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left - viewX) / zoom;
      const my = (e.clientY - rect.top - viewY) / zoom;
      dragNode = nodes.find(n => Math.hypot(n.x - mx, n.y - my) < n.radius) || null;
    });

    canvas.addEventListener('mouseup', () => { dragNode = null; });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      zoom *= delta;
      zoom = Math.max(0.1, Math.min(5, zoom));
      draw();
    });

    function resetView() { viewX = 0; viewY = 0; zoom = 1; draw(); }
    function toggleLabels() { showLabels = !showLabels; draw(); }

    window.addEventListener('resize', () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      draw();
    });

    init();
  </script>
</body>
</html>`;
}
