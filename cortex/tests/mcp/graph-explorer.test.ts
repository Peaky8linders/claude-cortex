import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { computeGraphExplorer, type GraphExplorerJsonResult, type GraphExplorerHtmlResult } from "../../src/mcp/tools/graph-explorer.js";

const TEST_DIR = join(tmpdir(), "cortex-test-graph-" + Date.now());
const GRAPH_DIR = join(TEST_DIR, "graph");

beforeEach(() => {
  mkdirSync(GRAPH_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

function writeGraph(nodes: object[], edges: object[]) {
  writeFileSync(join(GRAPH_DIR, "nodes.json"), JSON.stringify(nodes));
  writeFileSync(join(GRAPH_DIR, "edges.json"), JSON.stringify(edges));
}

describe("computeGraphExplorer (json mode)", () => {
  it("returns empty graph when no files exist", async () => {
    const emptyDir = join(tmpdir(), "cortex-empty-" + Date.now());
    mkdirSync(join(emptyDir, "graph"), { recursive: true });
    writeFileSync(join(emptyDir, "graph", "nodes.json"), "[]");
    writeFileSync(join(emptyDir, "graph", "edges.json"), "[]");

    const result = await computeGraphExplorer("json", undefined, 50, emptyDir) as GraphExplorerJsonResult;
    expect(result.mode).toBe("json");
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);

    rmSync(emptyDir, { recursive: true });
  });

  it("loads Brainiac nodes and translates types", async () => {
    writeGraph(
      [
        { id: "pat-1", type: "pattern", content: "Use async hooks for PostToolUse", keywords: ["hooks", "async"] },
        { id: "dec-1", type: "decision", content: "JSON persistence over SQLite", keywords: ["persistence"] },
      ],
      [
        { from_id: "pat-1", to_id: "dec-1", relation: "semantic", weight: 0.8 },
      ]
    );

    const result = await computeGraphExplorer("json", undefined, 50, TEST_DIR) as GraphExplorerJsonResult;
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(1);
    expect(result.nodes.find(n => n.id === "pat-1")?.type).toBe("pattern");
    expect(result.nodes.find(n => n.id === "dec-1")?.type).toBe("decision");
  });

  it("filters by node type", async () => {
    writeGraph(
      [
        { id: "pat-1", type: "pattern", content: "Pattern node" },
        { id: "dec-1", type: "decision", content: "Decision node" },
        { id: "pat-2", type: "pattern", content: "Another pattern" },
      ],
      []
    );

    const result = await computeGraphExplorer("json", "pattern", 50, TEST_DIR) as GraphExplorerJsonResult;
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes.every(n => n.type === "pattern")).toBe(true);
  });

  it("limits nodes by max_nodes", async () => {
    const nodes = Array.from({ length: 20 }, (_, i) => ({
      id: `pat-${i}`,
      type: "pattern",
      content: `Pattern ${i}`,
    }));
    writeGraph(nodes, []);

    const result = await computeGraphExplorer("json", undefined, 5, TEST_DIR) as GraphExplorerJsonResult;
    expect(result.nodes).toHaveLength(5);
  });

  it("includes metrics and clusters", async () => {
    writeGraph(
      [
        { id: "pat-1", type: "pattern", content: "Node A" },
        { id: "pat-2", type: "pattern", content: "Node B" },
      ],
      [{ from_id: "pat-1", to_id: "pat-2", relation: "semantic", weight: 0.7 }]
    );

    const result = await computeGraphExplorer("json", undefined, 50, TEST_DIR) as GraphExplorerJsonResult;
    expect(result.metrics).toBeDefined();
    expect(result.metrics.clusterCount).toBeDefined();
    expect(typeof result.metrics.qualityScore).toBe("number");
    expect(result.clusters).toBeDefined();
  });

  it("assigns cluster IDs to nodes", async () => {
    writeGraph(
      [
        { id: "pat-1", type: "pattern", content: "A" },
        { id: "pat-2", type: "pattern", content: "B" },
      ],
      [{ from_id: "pat-1", to_id: "pat-2", relation: "semantic", weight: 0.8 }]
    );

    const result = await computeGraphExplorer("json", undefined, 50, TEST_DIR) as GraphExplorerJsonResult;
    const clusterIds = new Set(result.nodes.map(n => n.cluster_id));
    expect(clusterIds.size).toBe(1);
  });

  it("estimates token cost from content length", async () => {
    writeGraph(
      [
        { id: "pat-1", type: "pattern", content: "A".repeat(400) },
      ],
      []
    );

    const result = await computeGraphExplorer("json", undefined, 50, TEST_DIR) as GraphExplorerJsonResult;
    expect(result.nodes[0].token_cost).toBe(100);
  });
});

describe("computeGraphExplorer (html mode)", () => {
  it("generates HTML file with embedded data", async () => {
    writeGraph(
      [
        { id: "pat-1", type: "pattern", content: "Test node" },
      ],
      []
    );

    const result = await computeGraphExplorer("html", undefined, 50, TEST_DIR) as GraphExplorerHtmlResult;
    expect(result.mode).toBe("html");
    expect(result.path).toContain("graph-explorer.html");
    expect(result.node_count).toBe(1);

    expect(existsSync(result.path)).toBe(true);
    const html = readFileSync(result.path, "utf-8");
    expect(html).toContain("Cortex Graph Explorer");
    expect(html).toContain("__GRAPH_DATA__");
    expect(html).toContain("pat-1");
  });
});
