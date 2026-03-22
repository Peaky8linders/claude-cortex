// ── Severity & Issue Cause Enums ──

export enum Severity {
  CRITICAL = "critical",
  HIGH = "high",
  MEDIUM = "medium",
  LOW = "low",
  INFO = "info",
}

export enum IssueCause {
  // Semantic Relevance
  IRRELEVANT_SEGMENT = "irrelevant_segment",
  LOW_QUERY_ALIGNMENT = "low_query_alignment",
  TOPIC_DRIFT = "topic_drift",
  SEMANTIC_MISMATCH = "semantic_mismatch",
  // Redundancy
  DUPLICATE_CONTENT = "duplicate_content",
  NEAR_DUPLICATE = "near_duplicate",
  PARAPHRASED_REPETITION = "paraphrased_repetition",
  BOILERPLATE_REPETITION = "boilerplate_repetition",
  // Distractors
  TOPICAL_DISTRACTOR = "topical_distractor",
  MISLEADING_SIMILAR_TERMS = "misleading_similar_terms",
  CONTRADICTORY_INFORMATION = "contradictory_information",
  STALE_INFORMATION = "stale_information",
  // Density
  VERBOSE_PADDING = "verbose_padding",
  LOW_SIGNAL_RATIO = "low_signal_ratio",
  EXCESSIVE_FORMATTING = "excessive_formatting",
  FILLER_CONTENT = "filler_content",
  // Fragmentation
  BROKEN_REFERENCES = "broken_references",
  INCOMPLETE_CONTEXT = "incomplete_context",
  ORPHANED_ENTITIES = "orphaned_entities",
  MISSING_RELATIONSHIP_CONTEXT = "missing_relationship_context",
  // Structure
  NO_SECTION_BOUNDARIES = "no_section_boundaries",
  MIXED_CONTENT_TYPES = "mixed_content_types",
  POOR_ORDERING = "poor_ordering",
  MISSING_METADATA = "missing_metadata",
  // Economics
  OVERSIZED_CONTEXT = "oversized_context",
  ATTENTION_BUDGET_EXCEEDED = "attention_budget_exceeded",
  HIGH_COST_LOW_SIGNAL = "high_cost_low_signal",
  CACHEABLE_CONTENT_NOT_CACHED = "cacheable_content_not_cached",
}

// ── Cause Catalog ──

export interface CauseCatalogEntry {
  description: string;
  fix: string;
  category: string;
}

export const CAUSE_CATALOG: Record<IssueCause, CauseCatalogEntry> = {
  [IssueCause.IRRELEVANT_SEGMENT]: {
    description: "Segment has no semantic connection to the query or task.",
    fix: "Remove low-relevance segments. Use query-aware retrieval to filter before injection.",
    category: "semantic_relevance",
  },
  [IssueCause.LOW_QUERY_ALIGNMENT]: {
    description: "Weak alignment with the query — model works harder to find signal.",
    fix: "Re-rank documents by query similarity. Use a cross-encoder reranker.",
    category: "semantic_relevance",
  },
  [IssueCause.TOPIC_DRIFT]: {
    description: "Context drifts from core topic, diluting attention.",
    fix: "Truncate or summarize segments where topic similarity drops below threshold.",
    category: "semantic_relevance",
  },
  [IssueCause.SEMANTIC_MISMATCH]: {
    description: "Retrieved content is from the wrong semantic domain.",
    fix: "Add domain disambiguation to retrieval. Use few-shot classification to filter.",
    category: "semantic_relevance",
  },
  [IssueCause.DUPLICATE_CONTENT]: {
    description: "Identical text appears multiple times, wasting tokens.",
    fix: "Deduplicate at retrieval time using content hashing.",
    category: "redundancy",
  },
  [IssueCause.NEAR_DUPLICATE]: {
    description: "Multiple passages convey the same info with minor wording changes.",
    fix: "Use MinHash for fuzzy deduplication. Keep the highest-quality version.",
    category: "redundancy",
  },
  [IssueCause.PARAPHRASED_REPETITION]: {
    description: "Same fact expressed in different words across segments.",
    fix: "Cluster semantically similar passages; select one representative each.",
    category: "redundancy",
  },
  [IssueCause.BOILERPLATE_REPETITION]: {
    description: "Headers, footers, or disclaimers repeated across documents.",
    fix: "Strip boilerplate before injection. Build a blocklist of recurring patterns.",
    category: "redundancy",
  },
  [IssueCause.TOPICAL_DISTRACTOR]: {
    description: "Topically related but doesn't answer the query — #1 cause of context rot.",
    fix: "Score passages by likelihood of containing the answer, not just topic similarity.",
    category: "distractors",
  },
  [IssueCause.MISLEADING_SIMILAR_TERMS]: {
    description: "Lexically similar but semantically different terms create confusion.",
    fix: "Apply named entity disambiguation. Use sense-aware embeddings.",
    category: "distractors",
  },
  [IssueCause.CONTRADICTORY_INFORMATION]: {
    description: "Conflicting facts force stochastic resolution.",
    fix: "Implement contradiction detection. Flag conflicts with timestamps and source authority.",
    category: "distractors",
  },
  [IssueCause.STALE_INFORMATION]: {
    description: "Outdated information may conflict with current data.",
    fix: "Add timestamp metadata. Implement recency-weighted retrieval.",
    category: "distractors",
  },
  [IssueCause.VERBOSE_PADDING]: {
    description: "Excessive qualifiers and hedging consume tokens without meaning.",
    fix: "Apply extractive compression: distill to key claims before injection.",
    category: "density",
  },
  [IssueCause.LOW_SIGNAL_RATIO]: {
    description: "Too much noise, too little information per token.",
    fix: "Score sentences by information density. Remove those below threshold.",
    category: "density",
  },
  [IssueCause.EXCESSIVE_FORMATTING]: {
    description: "Markdown, HTML, or delimiters consume tokens without semantic value.",
    fix: "Strip non-essential formatting. Convert to minimal LLM-friendly text.",
    category: "density",
  },
  [IssueCause.FILLER_CONTENT]: {
    description: "Transitional phrases and meta-commentary waste context budget.",
    fix: "Build a filler-phrase blocklist and strip matches.",
    category: "density",
  },
  [IssueCause.BROKEN_REFERENCES]: {
    description: "References point to content not in the context window.",
    fix: "Detect references and either resolve them or remove referring passages.",
    category: "fragmentation",
  },
  [IssueCause.INCOMPLETE_CONTEXT]: {
    description: "Topic introduced but not developed — enough to confuse, not enough to reason.",
    fix: "Verify each topic has sufficient supporting context. Expand or remove.",
    category: "fragmentation",
  },
  [IssueCause.ORPHANED_ENTITIES]: {
    description: "Named entities appear without context for what they refer to.",
    fix: "Add brief entity descriptions or remove undefined references.",
    category: "fragmentation",
  },
  [IssueCause.MISSING_RELATIONSHIP_CONTEXT]: {
    description: "Facts about entities but no relationships between them.",
    fix: "Use knowledge graph subgraphs to encode entity relationships explicitly.",
    category: "fragmentation",
  },
  [IssueCause.NO_SECTION_BOUNDARIES]: {
    description: "Single text block with no structural markers between content types.",
    fix: "Add section delimiters: [SYSTEM], [RETRIEVED], [HISTORY], [TOOLS].",
    category: "structure",
  },
  [IssueCause.MIXED_CONTENT_TYPES]: {
    description: "Instructions, data, and conversation interleaved without separation.",
    fix: "Reorganize into typed sections. Models attend better to structured context.",
    category: "structure",
  },
  [IssueCause.POOR_ORDERING]: {
    description: "Most relevant content buried in the middle (lost-in-the-middle effect).",
    fix: "Place most relevant info at start and end of context window.",
    category: "structure",
  },
  [IssueCause.MISSING_METADATA]: {
    description: "Segments lack source attribution, timestamps, or confidence.",
    fix: "Prepend metadata headers: [Source: X | Date: Y | Confidence: Z].",
    category: "structure",
  },
  [IssueCause.OVERSIZED_CONTEXT]: {
    description: "Total tokens exceed effective attention capacity, triggering context rot.",
    fix: "Reduce to 30-50% of marketed capacity. Use progressive summarization.",
    category: "economics",
  },
  [IssueCause.ATTENTION_BUDGET_EXCEEDED]: {
    description: "n² attention computation exceeds practical attention budget.",
    fix: "Break into sub-agent calls with focused windows. Return distilled summaries.",
    category: "economics",
  },
  [IssueCause.HIGH_COST_LOW_SIGNAL]: {
    description: "Poor cost-to-quality ratio — tokens far exceed information carried.",
    fix: "Apply graph-based retrieval (80% token reduction). Use structured context.",
    category: "economics",
  },
  [IssueCause.CACHEABLE_CONTENT_NOT_CACHED]: {
    description: "Static content re-sent every request instead of using prompt caching.",
    fix: "Enable prompt caching for static components (90% cost savings).",
    category: "economics",
  },
};

// ── Result Types ──

export interface ContextIssue {
  cause: IssueCause;
  severity: Severity;
  description: string;
  fix: string;
  category: string;
  affectedSegments: number[];
  estimatedImprovement: number;
  estimatedTokenSavings: number;
  evidence: string;
}

export interface DimensionScore {
  name: string;
  score: number;
  weight: number;
  issues: ContextIssue[];
}

export interface TokenEconomics {
  totalTokens: number;
  usefulTokens: number;
  wastedTokens: number;
  wastePercentage: number;
  estimatedCost: number;
  wastedCost: number;
}

export interface ScoreResult {
  score: number;
  grade: string;
  dimensions: Record<string, DimensionScore>;
  issues: ContextIssue[];
  economics: TokenEconomics;
  contextLength: number;
  segmentCount: number;
  summary: string;
}

// ── Snapshot Types (Product 2) ──

export interface SnapshotDecision {
  description: string;
  reasoning: string;
  affectedFiles: string[];
  timestamp: string;
}

export interface SnapshotEntity {
  name: string;
  type: string; // file, function, variable, class, config, pattern
  context: string;
  lastMentionedTurn: number;
}

export interface ContextSnapshot {
  sessionId: string;
  timestamp: string;
  turnCount: number;
  tokenCount: number;
  qualityScore: number;
  decisions: SnapshotDecision[];
  entities: SnapshotEntity[];
  activeFiles: string[];
  patterns: string[];
  errorResolutions: string[];
  currentTask: string;
  compactInstructions: string;
}

// ── Factory ──

export function createIssue(
  cause: IssueCause,
  severity: Severity,
  opts: Partial<Pick<ContextIssue, "affectedSegments" | "estimatedImprovement" | "estimatedTokenSavings" | "evidence">> = {},
): ContextIssue {
  const entry = CAUSE_CATALOG[cause];
  return {
    cause,
    severity,
    description: entry.description,
    fix: entry.fix,
    category: entry.category,
    affectedSegments: opts.affectedSegments ?? [],
    estimatedImprovement: opts.estimatedImprovement ?? 0,
    estimatedTokenSavings: opts.estimatedTokenSavings ?? 0,
    evidence: opts.evidence ?? "",
  };
}
