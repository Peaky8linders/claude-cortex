import { describe, it, expect, beforeEach } from "vitest";
import { KnowledgeGraph } from "../src/graph/knowledge-graph.js";
import { ContextHubIntegration } from "../src/analyzer/chub-integration.js";

let graph: KnowledgeGraph;
let chub: ContextHubIntegration;

beforeEach(() => {
  graph = new KnowledgeGraph();
  chub = new ContextHubIntegration(graph);
});

describe("ContextHubIntegration", () => {

  describe("processBashCommand", () => {
    it("tracks chub get commands", () => {
      graph.addNode("tool:Bash", "Bash", "tool");
      chub.processBashCommand('chub get openai/chat --lang py', 'docs content...');

      const chubNode = graph.getNode("chub:openai/chat");
      expect(chubNode).toBeDefined();
      expect(chubNode?.type).toBe("skill");
      expect(chubNode?.qualityImpact).toBe(30);

      const usage = chub.getDocUsage();
      expect(usage.length).toBe(1);
      expect(usage[0].docId).toBe("openai/chat");
      expect(usage[0].language).toBe("py");
    });

    it("tracks chub get without language flag", () => {
      graph.addNode("tool:Bash", "Bash", "tool");
      chub.processBashCommand('chub get stripe/api', 'content');
      const usage = chub.getDocUsage();
      expect(usage[0].language).toBe("default");
    });

    it("tracks chub annotate commands", () => {
      chub.processBashCommand('chub annotate stripe/api "Needs raw body for webhooks"', '');
      const usage = chub.getDocUsage();
      expect(usage.length).toBe(1);
      expect(usage[0].annotations).toContain("Needs raw body for webhooks");
    });

    it("increments fetch count on repeated gets", () => {
      graph.addNode("tool:Bash", "Bash", "tool");
      chub.processBashCommand('chub get openai/chat --lang py', '');
      chub.processBashCommand('chub get openai/chat --lang py', '');
      chub.processBashCommand('chub get openai/chat --lang py', '');
      expect(chub.getDocUsage()[0].fetchCount).toBe(3);
    });

    it("creates edge from Bash tool to chub doc node", () => {
      graph.addNode("tool:Bash", "Bash", "tool");
      chub.processBashCommand('chub get openai/chat', '');
      const edges = graph.getEdgesFor("chub:openai/chat");
      expect(edges.some(e => e.type === "reads")).toBe(true);
    });

    it("ignores non-chub bash commands", () => {
      graph.addNode("tool:Bash", "Bash", "tool");
      chub.processBashCommand('npm install express', '');
      expect(chub.getDocUsage().length).toBe(0);
    });
  });

  describe("detectHallucinations", () => {
    it("detects stale OpenAI chat completions API", () => {
      const recs = chub.detectHallucinations('const response = await openai.ChatCompletion.create({model: "gpt-5"})');
      expect(recs.length).toBeGreaterThan(0);
      expect(recs[0].title).toContain("Stale API");
      expect(recs[0].action).toContain("chub get");
    });

    it("detects stale Stripe Charges API", () => {
      const recs = chub.detectHallucinations('await stripe.Charge.create({ amount: 1000 })');
      expect(recs.length).toBeGreaterThan(0);
    });

    it("detects stale Anthropic completions API", () => {
      const recs = chub.detectHallucinations('const result = anthropic.completions.create()');
      expect(recs.length).toBeGreaterThan(0);
    });

    it("detects stale Supabase auth API", () => {
      const recs = chub.detectHallucinations('await supabase.auth.signIn({ email })');
      expect(recs.length).toBeGreaterThan(0);
    });

    it("returns empty for current API usage", () => {
      const recs = chub.detectHallucinations('const result = await client.messages.create({ model: "claude-opus-4.6" })');
      expect(recs.length).toBe(0);
    });

    it("adds hallucination nodes to graph", () => {
      chub.detectHallucinations('openai.ChatCompletion.create({ model: "gpt-5" })');
      const errors = graph.getNodesByType("error");
      expect(errors.some(e => e.name.includes("Stale API"))).toBe(true);
    });

    it("downgrades severity if chub doc was already fetched", () => {
      graph.addNode("tool:Bash", "Bash", "tool");
      chub.processBashCommand('chub get openai/chat --lang py', '');
      const recs = chub.detectHallucinations('openai.ChatCompletion.create()');
      expect(recs[0].type).toBe("warning"); // not critical
    });
  });

  describe("generateAutoAnnotations", () => {
    it("generates annotations from resolved errors", () => {
      // Create an error node that was resolved
      const errorNode = graph.addNode("error:test", "openai API error: deprecated", "error", {
        full_output: "openai.ChatCompletion.create is deprecated",
        resolved: true,
        resolution: "Use client.responses.create instead",
      });

      // Create a fix edge
      graph.addNode("fix:test", "fix applied", "pattern");
      graph.addEdge("fix:test", "error:test", "fixes", "resolved the error");

      const annotations = chub.generateAutoAnnotations();
      expect(annotations.length).toBeGreaterThan(0);
      expect(annotations[0].command).toContain("chub annotate");
      expect(annotations[0].docId).toBe("openai/chat");
    });

    it("returns empty when no resolved errors", () => {
      graph.addNode("error:unresolved", "some error", "error", { resolved: false });
      expect(chub.generateAutoAnnotations().length).toBe(0);
    });
  });

  describe("getRecommendations", () => {
    it("returns recommendations array", () => {
      const recs = chub.getRecommendations();
      expect(Array.isArray(recs)).toBe(true);
    });

    it("recommends fetching docs when stale APIs detected in session", () => {
      // Simulate a file with stale API
      graph.addNode("file:src/api.ts", "src/api.ts", "file", {
        content: "openai.ChatCompletion.create({ model: 'gpt-5' })",
      });

      const recs = chub.getRecommendations();
      const fetchRec = recs.find(r => r.id.startsWith("chub-fetch-"));
      expect(fetchRec).toBeDefined();
    });
  });
});

describe("Full integration: session with chub usage", () => {
  it("tracks a complete workflow: fetch docs → write code → detect issues → annotate", () => {
    graph.addNode("tool:Bash", "Bash", "tool");

    // 1. Agent fetches docs
    chub.processBashCommand('chub get stripe/api --lang js', 'stripe docs...');
    expect(graph.getNode("chub:stripe/api")).toBeDefined();

    // 2. Agent writes code (but uses stale API anyway)
    const hallRecs = chub.detectHallucinations('const charge = await stripe.Charge.create({ amount: 1000 })');
    expect(hallRecs.length).toBeGreaterThan(0);
    expect(hallRecs[0].type).toBe("warning"); // downgraded because docs were fetched

    // 3. Error detected and resolved
    const err = graph.addNode("error:stripe", "Stripe Charge API deprecated", "error", {
      full_output: "stripe.Charge.create is deprecated, use paymentIntents",
      resolved: true,
      resolution: "Switched to stripe.paymentIntents.create",
    });
    graph.addNode("fix:stripe", "Applied fix", "pattern");
    graph.addEdge("fix:stripe", "error:stripe", "fixes");

    // 4. Generate auto-annotations
    const annotations = chub.generateAutoAnnotations();
    expect(annotations.length).toBeGreaterThan(0);
    expect(annotations[0].docId).toBe("stripe/api");
    expect(annotations[0].command).toContain("chub annotate stripe/api");

    // 5. Graph should show the full story
    expect(graph.getNodesByType("skill").length).toBeGreaterThanOrEqual(1); // chub doc
    expect(graph.getNodesByType("error").length).toBeGreaterThanOrEqual(1); // stale API + error
    expect(graph.size.nodes).toBeGreaterThanOrEqual(5);
  });
});
