/**
 * OpenBrain Core Types
 *
 * The data model follows the AI Skill Hierarchy:
 *   Thought (L1) → Context (L2) → Intent (L3) → Spec (L4)
 *
 * Every type is designed for AGENT readability, not human readability.
 * Structured data with explicit relationships, not prose.
 */

// ═══════════════════════════════════════
// L1: Raw Thought (Input)
// ═══════════════════════════════════════

export interface Thought {
  id: string;
  content: string;
  source: ThoughtSource;
  timestamp: string;
  tags: string[];
  metadata: Record<string, string>;
}

export type ThoughtSource =
  | "meeting_notes"
  | "slack_message"
  | "voice_memo"
  | "manual_entry"
  | "email"
  | "document"
  | "code_comment"
  | "chat_history";

// ═══════════════════════════════════════
// L2: Structured Context (Open Brain)
// ═══════════════════════════════════════

export interface Entity {
  id: string;
  name: string;
  type: EntityType;
  context: string;
  relationships: Relationship[];
  firstSeen: string;
  lastSeen: string;
  mentionCount: number;
}

export type EntityType =
  | "person"
  | "organization"
  | "project"
  | "technology"
  | "file"
  | "concept"
  | "decision"
  | "constraint"
  | "metric";

export interface Relationship {
  targetId: string;
  targetName: string;
  type: string; // "works_at", "owns", "depends_on", "decided_by", "blocked_by"
  context: string;
}

export interface Decision {
  id: string;
  description: string;
  reasoning: string;
  alternatives: string[];
  chosenOption: string;
  decidedBy: string;
  timestamp: string;
  affectedEntities: string[];
  status: "active" | "superseded" | "reversed";
}

export interface OpenQuestion {
  id: string;
  question: string;
  context: string;
  priority: "critical" | "high" | "medium" | "low";
  assignedTo?: string;
  blocksEntities: string[];
}

export interface ContextGraph {
  entities: Entity[];
  decisions: Decision[];
  openQuestions: OpenQuestion[];
  patterns: string[];
  errorResolutions: string[];
  metadata: {
    source: string;
    processedAt: string;
    thoughtCount: number;
    qualityScore: number;
  };
}

// ═══════════════════════════════════════
// L3: Intent Alignment
// ═══════════════════════════════════════

export interface Intent {
  goal: string;
  constraints: Constraint[];
  successCriteria: string[];
  tradeoffs: Tradeoff[];
  stakeholders: Stakeholder[];
  timeline?: Timeline;
}

export interface Constraint {
  type: "budget" | "timeline" | "technical" | "team" | "regulatory" | "dependency";
  description: string;
  severity: "hard" | "soft";
  source: string; // entity ID or name that imposed this
}

export interface Tradeoff {
  option: string;
  pros: string[];
  cons: string[];
  risk: "low" | "medium" | "high";
  fit: "poor" | "acceptable" | "good" | "excellent";
  recommendation: string;
}

export interface Stakeholder {
  name: string;
  role: string;
  interests: string[];
  influence: "decision_maker" | "influencer" | "informed";
}

export interface Timeline {
  deadline?: string;
  milestones: Array<{ name: string; date: string; description: string }>;
  estimatedWeeks: number;
}

// ═══════════════════════════════════════
// L4: Agent-Ready Specification
// ═══════════════════════════════════════

export interface Specification {
  title: string;
  version: string;
  generatedAt: string;
  phases: Phase[];
  agentInstructions: AgentInstructions;
  acceptanceCriteria: string[];
  rollbackPlan: string;
  qualityGates: QualityGate[];
}

export interface Phase {
  name: string;
  description: string;
  estimatedDays: number;
  tasks: Task[];
  dependencies: string[]; // phase names this depends on
  deliverables: string[];
}

export interface Task {
  id: string;
  description: string;
  type: "code" | "config" | "test" | "review" | "deploy" | "research" | "document";
  priority: "critical" | "high" | "medium" | "low";
  estimatedHours: number;
  acceptanceCriteria: string[];
  blockedBy: string[]; // task IDs
}

export interface AgentInstructions {
  executionOrder: string; // "sequential" | "parallel_where_safe"
  commitStrategy: string;
  testingRequirements: string;
  escalationRules: string[];
  doNotModify: string[];
  contextToPreserve: string[];
}

export interface QualityGate {
  name: string;
  check: string;
  threshold: string;
  failAction: "block" | "warn" | "log";
}

// ═══════════════════════════════════════
// Pipeline Result (Full Transformation)
// ═══════════════════════════════════════

export interface PipelineResult {
  input: Thought;
  context: ContextGraph;
  intent: Intent;
  specification: Specification;
  qualityScore: number;
  processingTime: number;
  tokensSaved: number; // vs raw prompt approach
}

// ═══════════════════════════════════════
// MCP Protocol Types
// ═══════════════════════════════════════

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface MCPToolCall {
  tool: string;
  arguments: Record<string, unknown>;
}

export interface MCPToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

// ═══════════════════════════════════════
// Database Schema (Supabase/Postgres)
// ═══════════════════════════════════════

export interface ThoughtRow {
  id: string;
  content: string;
  source: string;
  tags: string[];
  metadata: Record<string, string>;
  embedding: number[] | null;
  created_at: string;
}

export interface EntityRow {
  id: string;
  name: string;
  type: string;
  context: string;
  relationships: Relationship[];
  mention_count: number;
  first_seen: string;
  last_seen: string;
  embedding: number[] | null;
}

export interface DecisionRow {
  id: string;
  description: string;
  reasoning: string;
  chosen_option: string;
  alternatives: string[];
  decided_by: string;
  affected_entities: string[];
  status: string;
  created_at: string;
}
