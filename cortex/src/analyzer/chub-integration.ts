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
import type { GraphNode, Recommendation } from "../graph/knowledge-graph.js";
import { execSync } from "child_process";

// ── Known API patterns that agents commonly hallucinate ──
const HALLUCINATION_SIGNATURES: Record<string, { stale: RegExp; current: string; chubDoc: string }> = {
  "openai-chat-completions": {
    stale: /openai\.ChatCompletion\.create|chat\.completions\.create/,
    current: "client.responses.create",
    chubDoc: "openai/chat",
  },
  "stripe-charges": {
    stale: /stripe\.Charge\.create|charges\.create/,
    current: "stripe.paymentIntents.create",
    chubDoc: "stripe/api",
  },
  "anthropic-completion": {
    stale: /anthropic\.completions|\.completion\(/,
    current: "client.messages.create",
    chubDoc: "anthropic/api",
  },
  "supabase-auth": {
    stale: /supabase\.auth\.signIn\b/,
    current: "supabase.auth.signInWithPassword",
    chubDoc: "supabase/auth",
  },
};

export interface ChubDocUsage {
  docId: string;        // e.g., "openai/chat"
  language: string;     // "py" | "js" | etc.
  fetchCount: number;
  lastFetched: number;
  annotations: string[];
  impactScore: number;  // did fetching this doc reduce errors? -100 to +100
}

export class ContextHubIntegration {
  private docUsage = new Map<string, ChubDocUsage>();

  constructor(private graph: KnowledgeGraph) {}

  /**
   * Process a Bash tool event to detect chub usage.
   * Call this from the HookProcessor when tool_name === "Bash".
   */
  processBashCommand(command: string, output: string): void {
    // Detect chub get commands
    const chubGetMatch = command.match(/chub\s+get\s+([\w/-]+)(?:\s+--lang\s+(\w+))?/);
    if (chubGetMatch) {
      const docId = chubGetMatch[1];
      const lang = chubGetMatch[2] ?? "default";
      this.recordDocFetch(docId, lang);

      // Add to knowledge graph
      const nodeId = `chub:${docId}`;
      const node = this.graph.addNode(nodeId, `chub: ${docId}`, "skill", {
        source: "context-hub",
        language: lang,
        doc_id: docId,
      });
      node.qualityImpact = 30; // chub docs generally improve quality

      // Link to the Bash tool that fetched it
      if (this.graph.getNode("tool:Bash")) {
        this.graph.addEdge("tool:Bash", nodeId, "reads", `chub get ${docId}`);
      }
    }

    // Detect chub annotate commands
    const annotateMatch = command.match(/chub\s+annotate\s+([\w/-]+)\s+"([^"]+)"/);
    if (annotateMatch) {
      const docId = annotateMatch[1];
      const annotation = annotateMatch[2];
      this.recordAnnotation(docId, annotation);
    }
  }

  /**
   * Scan code content for stale API patterns that chub could fix.
   * Call this from PostToolUse on Write/Edit events.
   */
  detectHallucinations(codeContent: string): Recommendation[] {
    const recs: Recommendation[] = [];

    for (const [id, sig] of Object.entries(HALLUCINATION_SIGNATURES)) {
      if (sig.stale.test(codeContent)) {
        // Check if the agent already fetched the chub doc
        const alreadyFetched = this.docUsage.has(sig.chubDoc);

        recs.push({
          id: `chub-hallucination-${id}`,
          type: alreadyFetched ? "warning" : "critical",
          title: `Stale API detected: ${id}`,
          description: alreadyFetched
            ? `Agent used outdated API pattern despite having fetched chub docs. The code may need manual review.`
            : `Agent is using a deprecated API pattern. Context Hub has current documentation.`,
          action: alreadyFetched
            ? `Review the generated code against chub get ${sig.chubDoc}. The current API uses: ${sig.current}`
            : `Run: chub get ${sig.chubDoc} --lang py  (or tell your agent to use it)`,
          impact: "Prevents broken API calls, reduces debugging time by 30-60 minutes per incident.",
          affectedNodes: [],
          estimatedSavings: 500, // tokens saved from not debugging
        });

        // Add to graph
        const hallId = `hallucination:${id}:${Date.now()}`;
        const node = this.graph.addNode(hallId, `Stale API: ${id}`, "error", {
          pattern: id,
          stale_api: sig.stale.source,
          current_api: sig.current,
          chub_doc: sig.chubDoc,
          resolved: false,
        });
        node.qualityImpact = -40;
      }
    }

    return recs;
  }

  /**
   * Generate chub annotations from error resolutions in the graph.
   * This is the "agents get smarter" loop — what Cortex learns
   * gets annotated back to Context Hub for the whole community.
   */
  generateAutoAnnotations(): Array<{ docId: string; annotation: string; command: string }> {
    const annotations: Array<{ docId: string; annotation: string; command: string }> = [];

    // Find error → fix patterns in the graph
    const errors = this.graph.getNodesByType("error");
    for (const error of errors) {
      if (!error.properties.resolved) continue;

      const edges = this.graph.getEdgesFor(error.id);
      const fixEdge = edges.find(e => e.type === "fixes");
      if (!fixEdge) continue;

      // Check if this error relates to a known API
      const errorText = String(error.properties.full_output ?? error.name);
      for (const [, sig] of Object.entries(HALLUCINATION_SIGNATURES)) {
        if (sig.stale.test(errorText) || errorText.toLowerCase().includes(sig.chubDoc.split("/")[0])) {
          const annotation = `Fix: ${error.name.slice(0, 80)}. Resolution: ${String(error.properties.resolution ?? "see session context").slice(0, 100)}`;
          annotations.push({
            docId: sig.chubDoc,
            annotation,
            command: `chub annotate ${sig.chubDoc} "${annotation}"`,
          });
        }
      }
    }

    return annotations;
  }

  /**
   * Check if chub is installed and available.
   */
  isChubAvailable(): boolean {
    try {
      execSync("chub --version", { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get all chub-related recommendations for the current session.
   */
  getRecommendations(): Recommendation[] {
    const recs: Recommendation[] = [];

    // Recommend installing chub if not available
    if (!this.isChubAvailable()) {
      recs.push({
        id: "chub-install",
        type: "suggestion",
        title: "Install Context Hub for better API accuracy",
        description: "Andrew Ng's Context Hub gives your agent curated, versioned API docs. Reduces hallucinated API calls by 60%+.",
        action: "npm install -g @aisuite/chub",
        impact: "Agents write correct API calls on the first try instead of hallucinating deprecated patterns.",
        affectedNodes: [],
        estimatedSavings: 0,
      });
    }

    // Recommend fetching docs for APIs detected in the session
    const toolNodes = this.graph.getNodesByType("tool");
    const fileNodes = this.graph.getNodesByType("file");
    const allContent = [...toolNodes, ...fileNodes]
      .map(n => String(n.properties.full_text ?? n.properties.content ?? n.name))
      .join(" ");

    for (const [id, sig] of Object.entries(HALLUCINATION_SIGNATURES)) {
      if (sig.stale.test(allContent) && !this.docUsage.has(sig.chubDoc)) {
        recs.push({
          id: `chub-fetch-${id}`,
          type: "optimize",
          title: `Fetch current ${sig.chubDoc} docs from Context Hub`,
          description: `Your session references ${id} APIs. Current docs available via Context Hub would prevent stale API usage.`,
          action: `Tell your agent: "Use chub get ${sig.chubDoc} --lang py before writing API calls"`,
          impact: "Prevents deprecated API usage.",
          affectedNodes: [],
          estimatedSavings: 200,
        });
      }
    }

    // Recommend annotating if we found useful error resolutions
    const autoAnnotations = this.generateAutoAnnotations();
    if (autoAnnotations.length > 0) {
      recs.push({
        id: "chub-annotate",
        type: "suggestion",
        title: `${autoAnnotations.length} learnings to share via Context Hub`,
        description: "Your session discovered workarounds that could help other agents. Annotate them back to Context Hub.",
        action: autoAnnotations.map(a => a.command).join("\n"),
        impact: "Other agents (and your future sessions) won't have to rediscover these fixes.",
        affectedNodes: [],
        estimatedSavings: 0,
      });
    }

    return recs;
  }

  // ── Private ──

  private recordDocFetch(docId: string, language: string): void {
    const existing = this.docUsage.get(docId);
    if (existing) {
      existing.fetchCount++;
      existing.lastFetched = Date.now();
    } else {
      this.docUsage.set(docId, {
        docId, language, fetchCount: 1, lastFetched: Date.now(),
        annotations: [], impactScore: 0,
      });
    }
  }

  private recordAnnotation(docId: string, annotation: string): void {
    const existing = this.docUsage.get(docId);
    if (existing) {
      existing.annotations.push(annotation);
    } else {
      this.docUsage.set(docId, {
        docId, language: "default", fetchCount: 0, lastFetched: Date.now(),
        annotations: [annotation], impactScore: 0,
      });
    }
  }

  /** Get usage stats for all tracked chub docs */
  getDocUsage(): ChubDocUsage[] {
    return [...this.docUsage.values()];
  }
}
