/**
 * OpenBrain Transformation Pipeline
 *
 * The AUTOPILOT engine. Takes raw thoughts and delivers agent-ready specs.
 * This is the "work", not the "tool" — per Sequoia's thesis.
 *
 * L1 (Thought) → L2 (Context Graph) → L3 (Intent) → L4 (Specification)
 */

import type {
  Thought, ContextGraph, Entity, Decision, OpenQuestion, Relationship,
  Intent, Constraint, Tradeoff, Stakeholder, Timeline,
  Specification, Phase, Task, AgentInstructions, QualityGate,
  PipelineResult, EntityType,
} from "../core/types.js";
import { generateId, estimateTokens, extractPatterns } from "./utils.js";

// ═══════════════════════════════════════
// STAGE 1: Thought → Context Graph (L1→L2)
// ═══════════════════════════════════════

export function extractContextGraph(thought: Thought): ContextGraph {
  const content = thought.content;
  const now = new Date().toISOString();

  const entities = extractEntities(content, now);
  const decisions = extractDecisions(content, now);
  const openQuestions = extractOpenQuestions(content);
  const patterns = extractPatterns(content);
  const errorResolutions = extractErrorResolutions(content);

  // Build relationships between entities
  linkEntities(entities, content);

  const entitySignal = Math.min(entities.length, 15) * 6;
  const decisionSignal = Math.min(decisions.length, 10) * 8;
  const questionPenalty = Math.min(openQuestions.length, 10) * 5;
  const patternBonus = patterns.length > 0 ? 5 : 0;
  const rawScore = entitySignal + decisionSignal - questionPenalty + patternBonus;
  const qualityScore = Math.min(100, Math.max(0, rawScore));

  return {
    entities,
    decisions,
    openQuestions,
    patterns,
    errorResolutions,
    metadata: {
      source: thought.source,
      processedAt: now,
      thoughtCount: 1,
      qualityScore: Math.min(100, Math.max(0, qualityScore)),
    },
  };
}

function extractEntities(text: string, now: string): Entity[] {
  const entities: Entity[] = [];
  const seen = new Set<string>();

  // People: "Sarah from Acme", "talked to John", "meeting with Maria"
  const personPatterns = [
    /(?:with|from|by|to|met|talked to|spoke with|emailed)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g,
    /([A-Z][a-z]+)\s+(?:said|mentioned|wants|suggested|agreed|decided|confirmed|asked)/g,
  ];
  for (const re of personPatterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const name = m[1].trim();
      if (!seen.has(name.toLowerCase()) && name.length > 2) {
        seen.add(name.toLowerCase());
        entities.push(makeEntity(name, "person", inferPersonContext(text, name), now));
      }
    }
  }

  // Organizations: "Acme Corp", "at Google", "for Microsoft"
  const orgRe = /(?:at|from|for|with|of)\s+([A-Z][a-z]+(?:\s+(?:Corp|Inc|LLC|Ltd|Co|Group|Labs|AI|Technologies|Systems|Solutions))?)/g;
  let m: RegExpExecArray | null;
  while ((m = orgRe.exec(text)) !== null) {
    const name = m[1].trim();
    if (!seen.has(name.toLowerCase()) && name.length > 3 && /Corp|Inc|LLC|Ltd|Co|Group|Labs/i.test(name)) {
      seen.add(name.toLowerCase());
      entities.push(makeEntity(name, "organization", "", now));
    }
  }

  // Technologies: common tech terms
  const techTerms = [
    "JWT", "OAuth", "REST", "GraphQL", "gRPC", "WebSocket",
    "PostgreSQL", "Postgres", "MongoDB", "Redis", "Supabase", "Firebase",
    "Express", "Next.js", "React", "Vue", "Angular", "Svelte",
    "Docker", "Kubernetes", "Terraform", "AWS", "GCP", "Azure",
    "TypeScript", "Python", "Rust", "Go", "Node.js",
    "bcrypt", "argon2", "CORS", "SSL", "TLS", "HTTPS",
    "CI/CD", "GitHub Actions", "Jenkins", "Vercel", "Netlify",
  ];
  for (const tech of techTerms) {
    if (text.includes(tech) && !seen.has(tech.toLowerCase())) {
      seen.add(tech.toLowerCase());
      entities.push(makeEntity(tech, "technology", "", now));
    }
  }

  // Projects: infer from task-oriented language
  const projectRe = /(?:migrate|build|implement|create|deploy|launch|ship)\s+(?:a\s+|the\s+|their\s+)?(.{5,50}?)(?:\.|,|$|\s+(?:by|for|with|using))/gi;
  projectRe.lastIndex = 0;
  while ((m = projectRe.exec(text)) !== null) {
    const name = m[1].trim().replace(/\s+/g, " ");
    if (name.length > 5 && name.length < 50 && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      entities.push(makeEntity(name, "project", "", now));
    }
  }

  // Numbers/metrics
  const metricRe = /(\d[\d,.]*\s*(?:K|k|M|users|employees|devs|developers|engineers|budget|revenue|ARR|MRR|\$|USD|EUR|GBP)[\w]*)/g;
  metricRe.lastIndex = 0;
  while ((m = metricRe.exec(text)) !== null) {
    const val = m[1].trim();
    if (!seen.has(val.toLowerCase())) {
      seen.add(val.toLowerCase());
      entities.push(makeEntity(val, "metric", "", now));
    }
  }

  return entities;
}

function inferPersonContext(text: string, name: string): string {
  // Try to find role/org context near the person's name
  const nameIdx = text.indexOf(name);
  if (nameIdx === -1) return "";
  const surrounding = text.substring(Math.max(0, nameIdx - 50), Math.min(text.length, nameIdx + name.length + 80));
  const roleRe = /(?:from|at|of)\s+([A-Z][\w\s]+?)(?:\.|,|$)/;
  const roleMatch = surrounding.match(roleRe);
  return roleMatch ? `from ${roleMatch[1].trim()}` : "";
}

function linkEntities(entities: Entity[], text: string): void {
  // Simple co-occurrence linking: entities mentioned in the same sentence are related
  const sentences = text.split(/[.!?\n]+/).map(s => s.trim()).filter(Boolean);
  for (const sentence of sentences) {
    const mentioned = entities.filter(e => sentence.toLowerCase().includes(e.name.toLowerCase()));
    for (let i = 0; i < mentioned.length; i++) {
      for (let j = i + 1; j < mentioned.length; j++) {
        const relType = inferRelType(mentioned[i].type, mentioned[j].type);
        mentioned[i].relationships.push({
          targetId: mentioned[j].id,
          targetName: mentioned[j].name,
          type: relType,
          context: sentence.slice(0, 100),
        });
      }
    }
  }
}

function inferRelType(a: EntityType, b: EntityType): string {
  if (a === "person" && b === "organization") return "works_at";
  if (a === "person" && b === "project") return "owns";
  if (a === "technology" && b === "project") return "used_in";
  if (a === "decision" && b === "project") return "affects";
  return "related_to";
}

function extractDecisions(text: string, now: string): Decision[] {
  const decisions: Decision[] = [];
  const patterns = [
    /(?:decided|choosing|going with|will use|using|switched to|chose|opted for|selected)\s+([^.\n]{10,120})(?:\.|$)/gi,
    /(?:instead of|rather than|not using)\s+([^.\n,]{10,80})(?:,|\.|$)/gi,
    /(?:we should|I think we should|she wants to|he wants to|they want to|plan to|going to)\s+([^.\n]{10,120})(?:\.|$)/gi,
    /(?:wants to|need to|have to)\s+([^.\n]{10,120})(?:\.|$)/gi,
  ];
  const seen = new Set<string>();

  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const desc = m[0].trim();
      const key = desc.slice(0, 40).toLowerCase();
      const isDuplicate = seen.has(key) || [...seen].some(existing =>
        existing.includes(key.slice(0, 25)) || key.includes(existing.slice(0, 25))
      );
      if (!isDuplicate && desc.length > 15) {
        seen.add(key);

        // Try to extract reasoning
        const idx = text.indexOf(desc);
        const after = text.substring(idx + desc.length, idx + desc.length + 150);
        const reasonMatch = after.match(/(?:because|since|due to|reason)\s+(.{10,100}?)(?:\.|$)/i);

        decisions.push({
          id: generateId("dec"),
          description: desc.slice(0, 200),
          reasoning: reasonMatch?.[1]?.trim() ?? "",
          alternatives: [],
          chosenOption: desc.slice(0, 100),
          decidedBy: "",
          timestamp: now,
          affectedEntities: [],
          status: "active",
        });
      }
    }
  }
  return decisions.slice(0, 15);
}

function extractOpenQuestions(text: string): OpenQuestion[] {
  const questions: OpenQuestion[] = [];

  // Explicit questions
  const questionRe = /(?:need to (?:check|verify|confirm|figure out|decide)|(?:not sure|unclear|TBD|unknown)\s+(?:if|whether|about))\s+(.{10,100}?)(?:\.|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = questionRe.exec(text)) !== null) {
    questions.push({
      id: generateId("q"),
      question: m[0].trim(),
      context: "",
      priority: "medium",
      blocksEntities: [],
    });
  }

  // Actual question marks
  const qMarkRe = /([^.!?\n]{10,100}\?)/g;
  while ((m = qMarkRe.exec(text)) !== null) {
    questions.push({
      id: generateId("q"),
      question: m[1].trim(),
      context: "",
      priority: "medium",
      blocksEntities: [],
    });
  }

  return questions.slice(0, 10);
}

function extractErrorResolutions(text: string): string[] {
  const resolutions: string[] = [];
  const re = /(?:fixed|resolved|solution was|the fix|root cause)\s+(.{10,120}?)(?:\.|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    resolutions.push(m[0].trim().slice(0, 150));
  }
  return [...new Set(resolutions)].slice(0, 10);
}

function makeEntity(name: string, type: EntityType, context: string, now: string): Entity {
  return {
    id: generateId("ent"),
    name, type, context,
    relationships: [],
    firstSeen: now,
    lastSeen: now,
    mentionCount: 1,
  };
}


// ═══════════════════════════════════════
// STAGE 2: Context Graph → Intent (L2→L3)
// ═══════════════════════════════════════

export function deriveIntent(ctx: ContextGraph, thought: Thought): Intent {
  // Infer primary goal from the strongest project entity + decisions
  const projects = ctx.entities.filter(e => e.type === "project");
  const goal = projects.length > 0
    ? `Complete: ${projects.map(p => p.name).join(", ")}`
    : ctx.decisions.length > 0
      ? `Execute decisions: ${ctx.decisions[0].description}`
      : "Advance current work based on captured context";

  // Extract constraints from entities and text
  const constraints: Constraint[] = [];

  // Budget constraints
  const budgetEntities = ctx.entities.filter(e => e.type === "metric" && /\$|budget|cost/i.test(e.name));
  for (const be of budgetEntities) {
    constraints.push({ type: "budget", description: be.name, severity: "hard", source: be.name });
  }

  // Timeline constraints
  const timeRe = /(?:by|deadline|due|before|Q[1-4]|within)\s+(.{5,40}?)(?:\.|,|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = timeRe.exec(thought.content)) !== null) {
    constraints.push({ type: "timeline", description: m[0].trim(), severity: "hard", source: "stated" });
  }

  // Team constraints
  const teamEntities = ctx.entities.filter(e => e.type === "metric" && /devs|developers|engineers|team/i.test(e.name));
  for (const te of teamEntities) {
    constraints.push({ type: "team", description: `Team capacity: ${te.name}`, severity: "soft", source: te.name });
  }

  // Technical constraints from decisions
  for (const dec of ctx.decisions) {
    constraints.push({ type: "technical", description: dec.description, severity: "soft", source: "decision" });
  }

  // Derive success criteria from entities + decisions
  const successCriteria = [
    ...ctx.decisions.map(d => `Implement: ${d.description}`),
    ...ctx.openQuestions.map(q => `Resolve: ${q.question}`),
  ].slice(0, 8);

  // Generate tradeoffs if enough context
  const tradeoffs: Tradeoff[] = [];
  if (projects.length > 0 && constraints.length >= 2) {
    tradeoffs.push({
      option: "Phased rollout (lower risk)",
      pros: ["Incremental validation", "Easier rollback", "Manageable scope per phase"],
      cons: ["Longer total timeline", "Temporary dual-system complexity"],
      risk: "low",
      fit: constraints.some(c => c.type === "team") ? "excellent" : "good",
      recommendation: "Recommended for constrained teams",
    });
    tradeoffs.push({
      option: "Big-bang implementation (faster)",
      pros: ["Single cutover", "No dual-system period", "Faster completion"],
      cons: ["Higher risk", "Harder to debug", "All-or-nothing"],
      risk: "high",
      fit: constraints.some(c => c.type === "team") ? "poor" : "acceptable",
      recommendation: "Only if team capacity allows and rollback is trivial",
    });
  }

  // Stakeholders from person entities
  const stakeholders: Stakeholder[] = ctx.entities
    .filter(e => e.type === "person")
    .map(e => ({
      name: e.name,
      role: e.context || "stakeholder",
      interests: [],
      influence: "influencer" as const,
    }));

  // Timeline from constraints
  const timelineConstraint = constraints.find(c => c.type === "timeline");
  const timeline: Timeline | undefined = timelineConstraint ? {
    deadline: timelineConstraint.description,
    milestones: [],
    estimatedWeeks: 8, // default estimate
  } : undefined;

  return { goal, constraints, successCriteria, tradeoffs, stakeholders, timeline };
}


// ═══════════════════════════════════════
// STAGE 3: Intent → Specification (L3→L4)
// ═══════════════════════════════════════

export function generateSpecification(intent: Intent, ctx: ContextGraph): Specification {
  const now = new Date().toISOString();
  const totalWeeks = intent.timeline?.estimatedWeeks ?? 8;
  const phaseCount = Math.max(2, Math.min(4, Math.ceil(totalWeeks / 3)));

  // Generate phases from decisions + entities
  const phases: Phase[] = [];
  const allTasks: Task[] = [];
  let taskCounter = 0;

  // Phase 1: Foundation
  const foundationTasks: Task[] = [];
  const techEntities = ctx.entities.filter(e => e.type === "technology");
  for (const tech of techEntities.slice(0, 4)) {
    const task: Task = {
      id: `task-${++taskCounter}`,
      description: `Set up and configure ${tech.name}`,
      type: "config",
      priority: "high",
      estimatedHours: 2,
      acceptanceCriteria: [`${tech.name} is installed, configured, and verified working`],
      blockedBy: [],
    };
    foundationTasks.push(task);
    allTasks.push(task);
  }

  for (const dec of ctx.decisions.slice(0, 3)) {
    const task: Task = {
      id: `task-${++taskCounter}`,
      description: `Implement decision: ${dec.description}`,
      type: "code",
      priority: "high",
      estimatedHours: 4,
      acceptanceCriteria: [`${dec.description} is implemented and tested`],
      blockedBy: foundationTasks.length > 0 ? [foundationTasks[0].id] : [],
    };
    foundationTasks.push(task);
    allTasks.push(task);
  }

  phases.push({
    name: `Phase 1: Foundation (Weeks 1-${Math.ceil(totalWeeks / phaseCount)})`,
    description: "Set up infrastructure, implement core decisions",
    estimatedDays: Math.ceil(totalWeeks / phaseCount) * 5,
    tasks: foundationTasks,
    dependencies: [],
    deliverables: foundationTasks.map(t => t.description),
  });

  // Phase 2: Core Implementation
  const coreTasks: Task[] = [];
  for (const criteria of intent.successCriteria.slice(0, 4)) {
    const task: Task = {
      id: `task-${++taskCounter}`,
      description: criteria,
      type: "code",
      priority: "medium",
      estimatedHours: 6,
      acceptanceCriteria: [criteria],
      blockedBy: [foundationTasks[foundationTasks.length - 1]?.id ?? ""].filter(Boolean),
    };
    coreTasks.push(task);
    allTasks.push(task);
  }

  const midWeek = Math.ceil(totalWeeks / phaseCount);
  phases.push({
    name: `Phase 2: Core Implementation (Weeks ${midWeek + 1}-${midWeek * 2})`,
    description: "Implement success criteria, address open questions",
    estimatedDays: midWeek * 5,
    tasks: coreTasks,
    dependencies: ["Phase 1"],
    deliverables: coreTasks.map(t => t.description),
  });

  // Phase 3: Testing & Validation
  const testTasks: Task[] = [];
  testTasks.push({
    id: `task-${++taskCounter}`,
    description: "Write integration tests for all implemented features",
    type: "test",
    priority: "high",
    estimatedHours: 8,
    acceptanceCriteria: ["All features have integration tests", "Test coverage > 80%"],
    blockedBy: coreTasks.map(t => t.id),
  });
  testTasks.push({
    id: `task-${++taskCounter}`,
    description: "Run load/stress tests against production-like environment",
    type: "test",
    priority: "medium",
    estimatedHours: 4,
    acceptanceCriteria: ["System handles expected load", "No critical errors under stress"],
    blockedBy: [testTasks[0].id],
  });
  testTasks.push({
    id: `task-${++taskCounter}`,
    description: "Documentation and handoff preparation",
    type: "document",
    priority: "medium",
    estimatedHours: 4,
    acceptanceCriteria: ["README updated", "API docs generated", "Runbook created"],
    blockedBy: [],
  });
  allTasks.push(...testTasks);

  phases.push({
    name: `Phase 3: Testing & Launch (Weeks ${midWeek * 2 + 1}-${totalWeeks})`,
    description: "Validate, test, and prepare for deployment",
    estimatedDays: (totalWeeks - midWeek * 2) * 5,
    tasks: testTasks,
    dependencies: ["Phase 2"],
    deliverables: ["Test suite", "Load test results", "Documentation"],
  });

  // Agent instructions
  const agentInstructions: AgentInstructions = {
    executionOrder: "sequential",
    commitStrategy: "Commit after each passing test suite. Use conventional commits.",
    testingRequirements: "Run full test suite after each task. Do not proceed if tests fail.",
    escalationRules: [
      "If a task is blocked for > 30 minutes, document the blocker and skip to next non-blocked task",
      "If tests fail after 3 fix attempts, flag for human review",
      ...ctx.errorResolutions.map(e => `KNOWN FIX: ${e}`),
    ],
    doNotModify: [
      ...ctx.patterns.map(p => `Pattern: ${p}`),
    ],
    contextToPreserve: [
      ...ctx.decisions.map(d => `Decision: ${d.description}`),
      ...ctx.entities.filter(e => e.type === "constraint").map(e => `Constraint: ${e.name}`),
    ],
  };

  // Quality gates
  const qualityGates: QualityGate[] = [
    { name: "Tests pass", check: "All tests green", threshold: "100%", failAction: "block" },
    { name: "No regressions", check: "No existing tests broken", threshold: "0 failures", failAction: "block" },
    { name: "Lint clean", check: "No lint errors", threshold: "0 errors", failAction: "warn" },
  ];

  return {
    title: intent.goal,
    version: "1.0.0",
    generatedAt: now,
    phases,
    agentInstructions,
    acceptanceCriteria: intent.successCriteria,
    rollbackPlan: "Revert to last known-good commit. All changes are behind feature flags where applicable.",
    qualityGates,
  };
}


// ═══════════════════════════════════════
// FULL PIPELINE: Thought → Spec
// ═══════════════════════════════════════

export function runPipeline(thought: Thought): PipelineResult {
  const start = Date.now();

  const context = extractContextGraph(thought);
  const intent = deriveIntent(context, thought);
  const specification = generateSpecification(intent, context);

  const rawTokens = estimateTokens(thought.content);
  const specTokens = estimateTokens(JSON.stringify(specification));

  return {
    input: thought,
    context,
    intent,
    specification,
    qualityScore: context.metadata.qualityScore,
    processingTime: Date.now() - start,
    tokensSaved: Math.max(0, rawTokens * 3 - specTokens), // 3x = re-explanation factor
  };
}
