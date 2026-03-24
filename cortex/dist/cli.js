#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import { KnowledgeGraph } from "./graph/knowledge-graph.js";
import { HookProcessor } from "./hooks/processor.js";
const HELP = `
cortex — Your Claude Code nervous system

Commands:
  status               Show live graph metrics and recommendations
  graph                Export the session knowledge graph as JSON
  recommend            Show actionable optimization recommendations
  snapshot             Save critical context to .cortex/snapshots/
  install-hooks        Install Cortex hooks into Claude Code settings
  ingest <file.jsonl>  Ingest a Claude Code session log into the graph
  help                 Show this help

Options:
  --json               JSON output
  --session <dir>      Claude session directory (default: auto-detect)
`;
function main() {
    const args = process.argv.slice(2);
    const cmd = args[0];
    const isJson = args.includes("--json");
    switch (cmd) {
        case "status":
            cmdStatus(isJson);
            break;
        case "graph":
            cmdGraph();
            break;
        case "recommend":
            cmdRecommend(isJson);
            break;
        case "snapshot":
            cmdSnapshot();
            break;
        case "install-hooks":
            cmdInstallHooks();
            break;
        case "ingest":
            cmdIngest(args[1], isJson);
            break;
        case "help":
        case "--help":
        case "-h":
        case undefined:
            console.log(HELP);
            break;
        default:
            console.error(`Unknown: ${cmd}`);
            console.log(HELP);
            process.exit(1);
    }
}
function buildGraphFromSession() {
    const graph = new KnowledgeGraph();
    const processor = new HookProcessor(graph);
    // Try to find session logs
    const sessionDir = findSessionDir();
    if (!sessionDir)
        return graph;
    const logFiles = readdirSync(sessionDir)
        .filter(f => f.endsWith(".jsonl"))
        .sort()
        .slice(-5); // last 5 session files
    for (const file of logFiles) {
        const content = readFileSync(join(sessionDir, file), "utf-8");
        for (const line of content.split("\n").filter(Boolean)) {
            try {
                const event = JSON.parse(line);
                if (event.hook_event_name || event.type) {
                    processor.process({
                        ...event,
                        hook_event_name: event.hook_event_name ?? event.type ?? "unknown",
                        session_id: event.session_id ?? "current",
                    });
                }
            }
            catch { /* skip malformed lines */ }
        }
    }
    return graph;
}
function findSessionDir() {
    const candidates = [
        join(process.env.HOME ?? "~", ".claude", "projects"),
        join(process.cwd(), ".cortex", "events"),
    ];
    for (const dir of candidates) {
        if (existsSync(dir))
            return dir;
    }
    return null;
}
function cmdStatus(isJson) {
    const graph = buildGraphFromSession();
    const metrics = graph.computeMetrics();
    if (isJson) {
        console.log(JSON.stringify(metrics, null, 2));
        return;
    }
    const scoreColor = metrics.qualityScore >= 80 ? "🟢" : metrics.qualityScore >= 60 ? "🟡" : metrics.qualityScore >= 40 ? "🟠" : "🔴";
    console.log("╔══════════════════════════════════════════╗");
    console.log(`║  ${scoreColor} CORTEX  Score: ${metrics.qualityScore}/100               ║`);
    console.log("╠══════════════════════════════════════════╣");
    console.log(`║  Nodes: ${String(metrics.nodeCount).padStart(4)}  │  Edges: ${String(metrics.edgeCount).padStart(4)}          ║`);
    console.log(`║  Clusters: ${String(metrics.clusters.length).padStart(2)}  │  Density: ${(metrics.density * 100).toFixed(1).padStart(5)}%     ║`);
    console.log("╠══════════════════════════════════════════╣");
    console.log("║  TOKEN BUDGET                            ║");
    console.log(`║  Total: ${metrics.tokenBudget.total.toLocaleString().padStart(8)}  Wasted: ${metrics.tokenBudget.wasted.toLocaleString().padStart(8)}  ║`);
    console.log(`║  Efficiency: ${(metrics.tokenBudget.efficiency * 100).toFixed(0).padStart(3)}%                        ║`);
    console.log("╠══════════════════════════════════════════╣");
    if (metrics.hotNodes.length > 0) {
        console.log("║  HOT NODES                               ║");
        for (const n of metrics.hotNodes.slice(0, 3)) {
            console.log(`║  ${n.type.padEnd(8)} ${n.name.slice(0, 25).padEnd(25)} ×${n.accessCount}  ║`);
        }
    }
    if (metrics.recommendations.length > 0) {
        console.log("╠══════════════════════════════════════════╣");
        console.log(`║  ${metrics.recommendations.length} RECOMMENDATIONS                       ║`);
        const icons = { critical: "🔴", warning: "🟠", optimize: "🟡", suggestion: "🔵" };
        for (const rec of metrics.recommendations.slice(0, 3)) {
            console.log(`║  ${icons[rec.type] ?? "⚪"} ${rec.title.slice(0, 36).padEnd(36)}   ║`);
        }
    }
    console.log("╚══════════════════════════════════════════╝");
}
function cmdGraph() {
    const graph = buildGraphFromSession();
    console.log(JSON.stringify(graph.toJSON(), null, 2));
}
function cmdRecommend(isJson) {
    const graph = buildGraphFromSession();
    const metrics = graph.computeMetrics();
    if (isJson) {
        console.log(JSON.stringify(metrics.recommendations, null, 2));
        return;
    }
    if (metrics.recommendations.length === 0) {
        console.log("✅ No recommendations — context looks healthy.");
        return;
    }
    const icons = { critical: "🔴", warning: "🟠", optimize: "🟡", suggestion: "🔵" };
    for (const rec of metrics.recommendations) {
        console.log(`\n${icons[rec.type] ?? "⚪"} [${rec.type.toUpperCase()}] ${rec.title}`);
        console.log(`  ${rec.description}`);
        console.log(`  → Action: ${rec.action}`);
        console.log(`  → Impact: ${rec.impact}`);
        if (rec.estimatedSavings > 0) {
            console.log(`  → Saves: ~${rec.estimatedSavings.toLocaleString()} tokens`);
        }
    }
}
function cmdSnapshot() {
    const graph = buildGraphFromSession();
    const metrics = graph.computeMetrics();
    const dir = ".cortex/snapshots";
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    const filename = `${dir}/snapshot-${Date.now()}.json`;
    const snapshot = {
        ...graph.toJSON(),
        snapshotAt: new Date().toISOString(),
        recommendations: metrics.recommendations,
    };
    writeFileSync(filename, JSON.stringify(snapshot, null, 2));
    console.log(`✅ Snapshot saved: ${filename}`);
    console.log(`   Score: ${metrics.qualityScore}/100 | Nodes: ${metrics.nodeCount} | Recs: ${metrics.recommendations.length}`);
}
function cmdInstallHooks() {
    const settingsPath = join(process.env.HOME ?? "~", ".claude", "settings.json");
    let settings = {};
    if (existsSync(settingsPath)) {
        try {
            settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
        }
        catch { /* empty */ }
    }
    const hooks = (settings.hooks ?? {});
    const cortexHook = (event) => ({
        matcher: "*",
        hooks: [{
                type: "command",
                command: `echo '{"hook_event_name":"${event}","session_id":"'$CLAUDE_SESSION_ID'","tool_name":"'$CLAUDE_TOOL_NAME'","timestamp":"'$(date -Iseconds)'"}' >> .cortex/events/session.jsonl`,
                timeout: 5,
                async: true,
            }],
    });
    const events = ["SessionStart", "PreToolUse", "PostToolUse", "PostCompact", "Stop", "SubagentStart", "SubagentStop"];
    for (const event of events) {
        if (!hooks[event])
            hooks[event] = [];
        // Check if cortex hook already exists
        const existing = hooks[event].some(h => JSON.stringify(h).includes("cortex/events"));
        if (!existing) {
            hooks[event].push(cortexHook(event));
        }
    }
    settings.hooks = hooks;
    // Ensure events dir exists
    if (!existsSync(".cortex/events"))
        mkdirSync(".cortex/events", { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    console.log("✅ Cortex hooks installed:");
    console.log(`   Settings: ${settingsPath}`);
    console.log(`   Events:   .cortex/events/session.jsonl`);
    console.log(`   Hooks:    ${events.join(", ")}`);
    console.log("\n   Run 'cortex status' during your next session to see the graph build.");
}
function cmdIngest(file, isJson) {
    if (!file || !existsSync(file)) {
        console.error("Error: Provide a .jsonl session file to ingest.");
        process.exit(1);
    }
    const graph = new KnowledgeGraph();
    const processor = new HookProcessor(graph);
    const content = readFileSync(file, "utf-8");
    let processed = 0;
    for (const line of content.split("\n").filter(Boolean)) {
        try {
            const data = JSON.parse(line);
            // Handle both hook events and raw session logs
            const event = {
                hook_event_name: data.hook_event_name ?? data.type ?? inferEventType(data),
                session_id: data.session_id ?? "ingested",
                tool_name: data.tool_name ?? data.tool,
                tool_input: data.tool_input ?? data.input,
                tool_response: data.tool_response ?? data.output ?? data.response,
            };
            processor.process(event);
            processed++;
        }
        catch { /* skip */ }
    }
    const metrics = graph.computeMetrics();
    if (isJson) {
        console.log(JSON.stringify({ processed, ...graph.toJSON() }, null, 2));
    }
    else {
        console.log(`✅ Ingested ${processed} events from ${file}`);
        console.log(`   Graph: ${metrics.nodeCount} nodes, ${metrics.edgeCount} edges`);
        console.log(`   Score: ${metrics.qualityScore}/100`);
        console.log(`   Recommendations: ${metrics.recommendations.length}`);
        if (metrics.recommendations.length > 0) {
            console.log("\n   Top recommendation:");
            const top = metrics.recommendations[0];
            console.log(`   ${top.title}: ${top.action}`);
        }
    }
}
function inferEventType(data) {
    if (data.tool)
        return "PostToolUse";
    if (data.message && typeof data.message === "string")
        return "UserPromptSubmit";
    if (data.role === "user")
        return "UserPromptSubmit";
    if (data.role === "assistant")
        return "PostToolUse";
    return "unknown";
}
main();
