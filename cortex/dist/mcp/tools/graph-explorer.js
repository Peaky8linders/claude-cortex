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
import { KnowledgeGraph } from "../../graph/knowledge-graph.js";
import { getKnowledgeDir } from "../data/session-reader.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
/**
 * Load the knowledge graph from Brainiac JSON files.
 * Brainiac nodes have a different schema than KnowledgeGraph nodes,
 * so we translate between them.
 */
function loadBrainiacGraph(knowledgeDir) {
    const graph = new KnowledgeGraph();
    const graphDir = join(knowledgeDir, "graph");
    // Load Brainiac nodes
    const nodesPath = join(graphDir, "nodes.json");
    if (existsSync(nodesPath)) {
        try {
            const nodes = JSON.parse(readFileSync(nodesPath, "utf-8"));
            for (const node of nodes) {
                const type = mapBrainiacType(node.type ?? "pattern");
                const gNode = graph.addNode(node.id, node.content?.substring(0, 50) ?? node.id, type, {
                    brainiac_type: node.type ?? "unknown",
                    status: node.metadata?.status ?? "active",
                    ...(node.keywords ? { keywords: node.keywords.join(",") } : {}),
                });
                // Set token cost based on content length
                if (node.content) {
                    gNode.tokenCost = Math.max(1, Math.floor(node.content.length / 4));
                }
            }
        }
        catch {
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
                }
                catch {
                    // Skip edges with missing nodes
                }
            }
        }
        catch {
            // Skip if edges can't be parsed
        }
    }
    return graph;
}
function mapBrainiacType(type) {
    const mapping = {
        pattern: "pattern",
        antipattern: "pattern",
        solution: "decision",
        decision: "decision",
        hypothesis: "query",
        workflow: "skill",
    };
    return mapping[type] ?? "pattern";
}
function mapBrainiacEdgeType(relation) {
    const mapping = {
        semantic: "related_to",
        temporal: "follows",
        entity: "related_to",
        causal: "causes",
    };
    return mapping[relation] ?? "related_to";
}
export async function computeGraphExplorer(mode = "json", filterType, maxNodes = 50, knowledgeDir) {
    const dir = knowledgeDir ?? getKnowledgeDir();
    const graph = loadBrainiacGraph(dir);
    let nodes = graph.getAllNodes();
    // Filter by type if requested
    if (filterType) {
        const validTypes = ["file", "function", "tool", "decision", "error", "agent", "pattern", "hook", "skill", "query"];
        if (!validTypes.includes(filterType)) {
            return mode === "json"
                ? { mode: "json", nodes: [], edges: [], metrics: { qualityScore: 0, tokenBudget: graph.computeMetrics().tokenBudget, clusterCount: 0 }, clusters: [] }
                : { mode: "html", path: "", message: `Invalid filter_type: ${filterType}`, node_count: 0, edge_count: 0 };
        }
        nodes = nodes.filter(n => n.type === filterType);
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
    const nodeClusterMap = new Map();
    for (const cluster of metrics.clusters) {
        for (const nodeId of cluster.nodes) {
            nodeClusterMap.set(nodeId, cluster.id);
        }
    }
    // Compute degree centrality
    const degreeMap = new Map();
    for (const e of edges) {
        degreeMap.set(e.source, (degreeMap.get(e.source) ?? 0) + 1);
        degreeMap.set(e.target, (degreeMap.get(e.target) ?? 0) + 1);
    }
    const explorerNodes = nodes.map(n => ({
        id: n.id,
        name: n.name,
        type: n.type,
        brainiac_type: String(n.properties.brainiac_type ?? n.type),
        token_cost: n.tokenCost,
        access_count: n.accessCount,
        quality_impact: n.qualityImpact,
        cluster_id: nodeClusterMap.get(n.id) ?? -1,
        keywords: (n.properties.keywords ?? "").toString().split(",").filter(Boolean),
        degree: degreeMap.get(n.id) ?? 0,
    }));
    const explorerEdges = edges.map(e => ({
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
        }
        else if (platform === "darwin") {
            execSync(`open "${htmlPath}"`, { stdio: "ignore" });
        }
        else {
            execSync(`xdg-open "${htmlPath}"`, { stdio: "ignore" });
        }
    }
    catch {
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
function generateExplorerHtml(knowledgeDir, nodes, edges, metrics) {
    const dashboardDir = join(knowledgeDir, "dashboard");
    mkdirSync(dashboardDir, { recursive: true });
    // Escape </script> to prevent XSS breakout from graph data
    const graphData = JSON.stringify({ nodes, edges, metrics }, null, 2)
        .replace(/<\//g, "<\\/");
    const templatePath = join(__dirname, "..", "templates", "graph-explorer.html");
    let html;
    if (existsSync(templatePath)) {
        html = readFileSync(templatePath, "utf-8");
        html = html.replace("__GRAPH_DATA_PLACEHOLDER__", graphData);
    }
    else {
        html = buildInlineHtml(graphData);
    }
    const outputPath = join(dashboardDir, "graph-explorer.html");
    writeFileSync(outputPath, html, "utf-8");
    return outputPath;
}
function buildInlineHtml(graphDataJson) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline'">
  <title>Cortex Graph Explorer</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0d1117; color: #c9d1d9; overflow: hidden; display: flex; flex-direction: column; height: 100vh; }
    #header { padding: 10px 20px; background: #161b22; border-bottom: 1px solid #30363d; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; }
    #header h1 { font-size: 16px; font-weight: 600; }
    #header .stats { font-size: 13px; color: #8b949e; }
    #main { display: flex; flex: 1; overflow: hidden; }
    #canvas-wrap { flex: 1; position: relative; }
    #canvas { width: 100%; height: 100%; }

    /* Search bar */
    #search-bar { position: absolute; top: 12px; left: 12px; display: flex; gap: 8px; z-index: 5; }
    #search-input { background: #21262d; border: 1px solid #30363d; color: #c9d1d9; padding: 6px 12px; border-radius: 6px; font-size: 13px; width: 220px; outline: none; }
    #search-input:focus { border-color: #58a6ff; }
    #search-input::placeholder { color: #484f58; }

    /* Filter chips */
    #filters { position: absolute; top: 12px; right: 12px; display: flex; gap: 6px; flex-wrap: wrap; z-index: 5; }
    .filter-chip { background: #21262d; border: 1px solid #30363d; color: #8b949e; padding: 4px 10px; border-radius: 12px; font-size: 11px; cursor: pointer; display: flex; align-items: center; gap: 4px; user-select: none; }
    .filter-chip.active { border-color: #58a6ff; color: #c9d1d9; }
    .filter-chip .dot { width: 8px; height: 8px; border-radius: 50%; }

    /* Controls */
    #controls { position: absolute; bottom: 12px; left: 12px; display: flex; gap: 8px; z-index: 5; }
    #controls button { background: #21262d; border: 1px solid #30363d; color: #c9d1d9; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; }
    #controls button:hover { background: #30363d; }

    /* Detail panel */
    #detail-panel { width: 320px; background: #161b22; border-left: 1px solid #30363d; overflow-y: auto; flex-shrink: 0; display: none; padding: 16px; }
    #detail-panel.open { display: block; }
    #detail-panel h2 { font-size: 15px; font-weight: 600; margin-bottom: 12px; word-break: break-word; }
    #detail-panel .close-btn { float: right; background: none; border: none; color: #8b949e; cursor: pointer; font-size: 18px; padding: 0 4px; }
    #detail-panel .close-btn:hover { color: #c9d1d9; }
    .detail-section { margin-bottom: 14px; }
    .detail-section h3 { font-size: 12px; text-transform: uppercase; color: #8b949e; letter-spacing: 0.5px; margin-bottom: 6px; }
    .detail-row { display: flex; justify-content: space-between; font-size: 13px; padding: 3px 0; }
    .detail-row .label { color: #8b949e; }
    .detail-tag { display: inline-block; background: #21262d; border: 1px solid #30363d; border-radius: 4px; padding: 2px 6px; font-size: 11px; margin: 2px; }
    .detail-connection { padding: 6px 0; border-bottom: 1px solid #21262d; font-size: 12px; cursor: pointer; }
    .detail-connection:hover { color: #58a6ff; }
    .detail-connection .relation { color: #8b949e; font-size: 11px; }

    /* Tooltip */
    #tooltip { position: absolute; display: none; background: #1c2128; border: 1px solid #30363d; border-radius: 8px; padding: 10px; font-size: 12px; max-width: 250px; z-index: 10; pointer-events: none; box-shadow: 0 4px 12px rgba(0,0,0,0.4); }
  </style>
</head>
<body>
  <div id="header">
    <h1>Cortex Graph Explorer</h1>
    <span class="stats" id="stats"></span>
  </div>
  <div id="main">
    <div id="canvas-wrap">
      <canvas id="canvas"></canvas>
      <div id="search-bar">
        <input id="search-input" type="text" placeholder="Search nodes..." />
      </div>
      <div id="filters"></div>
      <div id="controls">
        <button onclick="resetView()">Reset</button>
        <button onclick="toggleLabels()">Labels</button>
        <button onclick="toggleEdgeLabels()">Edge Types</button>
      </div>
      <div id="tooltip"></div>
    </div>
    <div id="detail-panel"></div>
  </div>
  <script>
    window.__GRAPH_DATA__ = ${graphDataJson};

    // Brainiac-native type colors
    const TYPE_COLORS = {
      pattern: '#d29922', antipattern: '#f85149', workflow: '#7ee787',
      hypothesis: '#d2a8ff', solution: '#58a6ff', decision: '#ffa657',
      memory: '#8b949e',
      // Fallback cortex types
      file: '#58a6ff', function: '#d2a8ff', tool: '#7ee787',
      error: '#f85149', agent: '#79c0ff', hook: '#56d4dd',
      skill: '#f778ba', query: '#8b949e'
    };

    const EDGE_COLORS = {
      semantic: '#58a6ff', temporal: '#7ee787', causal: '#ffa657',
      entity: '#d2a8ff', related_to: '#30363d', follows: '#7ee787',
      causes: '#ffa657'
    };

    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    const tooltip = document.getElementById('tooltip');
    const detailPanel = document.getElementById('detail-panel');
    let showLabels = true, showEdgeLabels = false;
    let allNodes = [], allEdges = [], nodes = [], edges = [];
    let dragNode = null, selectedNode = null, searchQuery = '';
    let activeFilters = new Set();
    let viewX = 0, viewY = 0, zoom = 1, isPanning = false, panStart = null;

    function init() {
      const data = window.__GRAPH_DATA__;
      document.getElementById('stats').textContent =
        data.nodes.length + ' nodes | ' + data.edges.length + ' edges | quality: ' + (data.metrics?.qualityScore ?? '?') + '/100';

      resizeCanvas();

      const cx = canvas.width / 2, cy = canvas.height / 2;
      const maxDegree = Math.max(1, ...data.nodes.map(n => n.degree || 1));

      allNodes = data.nodes.map((n, i) => ({
        ...n,
        x: cx + (Math.cos(i * 2.399) * 250) + (Math.random() - 0.5) * 120,
        y: cy + (Math.sin(i * 2.399) * 250) + (Math.random() - 0.5) * 120,
        vx: 0, vy: 0,
        // Size by degree centrality (connections), not token cost
        radius: Math.max(6, Math.min(28, 6 + (n.degree / maxDegree) * 22)),
        visible: true, highlighted: false,
        displayType: n.brainiac_type || n.type,
      }));

      allEdges = data.edges.map(e => ({
        ...e,
        sourceNode: allNodes.find(n => n.id === e.source),
        targetNode: allNodes.find(n => n.id === e.target),
      })).filter(e => e.sourceNode && e.targetNode);

      nodes = allNodes;
      edges = allEdges;

      buildFilters();
      simulate();

      // Search
      document.getElementById('search-input').addEventListener('input', function(ev) {
        searchQuery = ev.target.value.toLowerCase();
        applyFilters();
      });
    }

    function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

    function buildFilters() {
      const types = [...new Set(allNodes.map(n => n.displayType))].sort();
      const container = document.getElementById('filters');
      container.innerHTML = '';
      types.forEach(t => {
        const chip = document.createElement('div');
        chip.className = 'filter-chip active';
        const dot = document.createElement('div');
        dot.className = 'dot';
        dot.style.background = TYPE_COLORS[t] || '#8b949e';
        chip.appendChild(dot);
        chip.appendChild(document.createTextNode(t));
        chip.dataset.type = t;
        activeFilters.add(t);
        chip.addEventListener('click', function() {
          if (activeFilters.has(t)) { activeFilters.delete(t); chip.classList.remove('active'); }
          else { activeFilters.add(t); chip.classList.add('active'); }
          applyFilters();
        });
        container.appendChild(chip);
      });
    }

    function applyFilters() {
      allNodes.forEach(n => {
        n.visible = activeFilters.has(n.displayType);
        n.highlighted = false;
        if (searchQuery && n.visible) {
          const matchName = n.name.toLowerCase().includes(searchQuery);
          const matchId = n.id.toLowerCase().includes(searchQuery);
          const matchKw = (n.keywords || []).some(k => k.toLowerCase().includes(searchQuery));
          if (matchName || matchId || matchKw) {
            n.highlighted = true;
          } else if (searchQuery.length > 1) {
            n.visible = false;
          }
        }
      });
      nodes = allNodes.filter(n => n.visible);
      const visibleIds = new Set(nodes.map(n => n.id));
      edges = allEdges.filter(e => visibleIds.has(e.source) && visibleIds.has(e.target));
      draw();
    }

    function simulate() {
      const ITERATIONS = 250;
      for (let iter = 0; iter < ITERATIONS; iter++) {
        const alpha = 1 - iter / ITERATIONS;
        for (let i = 0; i < allNodes.length; i++) {
          for (let j = i + 1; j < allNodes.length; j++) {
            let dx = allNodes[j].x - allNodes[i].x;
            let dy = allNodes[j].y - allNodes[i].y;
            let d = Math.sqrt(dx*dx + dy*dy) || 1;
            let force = (600 * alpha) / (d * d);
            allNodes[i].vx -= dx / d * force;
            allNodes[i].vy -= dy / d * force;
            allNodes[j].vx += dx / d * force;
            allNodes[j].vy += dy / d * force;
          }
        }
        for (const e of allEdges) {
          let dx = e.targetNode.x - e.sourceNode.x;
          let dy = e.targetNode.y - e.sourceNode.y;
          let d = Math.sqrt(dx*dx + dy*dy) || 1;
          let force = (d - 120) * 0.01 * alpha * e.weight;
          e.sourceNode.vx += dx / d * force;
          e.sourceNode.vy += dy / d * force;
          e.targetNode.vx -= dx / d * force;
          e.targetNode.vy -= dy / d * force;
        }
        const cx = canvas.width / 2, cy = canvas.height / 2;
        for (const n of allNodes) {
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
        const isSelectedEdge = selectedNode && (e.source === selectedNode.id || e.target === selectedNode.id);
        const edgeColor = EDGE_COLORS[e.type] || '#30363d';
        ctx.strokeStyle = isSelectedEdge ? edgeColor : 'rgba(48, 54, 61, ' + (0.2 + e.weight * 0.4) + ')';
        ctx.lineWidth = isSelectedEdge ? 2 + e.weight : 1 + e.weight * 0.5;
        ctx.stroke();

        if (showEdgeLabels && isSelectedEdge) {
          const mx = (e.sourceNode.x + e.targetNode.x) / 2;
          const my = (e.sourceNode.y + e.targetNode.y) / 2;
          ctx.font = '9px -apple-system, sans-serif';
          ctx.fillStyle = edgeColor;
          ctx.textAlign = 'center';
          ctx.fillText(e.type, mx, my - 4);
        }
      }

      // Nodes
      for (const n of nodes) {
        const isSelected = selectedNode && selectedNode.id === n.id;
        const isConnected = selectedNode && edges.some(e =>
          (e.source === selectedNode.id && e.target === n.id) ||
          (e.target === selectedNode.id && e.source === n.id)
        );
        const dimmed = selectedNode && !isSelected && !isConnected;

        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
        ctx.fillStyle = TYPE_COLORS[n.displayType] || TYPE_COLORS[n.type] || '#8b949e';
        ctx.globalAlpha = dimmed ? 0.2 : (n.highlighted ? 1.0 : 0.85);
        ctx.fill();
        ctx.globalAlpha = 1;

        // Selection ring
        if (isSelected) {
          ctx.strokeStyle = '#f0f6fc';
          ctx.lineWidth = 3;
        } else if (n.highlighted) {
          ctx.strokeStyle = '#f0f6fc';
          ctx.lineWidth = 2;
        } else {
          ctx.strokeStyle = '#0d1117';
          ctx.lineWidth = 1.5;
        }
        ctx.stroke();

        if (showLabels && !dimmed && n.radius > 7) {
          ctx.font = (isSelected ? 'bold ' : '') + '10px -apple-system, sans-serif';
          ctx.fillStyle = dimmed ? 'rgba(201,209,217,0.3)' : '#c9d1d9';
          ctx.textAlign = 'center';
          ctx.fillText(n.name.substring(0, 25), n.x, n.y + n.radius + 13);
        }
      }

      ctx.restore();
    }

    function showDetail(node) {
      selectedNode = node;
      const panel = document.getElementById('detail-panel');
      panel.classList.add('open');
      panel.textContent = '';

      // Close button
      var closeBtn = document.createElement('button');
      closeBtn.className = 'close-btn';
      closeBtn.textContent = '\\u00d7';
      closeBtn.addEventListener('click', closeDetail);
      panel.appendChild(closeBtn);

      // Title
      var h2 = document.createElement('h2');
      h2.textContent = node.name;
      panel.appendChild(h2);

      // Properties section
      var propsSection = document.createElement('div');
      propsSection.className = 'detail-section';
      var propsH3 = document.createElement('h3');
      propsH3.textContent = 'Properties';
      propsSection.appendChild(propsH3);

      var propRows = [
        ['ID', node.id], ['Type', node.displayType],
        ['Cluster', String(node.cluster_id)], ['Degree', (node.degree||0) + ' connections'],
        ['Tokens', node.token_cost.toLocaleString()], ['Access', node.access_count + 'x'],
        ['Quality', (node.quality_impact > 0 ? '+' : '') + node.quality_impact]
      ];
      propRows.forEach(function(row) {
        var div = document.createElement('div');
        div.className = 'detail-row';
        var lbl = document.createElement('span');
        lbl.className = 'label';
        lbl.textContent = row[0];
        var val = document.createElement('span');
        val.textContent = row[1];
        div.appendChild(lbl);
        div.appendChild(val);
        propsSection.appendChild(div);
      });
      panel.appendChild(propsSection);

      // Keywords section
      var keywords = node.keywords || [];
      if (keywords.length > 0) {
        var kwSection = document.createElement('div');
        kwSection.className = 'detail-section';
        var kwH3 = document.createElement('h3');
        kwH3.textContent = 'Keywords';
        kwSection.appendChild(kwH3);
        keywords.forEach(function(k) {
          var tag = document.createElement('span');
          tag.className = 'detail-tag';
          tag.textContent = k;
          kwSection.appendChild(tag);
        });
        panel.appendChild(kwSection);
      }

      // Connections section
      var connections = allEdges.filter(e => e.source === node.id || e.target === node.id);
      var connSection = document.createElement('div');
      connSection.className = 'detail-section';
      var connH3 = document.createElement('h3');
      connH3.textContent = 'Connections (' + connections.length + ')';
      connSection.appendChild(connH3);

      connections.forEach(function(e) {
        var otherId = e.source === node.id ? e.target : e.source;
        var other = allNodes.find(n => n.id === otherId);
        var dir = e.source === node.id ? '\\u2192' : '\\u2190';
        var connDiv = document.createElement('div');
        connDiv.className = 'detail-connection';
        connDiv.dataset.id = otherId;
        connDiv.textContent = dir + ' ' + (other ? other.name : otherId) + ' ';
        var relSpan = document.createElement('span');
        relSpan.className = 'relation';
        relSpan.textContent = '[' + e.type + ']';
        connDiv.appendChild(relSpan);
        connDiv.addEventListener('click', function() {
          var target = allNodes.find(n => n.id === otherId);
          if (target) showDetail(target);
        });
        connSection.appendChild(connDiv);
      });
      panel.appendChild(connSection);

      draw();
    }

    function closeDetail() {
      selectedNode = null;
      document.getElementById('detail-panel').classList.remove('open');
      draw();
    }

    // Mouse interaction
    canvas.addEventListener('mousemove', function(e) {
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left - viewX) / zoom;
      const my = (e.clientY - rect.top - viewY) / zoom;

      if (isPanning && panStart) {
        viewX = e.clientX - panStart.x;
        viewY = e.clientY - panStart.y;
        draw();
        return;
      }

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
        tooltip.textContent = '';
        [['', hit.name], ['', hit.displayType + ' | ' + (hit.degree||0) + ' connections']].forEach(function(item) {
          var div = document.createElement('div');
          div.style.fontWeight = item[0] === '' && tooltip.children.length === 0 ? '600' : 'normal';
          if (tooltip.children.length > 0) div.style.color = '#8b949e';
          div.textContent = item[1];
          tooltip.appendChild(div);
        });
        canvas.style.cursor = 'pointer';
      } else {
        tooltip.style.display = 'none';
        canvas.style.cursor = isPanning ? 'grabbing' : 'default';
      }
    });

    var dragStartPos = null;
    canvas.addEventListener('mousedown', function(e) {
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left - viewX) / zoom;
      const my = (e.clientY - rect.top - viewY) / zoom;
      const hit = nodes.find(n => Math.hypot(n.x - mx, n.y - my) < n.radius);
      if (hit) {
        dragNode = hit;
        dragStartPos = { x: mx, y: my };
      } else {
        isPanning = true;
        panStart = { x: e.clientX - viewX, y: e.clientY - viewY };
      }
    });

    canvas.addEventListener('mouseup', function(e) {
      if (dragNode && dragStartPos) {
        const rect = canvas.getBoundingClientRect();
        const mx = (e.clientX - rect.left - viewX) / zoom;
        const my = (e.clientY - rect.top - viewY) / zoom;
        const dist = Math.hypot(mx - dragStartPos.x, my - dragStartPos.y);
        // Only show detail if it was a click, not a drag
        if (dist < 5) showDetail(dragNode);
      }
      dragNode = null;
      dragStartPos = null;
      isPanning = false;
      panStart = null;
    });

    canvas.addEventListener('wheel', function(e) {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.max(0.1, Math.min(5, zoom * delta));
      // Zoom toward mouse position
      viewX = mouseX - (mouseX - viewX) * (newZoom / zoom);
      viewY = mouseY - (mouseY - viewY) * (newZoom / zoom);
      zoom = newZoom;
      draw();
    });

    function resizeCanvas() {
      canvas.width = canvas.parentElement.offsetWidth;
      canvas.height = canvas.parentElement.offsetHeight;
    }

    function resetView() { viewX = 0; viewY = 0; zoom = 1; selectedNode = null; draw(); }
    function toggleLabels() { showLabels = !showLabels; draw(); }
    function toggleEdgeLabels() { showEdgeLabels = !showEdgeLabels; draw(); }

    window.addEventListener('resize', function() { resizeCanvas(); draw(); });

    // Keyboard shortcuts
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') { closeDetail(); searchQuery = ''; document.getElementById('search-input').value = ''; applyFilters(); }
      if (e.key === '/' && document.activeElement !== document.getElementById('search-input')) {
        e.preventDefault();
        document.getElementById('search-input').focus();
      }
    });

    init();
  </script>
</body>
</html>`;
}
