/**
 * Unified Dashboard — session observability visualization
 *
 * Generates a self-contained HTML page combining:
 *   - KPI tiles (tokens, cost, duration, quality)
 *   - Token timeline (line chart with spike markers)
 *   - Tool usage (horizontal bar chart)
 *   - Quality radar (spider chart, 7 dimensions)
 *   - Cost by model (pie chart)
 *   - Activity gantt (timeline bars)
 *   - Event feed (scrollable table)
 *   - Knowledge graph (force-directed, from graph-explorer)
 *   - Cross-session history (optional)
 *
 * Zero external dependencies — Canvas 2D rendering, inline CSS/JS.
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { execSync } from "child_process";

import { computeTokenTimeline } from "./token-timeline.js";
import { computeActivityMap } from "./activity-map.js";
import { computeQualityHeatmap } from "./quality-heatmap.js";
import { computeGraphExplorer } from "./graph-explorer.js";
import { getSessionEntries } from "../data/session-reader.js";
import { getAllSessionSummaries, computeTrends } from "../data/cross-session.js";
import { analyzeCacheEfficiency } from "../data/cache-analyzer.js";

export interface DashboardResult {
  path: string;
  message: string;
  kpis: {
    total_tokens: number;
    estimated_cost: number;
    session_duration_minutes: number;
    quality_score: number;
    quality_grade: string;
  };
}

export async function computeUnifiedDashboard(
  sessionId?: string,
  crossSession: boolean = false,
  knowledgeDir?: string,
): Promise<DashboardResult> {
  const dir = knowledgeDir ?? join(homedir(), ".claude", "knowledge");

  // Gather data — sync functions first, then async in parallel
  const timeline = computeTokenTimeline(sessionId, 1440, knowledgeDir);
  const activityMap = computeActivityMap(sessionId, true, true, knowledgeDir);
  const [quality, graphData] = await Promise.all([
    computeQualityHeatmap(undefined, "session dashboard overview"),
    computeGraphExplorer("json", undefined, 50, knowledgeDir),
  ]);

  // Reuse cost data from token-timeline (avoids redundant computeSessionCost call)
  const costByModel = timeline.summary.cost_by_model ?? {};
  const session = getSessionEntries(sessionId, knowledgeDir);

  // Cross-session data (optional)
  const crossSessionData = crossSession
    ? computeTrends(getAllSessionSummaries(knowledgeDir))
    : null;

  // Cache efficiency analysis
  const cacheReport = analyzeCacheEfficiency(sessionId, knowledgeDir);

  // Build data payload for the HTML
  const dashboardData = {
    kpis: {
      total_tokens: timeline.summary.total_tokens,
      estimated_cost: timeline.summary.estimated_cost,
      session_duration_minutes: timeline.summary.duration_minutes,
      quality_score: quality.score,
      quality_grade: quality.grade,
    },
    timeline: {
      buckets: timeline.timeline,
      spikes: timeline.spikes,
      summary: timeline.summary,
    },
    activity: {
      tracks: activityMap.tracks.slice(0, 15),
      tools_summary: activityMap.tools_summary,
      concurrency_peak: activityMap.concurrency_peak,
    },
    quality: {
      score: quality.score,
      grade: quality.grade,
      radar_labels: quality.radar_labels,
      radar_values: quality.radar_values,
      health_status: quality.health_status,
      dimensions: quality.dimensions,
    },
    cost: {
      total_usd: timeline.summary.estimated_cost,
      by_model: costByModel,
    },
    graph: graphData,
    events: session.entries.slice(-50).reverse(),
    crossSession: crossSessionData,
    cacheEfficiency: cacheReport,
  };

  // Generate HTML
  const html = buildDashboardHtml(JSON.stringify(dashboardData).replace(/<\/script>/gi, "<\\/script>"));

  // Write to disk and open
  const dashboardDir = join(dir, "dashboard");
  if (!existsSync(dashboardDir)) mkdirSync(dashboardDir, { recursive: true });

  const outputPath = join(dashboardDir, "cortex-dashboard.html");
  writeFileSync(outputPath, html, "utf-8");

  // Open in browser (cross-platform, safe — no shell interpolation)
  try {
    const openCmd = process.platform === "win32" ? "start"
      : process.platform === "darwin" ? "open" : "xdg-open";
    execSync(`${openCmd} "" "${outputPath}"`, { stdio: "ignore" });
  } catch {
    // Browser open is best-effort — don't fail the tool
  }

  return {
    path: outputPath,
    message: `Dashboard generated at ${outputPath} and opened in browser.`,
    kpis: dashboardData.kpis,
  };
}

function buildDashboardHtml(dataJson: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline'">
  <title>Cortex Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0d1117; color: #c9d1d9; }
    #header { padding: 14px 24px; background: #161b22; border-bottom: 1px solid #30363d; display: flex; justify-content: space-between; align-items: center; }
    #header h1 { font-size: 18px; font-weight: 600; }
    #header .subtitle { font-size: 13px; color: #8b949e; }
    .grid { display: grid; gap: 16px; padding: 16px 24px; }
    .kpi-row { grid-template-columns: repeat(4, 1fr); }
    .chart-row { grid-template-columns: repeat(2, 1fr); }
    .full-row { grid-template-columns: 1fr; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; overflow: hidden; }
    .card h3 { font-size: 13px; font-weight: 600; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; }
    .kpi-card { text-align: center; padding: 20px 16px; }
    .kpi-card .value { font-size: 32px; font-weight: 700; color: #f0f6fc; }
    .kpi-card .label { font-size: 12px; color: #8b949e; margin-top: 4px; }
    .kpi-card .accent-green .value { color: #7ee787; }
    .kpi-card .accent-blue .value { color: #58a6ff; }
    .kpi-card .accent-orange .value { color: #ffa657; }
    .kpi-card .accent-purple .value { color: #d2a8ff; }
    canvas { width: 100%; height: 100%; display: block; }
    .chart-container { position: relative; height: 280px; }
    .graph-container { position: relative; height: 400px; }
    .event-table { max-height: 280px; overflow-y: auto; }
    .event-table table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .event-table th { text-align: left; padding: 6px 8px; border-bottom: 1px solid #30363d; color: #8b949e; position: sticky; top: 0; background: #161b22; }
    .event-table td { padding: 5px 8px; border-bottom: 1px solid #21262d; }
    .event-table tr:hover { background: #1c2128; }
    .badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 500; }
    .badge-green { background: rgba(126,231,135,0.15); color: #7ee787; }
    .badge-blue { background: rgba(88,166,255,0.15); color: #58a6ff; }
    .badge-orange { background: rgba(255,166,87,0.15); color: #ffa657; }
    .badge-red { background: rgba(248,81,73,0.15); color: #f85149; }
    .badge-purple { background: rgba(210,168,255,0.15); color: #d2a8ff; }
    .cross-session { margin-top: 8px; }
    .cross-session table { width: 100%; }
    .trend-up::after { content: ' \\2191'; color: #f85149; }
    .trend-down::after { content: ' \\2193'; color: #7ee787; }
    .trend-stable::after { content: ' \\2192'; color: #8b949e; }
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: #0d1117; }
    ::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }
  </style>
</head>
<body>
  <div id="header">
    <div>
      <h1>Cortex Dashboard</h1>
      <span class="subtitle">Session observability</span>
    </div>
    <span class="subtitle" id="timestamp"></span>
  </div>

  <!-- KPI Row -->
  <div class="grid kpi-row">
    <div class="card kpi-card" id="kpi-tokens"></div>
    <div class="card kpi-card" id="kpi-cost"></div>
    <div class="card kpi-card" id="kpi-duration"></div>
    <div class="card kpi-card" id="kpi-quality"></div>
  </div>

  <!-- Charts Row 1: Timeline + Tool Usage -->
  <div class="grid chart-row">
    <div class="card">
      <h3>Token Timeline</h3>
      <div class="chart-container"><canvas id="chart-timeline"></canvas></div>
    </div>
    <div class="card">
      <h3>Tool Usage</h3>
      <div class="chart-container"><canvas id="chart-tools"></canvas></div>
    </div>
  </div>

  <!-- Charts Row 2: Quality Radar + Cost by Model -->
  <div class="grid chart-row">
    <div class="card">
      <h3>Quality Radar</h3>
      <div class="chart-container"><canvas id="chart-radar"></canvas></div>
    </div>
    <div class="card">
      <h3>Cost by Model</h3>
      <div class="chart-container"><canvas id="chart-cost"></canvas></div>
    </div>
  </div>

  <!-- Cache Efficiency Row -->
  <div class="grid chart-row" id="cache-row">
    <div class="card">
      <h3>Cache Efficiency</h3>
      <div class="chart-container"><canvas id="chart-cache"></canvas></div>
    </div>
    <div class="card">
      <h3>Cost Recommendations</h3>
      <div class="event-table" id="cost-recs"></div>
    </div>
  </div>

  <!-- Detail Row: Activity Gantt + Event Feed -->
  <div class="grid chart-row">
    <div class="card">
      <h3>Activity Timeline</h3>
      <div class="chart-container"><canvas id="chart-gantt"></canvas></div>
    </div>
    <div class="card">
      <h3>Event Feed</h3>
      <div class="event-table" id="event-feed"></div>
    </div>
  </div>

  <!-- Cross-Session History (conditional) -->
  <div class="grid full-row" id="cross-session-row" style="display:none;">
    <div class="card">
      <h3>Session History</h3>
      <div class="event-table cross-session" id="session-history"></div>
    </div>
  </div>

  <!-- Knowledge Graph -->
  <div class="grid full-row">
    <div class="card">
      <h3>Knowledge Graph</h3>
      <div class="graph-container"><canvas id="chart-graph"></canvas></div>
    </div>
  </div>

  <script>
    const D = ${dataJson};

    // ── Helpers ──
    const TYPE_COLORS = {
      file:'#58a6ff',function:'#d2a8ff',tool:'#7ee787',decision:'#ffa657',
      error:'#f85149',agent:'#79c0ff',pattern:'#d29922',hook:'#56d4dd',
      skill:'#f778ba',query:'#8b949e'
    };
    const CHART_COLORS = ['#58a6ff','#7ee787','#ffa657','#d2a8ff','#f85149','#56d4dd','#d29922','#f778ba','#79c0ff','#8b949e'];

    function setupCanvas(id) {
      const c = document.getElementById(id);
      const r = c.parentElement.getBoundingClientRect();
      c.width = r.width; c.height = r.height;
      return [c, c.getContext('2d')];
    }

    function fmt(n) { return n >= 1000000 ? (n/1000000).toFixed(1)+'M' : n >= 1000 ? (n/1000).toFixed(1)+'K' : String(Math.round(n)); }
    function fmtUsd(n) { return n >= 1 ? '$'+n.toFixed(2) : n >= 0.01 ? '$'+n.toFixed(3) : '$'+n.toFixed(5); }
    function esc(s) { var d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }

    // ── KPIs ──
    document.getElementById('timestamp').textContent = new Date().toLocaleString();
    document.getElementById('kpi-tokens').innerHTML = '<div class="accent-blue"><div class="value">'+fmt(D.kpis.total_tokens)+'</div></div><div class="label">Total Tokens</div>';
    document.getElementById('kpi-cost').innerHTML = '<div class="accent-orange"><div class="value">'+fmtUsd(D.kpis.estimated_cost)+'</div></div><div class="label">Estimated Cost</div>';
    document.getElementById('kpi-duration').innerHTML = '<div class="accent-purple"><div class="value">'+D.kpis.session_duration_minutes+'m</div></div><div class="label">Session Duration</div>';

    var qColor = D.kpis.quality_score >= 70 ? 'accent-green' : D.kpis.quality_score >= 45 ? 'accent-orange' : 'accent-red';
    document.getElementById('kpi-quality').innerHTML = '<div class="'+qColor+'"><div class="value">'+D.kpis.quality_score+'</div></div><div class="label">Quality ('+D.kpis.quality_grade+')</div>';

    // ── Token Timeline (Line Chart) ──
    (function() {
      var [c, ctx] = setupCanvas('chart-timeline');
      var buckets = D.timeline.buckets;
      if (!buckets.length) return;

      var pad = {t:20, r:20, b:30, l:50};
      var w = c.width - pad.l - pad.r;
      var h = c.height - pad.t - pad.b;
      var maxT = Math.max(...buckets.map(b => b.tokens_in), 1);

      // Grid lines
      ctx.strokeStyle = '#21262d'; ctx.lineWidth = 1;
      for (var i = 0; i <= 4; i++) {
        var y = pad.t + h - (i/4)*h;
        ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l+w, y); ctx.stroke();
        ctx.fillStyle = '#8b949e'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
        ctx.fillText(fmt(maxT*i/4), pad.l-6, y+3);
      }

      // X-axis labels
      ctx.textAlign = 'center';
      var step = Math.max(1, Math.floor(buckets.length / 6));
      for (var i = 0; i < buckets.length; i += step) {
        var x = pad.l + (i / (buckets.length-1||1)) * w;
        ctx.fillText(buckets[i].minute_bucket + 'm', x, c.height - 8);
      }

      // Line
      ctx.beginPath();
      ctx.strokeStyle = '#58a6ff'; ctx.lineWidth = 2;
      buckets.forEach(function(b, i) {
        var x = pad.l + (i / (buckets.length-1||1)) * w;
        var y = pad.t + h - (b.tokens_in / maxT) * h;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();

      // Fill under line
      var lastX = pad.l + w;
      var lastY = pad.t + h - (buckets[buckets.length-1].tokens_in / maxT) * h;
      ctx.lineTo(lastX, pad.t + h);
      ctx.lineTo(pad.l, pad.t + h);
      ctx.closePath();
      ctx.fillStyle = 'rgba(88,166,255,0.1)';
      ctx.fill();

      // Spike markers
      D.timeline.spikes.forEach(function(s) {
        var idx = buckets.findIndex(b => b.minute_bucket === s.minute_bucket);
        if (idx < 0) return;
        var x = pad.l + (idx / (buckets.length-1||1)) * w;
        var y = pad.t + h - (s.tokens / maxT) * h;
        ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI*2);
        ctx.fillStyle = '#f85149'; ctx.fill();
        ctx.strokeStyle = '#0d1117'; ctx.lineWidth = 2; ctx.stroke();
      });
    })();

    // ── Tool Usage (Horizontal Bar Chart) ──
    (function() {
      var [c, ctx] = setupCanvas('chart-tools');
      var tools = Object.entries(D.activity.tools_summary).sort((a,b) => b[1]-a[1]).slice(0, 10);
      if (!tools.length) return;

      var pad = {t:10, r:20, b:10, l:80};
      var w = c.width - pad.l - pad.r;
      var h = c.height - pad.t - pad.b;
      var maxV = Math.max(...tools.map(t => t[1]), 1);
      var barH = Math.min(28, h / tools.length - 4);

      tools.forEach(function(t, i) {
        var y = pad.t + i * (h / tools.length) + (h / tools.length - barH) / 2;
        var barW = (t[1] / maxV) * w;

        // Bar
        ctx.fillStyle = CHART_COLORS[i % CHART_COLORS.length];
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.roundRect(pad.l, y, barW, barH, 4);
        ctx.fill();
        ctx.globalAlpha = 1;

        // Label
        ctx.fillStyle = '#c9d1d9'; ctx.font = '11px sans-serif'; ctx.textAlign = 'right';
        ctx.fillText(t[0].substring(0, 12), pad.l - 6, y + barH/2 + 4);

        // Value
        ctx.fillStyle = '#8b949e'; ctx.textAlign = 'left';
        ctx.fillText(String(t[1]), pad.l + barW + 6, y + barH/2 + 4);
      });
    })();

    // ── Quality Radar (Spider Chart) ──
    (function() {
      var [c, ctx] = setupCanvas('chart-radar');
      var labels = D.quality.radar_labels || [];
      var values = D.quality.radar_values || [];
      if (!labels.length) return;

      var cx = c.width / 2, cy = c.height / 2;
      var R = Math.min(cx, cy) - 40;
      var n = labels.length;
      var angleStep = (Math.PI * 2) / n;

      // Grid rings
      [0.25, 0.5, 0.75, 1.0].forEach(function(r) {
        ctx.beginPath();
        for (var i = 0; i <= n; i++) {
          var a = i * angleStep - Math.PI/2;
          var x = cx + Math.cos(a) * R * r;
          var y = cy + Math.sin(a) * R * r;
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.strokeStyle = '#21262d'; ctx.lineWidth = 1; ctx.stroke();
      });

      // Axis lines + labels
      labels.forEach(function(label, i) {
        var a = i * angleStep - Math.PI/2;
        var x = cx + Math.cos(a) * R;
        var y = cy + Math.sin(a) * R;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y);
        ctx.strokeStyle = '#21262d'; ctx.stroke();

        // Label
        var lx = cx + Math.cos(a) * (R + 18);
        var ly = cy + Math.sin(a) * (R + 18);
        ctx.fillStyle = '#8b949e'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(label.replace(/_/g, ' '), lx, ly + 3);
      });

      // Data polygon
      ctx.beginPath();
      values.forEach(function(v, i) {
        var a = i * angleStep - Math.PI/2;
        var r = (v / 100) * R;
        var x = cx + Math.cos(a) * r;
        var y = cy + Math.sin(a) * r;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fillStyle = 'rgba(126,231,135,0.15)';
      ctx.fill();
      ctx.strokeStyle = '#7ee787'; ctx.lineWidth = 2; ctx.stroke();

      // Data points
      values.forEach(function(v, i) {
        var a = i * angleStep - Math.PI/2;
        var r = (v / 100) * R;
        ctx.beginPath(); ctx.arc(cx + Math.cos(a)*r, cy + Math.sin(a)*r, 4, 0, Math.PI*2);
        ctx.fillStyle = '#7ee787'; ctx.fill();
      });

      // Center score
      ctx.fillStyle = '#f0f6fc'; ctx.font = 'bold 24px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(D.quality.score, cx, cy + 8);
    })();

    // ── Cost by Model (Pie Chart) ──
    (function() {
      var [c, ctx] = setupCanvas('chart-cost');
      var models = Object.entries(D.cost.by_model);
      if (!models.length) {
        ctx.fillStyle = '#8b949e'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('No model data (enrich hooks to track)', c.width/2, c.height/2);
        return;
      }

      var total = models.reduce((a, m) => a + m[1].cost_usd, 0);
      var cx = c.width * 0.4, cy = c.height / 2;
      var R = Math.min(cx, cy) - 30;
      var startAngle = -Math.PI / 2;
      var modelColors = { opus: '#ffa657', sonnet: '#58a6ff', haiku: '#7ee787', unknown: '#8b949e' };

      models.forEach(function(m, i) {
        var slice = total > 0 ? (m[1].cost_usd / total) * Math.PI * 2 : 0;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, R, startAngle, startAngle + slice);
        ctx.closePath();
        ctx.fillStyle = modelColors[m[0]] || CHART_COLORS[i % CHART_COLORS.length];
        ctx.fill();
        ctx.strokeStyle = '#0d1117'; ctx.lineWidth = 2; ctx.stroke();
        startAngle += slice;
      });

      // Legend
      var lx = c.width * 0.7, ly = c.height * 0.25;
      models.forEach(function(m, i) {
        ctx.fillStyle = modelColors[m[0]] || CHART_COLORS[i % CHART_COLORS.length];
        ctx.fillRect(lx, ly + i * 24, 12, 12);
        ctx.fillStyle = '#c9d1d9'; ctx.font = '12px sans-serif'; ctx.textAlign = 'left';
        ctx.fillText(m[0] + ': ' + fmtUsd(m[1].cost_usd) + ' (' + fmt(m[1].tokens) + ' tok)', lx + 18, ly + i * 24 + 10);
      });

      // Center total
      ctx.fillStyle = '#f0f6fc'; ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(fmtUsd(total), cx, cy + 6);
    })();

    // ── Activity Gantt ──
    (function() {
      var [c, ctx] = setupCanvas('chart-gantt');
      var tracks = D.activity.tracks;
      if (!tracks.length) return;

      var pad = {t:10, r:20, b:20, l:80};
      var w = c.width - pad.l - pad.r;
      var h = c.height - pad.t - pad.b;
      var barH = Math.min(20, h / tracks.length - 4);

      // Compute time range across all activations
      var allTimes = [];
      tracks.forEach(function(t) { t.activations.forEach(function(a) {
        allTimes.push(new Date(a.start).getTime(), new Date(a.end).getTime());
      }); });
      if (!allTimes.length) return;
      var minT = Math.min(...allTimes), maxT = Math.max(...allTimes);
      var range = maxT - minT || 1;

      tracks.forEach(function(t, i) {
        var y = pad.t + i * (h / tracks.length) + (h / tracks.length - barH) / 2;

        // Track label
        ctx.fillStyle = '#c9d1d9'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
        ctx.fillText(t.name.substring(0, 12), pad.l - 6, y + barH/2 + 3);

        // Activation bars
        var color = CHART_COLORS[i % CHART_COLORS.length];
        t.activations.forEach(function(a) {
          var x0 = pad.l + ((new Date(a.start).getTime() - minT) / range) * w;
          var x1 = pad.l + ((new Date(a.end).getTime() - minT) / range) * w;
          var barW = Math.max(3, x1 - x0);
          ctx.fillStyle = color; ctx.globalAlpha = 0.8;
          ctx.beginPath(); ctx.roundRect(x0, y, barW, barH, 3); ctx.fill();
          ctx.globalAlpha = 1;
        });
      });

      // Time axis
      ctx.fillStyle = '#8b949e'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
      for (var i = 0; i <= 4; i++) {
        var t = new Date(minT + (i/4) * range);
        var x = pad.l + (i/4) * w;
        ctx.fillText(t.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}), x, c.height - 4);
      }
    })();

    // ── Event Feed ──
    (function() {
      var container = document.getElementById('event-feed');
      var events = D.events;
      if (!events.length) { container.textContent = 'No events'; return; }

      var badgeClass = { write:'badge-green', read:'badge-blue', bash:'badge-orange', edit:'badge-green', search:'badge-purple', session_start:'badge-blue', session_end:'badge-blue' };
      var html = '<table><thead><tr><th>Time</th><th>Type</th><th>Tool</th><th>Model</th><th>Tokens</th></tr></thead><tbody>';
      events.forEach(function(e) {
        var time = e.ts ? new Date(e.ts).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'}) : '-';
        var badge = badgeClass[e.type] || 'badge-blue';
        html += '<tr><td>'+time+'</td>';
        html += '<td><span class="badge '+badge+'">'+esc(e.type)+'</span></td>';
        html += '<td>'+esc(e.tool||'-')+'</td>';
        html += '<td>'+esc(e.model||'-')+'</td>';
        html += '<td>'+esc(e.tokens_est||'-')+'</td></tr>';
      });
      html += '</tbody></table>';
      container.innerHTML = html;
    })();

    // ── Cross-Session History ──
    (function() {
      if (!D.crossSession || !D.crossSession.sessions.length) return;
      document.getElementById('cross-session-row').style.display = '';
      var container = document.getElementById('session-history');
      var cs = D.crossSession;

      var html = '<div style="margin-bottom:12px;font-size:13px;color:#8b949e;">';
      html += 'Avg tokens: <strong class="trend-'+cs.token_trend+'">'+fmt(cs.avg_tokens)+'</strong>';
      html += ' &nbsp;|&nbsp; Avg cost: <strong class="trend-'+cs.cost_trend+'">'+fmtUsd(cs.avg_cost)+'</strong>';
      html += ' &nbsp;|&nbsp; Avg duration: <strong>'+cs.avg_duration+'m</strong>';
      html += '</div>';

      html += '<table><thead><tr><th>Session</th><th>Start</th><th>Duration</th><th>Tokens</th><th>Cost</th><th>Events</th></tr></thead><tbody>';
      cs.sessions.slice(-20).reverse().forEach(function(s) {
        var start = new Date(s.start_ts).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
        html += '<tr>';
        html += '<td style="font-family:monospace;font-size:11px;">'+esc(s.session_id.substring(0,16))+'</td>';
        html += '<td>'+start+'</td>';
        html += '<td>'+s.duration_minutes+'m</td>';
        html += '<td>'+fmt(s.total_tokens)+'</td>';
        html += '<td>'+fmtUsd(s.cost_usd)+'</td>';
        html += '<td>'+s.event_count+'</td>';
        html += '</tr>';
      });
      html += '</tbody></table>';
      container.innerHTML = html;
    })();

    // ── Cache Efficiency ──
    (function() {
      var ce = D.cacheEfficiency;
      if (!ce || ce.total_turns === 0) {
        document.getElementById('cache-row').style.display = 'none';
        return;
      }

      var [c, ctx] = setupCanvas('chart-cache');
      var pad = {t:30, r:30, b:40, l:60};
      var w = c.width - pad.l - pad.r;
      var h = c.height - pad.t - pad.b;

      // Draw cache efficiency gauge
      var efficiency = ce.cache_efficiency_pct;
      var gaugeColor = efficiency >= 80 ? '#7ee787' : efficiency >= 50 ? '#ffa657' : '#f85149';

      // Semicircle gauge
      var gx = c.width / 2, gy = c.height * 0.55;
      var gr = Math.min(c.width, c.height) * 0.3;

      // Background arc
      ctx.beginPath();
      ctx.arc(gx, gy, gr, Math.PI, 0);
      ctx.strokeStyle = '#21262d'; ctx.lineWidth = 20; ctx.lineCap = 'round'; ctx.stroke();

      // Value arc
      var angle = Math.PI + (efficiency / 100) * Math.PI;
      ctx.beginPath();
      ctx.arc(gx, gy, gr, Math.PI, angle);
      ctx.strokeStyle = gaugeColor; ctx.lineWidth = 20; ctx.lineCap = 'round'; ctx.stroke();

      // Center text
      ctx.fillStyle = '#f0f6fc'; ctx.font = 'bold 36px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(efficiency + '%', gx, gy - 10);
      ctx.fillStyle = '#8b949e'; ctx.font = '12px sans-serif';
      ctx.fillText('Cache Efficiency', gx, gy + 10);

      // Session type badge
      var typeColor = ce.session_type === 'resume' ? '#ffa657' : '#7ee787';
      ctx.fillStyle = typeColor; ctx.font = 'bold 11px sans-serif';
      ctx.fillText(ce.session_type.toUpperCase() + ' session', gx, gy + 30);

      // Stats below
      ctx.fillStyle = '#8b949e'; ctx.font = '11px sans-serif';
      ctx.fillText(ce.total_turns + ' turns | Savings: ' + fmtUsd(ce.estimated_cache_savings_usd), gx, gy + gr + 20);
      if (ce.cache_miss_detected) {
        ctx.fillStyle = '#f85149';
        ctx.fillText('Cache miss detected (first turn ' + ce.first_turn_cost_ratio + 'x avg)', gx, gy + gr + 38);
      }

      // Recommendations panel
      var recsContainer = document.getElementById('cost-recs');
      if (ce.recommendations.length) {
        var html = '<div style="padding:4px 0;">';
        ce.recommendations.forEach(function(r, i) {
          var icon = r.includes('miss') || r.includes('spike') ? '&#9888;' : r.includes('saving') || r.includes('good') ? '&#10003;' : '&#8226;';
          var color = r.includes('miss') || r.includes('spike') ? '#ffa657' : r.includes('saving') || r.includes('good') ? '#7ee787' : '#c9d1d9';
          html += '<div style="padding:8px 12px;margin:4px 0;background:#1c2128;border-radius:6px;border-left:3px solid '+color+';font-size:12px;line-height:1.5;">';
          html += '<span style="color:'+color+';">'+icon+'</span> ' + esc(r);
          html += '</div>';
        });
        html += '</div>';
        recsContainer.innerHTML = html;
      } else {
        recsContainer.innerHTML = '<div style="text-align:center;padding:40px;color:#8b949e;">No recommendations</div>';
      }
    })();

    // ── Knowledge Graph (Force-Directed) ──
    (function() {
      var [c, ctx] = setupCanvas('chart-graph');
      var data = D.graph;
      if (!data || !data.nodes || !data.nodes.length) {
        ctx.fillStyle = '#8b949e'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('No knowledge graph data', c.width/2, c.height/2);
        return;
      }

      var cx = c.width/2, cy = c.height/2;
      var nodes = data.nodes.map(function(n, i) {
        return {
          ...n,
          x: cx + Math.cos(i*2.399)*180 + (Math.random()-0.5)*80,
          y: cy + Math.sin(i*2.399)*180 + (Math.random()-0.5)*80,
          vx: 0, vy: 0,
          radius: Math.max(5, Math.min(20, Math.sqrt((n.token_cost||10)/10)))
        };
      });

      var edges = (data.edges||[]).map(function(e) {
        return { ...e, src: nodes.find(n=>n.id===e.source), tgt: nodes.find(n=>n.id===e.target) };
      }).filter(function(e) { return e.src && e.tgt; });

      // Force simulation (100 iterations for dashboard — faster than full explorer)
      for (var iter = 0; iter < 100; iter++) {
        var alpha = 1 - iter/100;
        for (var i = 0; i < nodes.length; i++) {
          for (var j = i+1; j < nodes.length; j++) {
            var dx = nodes[j].x-nodes[i].x, dy = nodes[j].y-nodes[i].y;
            var d = Math.sqrt(dx*dx+dy*dy)||1;
            var f = (400*alpha)/(d*d);
            nodes[i].vx -= dx/d*f; nodes[i].vy -= dy/d*f;
            nodes[j].vx += dx/d*f; nodes[j].vy += dy/d*f;
          }
        }
        edges.forEach(function(e) {
          var dx = e.tgt.x-e.src.x, dy = e.tgt.y-e.src.y;
          var d = Math.sqrt(dx*dx+dy*dy)||1;
          var f = (d-80)*0.01*alpha*(e.weight||0.5);
          e.src.vx += dx/d*f; e.src.vy += dy/d*f;
          e.tgt.vx -= dx/d*f; e.tgt.vy -= dy/d*f;
        });
        nodes.forEach(function(n) {
          n.vx += (cx-n.x)*0.001*alpha; n.vy += (cy-n.y)*0.001*alpha;
          n.x += n.vx*0.5; n.y += n.vy*0.5;
          n.vx *= 0.9; n.vy *= 0.9;
        });
      }

      // Draw
      edges.forEach(function(e) {
        ctx.beginPath(); ctx.moveTo(e.src.x, e.src.y); ctx.lineTo(e.tgt.x, e.tgt.y);
        ctx.strokeStyle = 'rgba(48,54,61,'+(0.3+(e.weight||0.5)*0.5)+')';
        ctx.lineWidth = 1+(e.weight||0.5); ctx.stroke();
      });
      nodes.forEach(function(n) {
        ctx.beginPath(); ctx.arc(n.x, n.y, n.radius, 0, Math.PI*2);
        ctx.fillStyle = TYPE_COLORS[n.type]||'#8b949e'; ctx.globalAlpha = 0.85; ctx.fill();
        ctx.globalAlpha = 1; ctx.strokeStyle = '#0d1117'; ctx.lineWidth = 1.5; ctx.stroke();
        if (n.radius > 7) {
          ctx.font = '9px sans-serif'; ctx.fillStyle = '#c9d1d9'; ctx.textAlign = 'center';
          ctx.fillText((n.name||'').substring(0, 16), n.x, n.y + n.radius + 12);
        }
      });

      // Legend
      var types = [...new Set(nodes.map(n=>n.type))];
      var lx = 12, ly = 12;
      types.forEach(function(t, i) {
        ctx.fillStyle = TYPE_COLORS[t]||'#8b949e';
        ctx.fillRect(lx, ly + i*18, 8, 8);
        ctx.fillStyle = '#8b949e'; ctx.font = '10px sans-serif'; ctx.textAlign = 'left';
        ctx.fillText(t, lx + 14, ly + i*18 + 8);
      });
    })();
  </script>
</body>
</html>`;
}
