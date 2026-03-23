"""
Data models for ContextScore.

Defines all types used across the scoring, analysis, and remediation pipeline.
"""

from __future__ import annotations

import enum
from dataclasses import dataclass, field
from typing import Optional


class Severity(enum.Enum):
    """Issue severity levels."""
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"


class IssueCause(enum.Enum):
    """
    Enumeration of all diagnosable context quality issues.

    Each cause maps to a specific, actionable root problem with a known fix.
    Organized by the analyzer that detects them.
    """

    # ── Semantic Relevance Issues ──
    IRRELEVANT_SEGMENT = "irrelevant_segment"
    LOW_QUERY_ALIGNMENT = "low_query_alignment"
    TOPIC_DRIFT = "topic_drift"
    SEMANTIC_MISMATCH = "semantic_mismatch"

    # ── Redundancy Issues ──
    DUPLICATE_CONTENT = "duplicate_content"
    NEAR_DUPLICATE = "near_duplicate"
    PARAPHRASED_REPETITION = "paraphrased_repetition"
    BOILERPLATE_REPETITION = "boilerplate_repetition"

    # ── Distractor Issues ──
    TOPICAL_DISTRACTOR = "topical_distractor"
    MISLEADING_SIMILAR_TERMS = "misleading_similar_terms"
    CONTRADICTORY_INFORMATION = "contradictory_information"
    STALE_INFORMATION = "stale_information"

    # ── Information Density Issues ──
    VERBOSE_PADDING = "verbose_padding"
    LOW_SIGNAL_RATIO = "low_signal_ratio"
    EXCESSIVE_FORMATTING = "excessive_formatting"
    FILLER_CONTENT = "filler_content"

    # ── Fragmentation Issues ──
    BROKEN_REFERENCES = "broken_references"
    INCOMPLETE_CONTEXT = "incomplete_context"
    ORPHANED_ENTITIES = "orphaned_entities"
    MISSING_RELATIONSHIP_CONTEXT = "missing_relationship_context"

    # ── Structural Issues ──
    NO_SECTION_BOUNDARIES = "no_section_boundaries"
    MIXED_CONTENT_TYPES = "mixed_content_types"
    POOR_ORDERING = "poor_ordering"
    MISSING_METADATA = "missing_metadata"

    # ── Token Economics Issues ──
    OVERSIZED_CONTEXT = "oversized_context"
    ATTENTION_BUDGET_EXCEEDED = "attention_budget_exceeded"
    HIGH_COST_LOW_SIGNAL = "high_cost_low_signal"
    CACHEABLE_CONTENT_NOT_CACHED = "cacheable_content_not_cached"


# ── Cause → Description + Fix mapping ──

CAUSE_CATALOG: dict[IssueCause, dict] = {
    # Semantic Relevance
    IssueCause.IRRELEVANT_SEGMENT: {
        "description": "One or more context segments have no semantic connection to the query or task.",
        "fix": "Remove segments with relevance score below threshold. Use query-aware retrieval to filter before injection.",
        "category": "semantic_relevance",
    },
    IssueCause.LOW_QUERY_ALIGNMENT: {
        "description": "The context as a whole has weak alignment with the current query, meaning the model must work harder to find relevant signal.",
        "fix": "Re-rank retrieved documents by query similarity. Use a cross-encoder reranker to surface the most relevant passages first.",
        "category": "semantic_relevance",
    },
    IssueCause.TOPIC_DRIFT: {
        "description": "Context progressively drifts away from the core topic, introducing tangential information that dilutes attention.",
        "fix": "Implement topic coherence checking. Truncate or summarize segments where topic similarity drops below a rolling threshold.",
        "category": "semantic_relevance",
    },
    IssueCause.SEMANTIC_MISMATCH: {
        "description": "Retrieved content is from the wrong semantic domain (e.g., 'bank' as riverbank vs. financial institution).",
        "fix": "Add domain disambiguation to your retrieval pipeline. Use few-shot classification to filter by intended domain before injection.",
        "category": "semantic_relevance",
    },

    # Redundancy
    IssueCause.DUPLICATE_CONTENT: {
        "description": "Identical or near-identical text appears multiple times, wasting tokens without adding information.",
        "fix": "Deduplicate at retrieval time using content hashing. Remove exact duplicates before context assembly.",
        "category": "redundancy",
    },
    IssueCause.NEAR_DUPLICATE: {
        "description": "Multiple passages convey the same information with minor wording differences.",
        "fix": "Use MinHash or SimHash for fuzzy deduplication. Keep the highest-quality version and discard variants.",
        "category": "redundancy",
    },
    IssueCause.PARAPHRASED_REPETITION: {
        "description": "The same fact or instruction is expressed in different words across multiple segments.",
        "fix": "Cluster semantically similar passages and select a single representative from each cluster.",
        "category": "redundancy",
    },
    IssueCause.BOILERPLATE_REPETITION: {
        "description": "Headers, footers, disclaimers, or standard boilerplate text appears repeatedly across retrieved documents.",
        "fix": "Strip boilerplate before injection. Build a blocklist of recurring non-informative patterns specific to your document corpus.",
        "category": "redundancy",
    },

    # Distractors
    IssueCause.TOPICAL_DISTRACTOR: {
        "description": "Content is topically related but does not answer the query — the #1 cause of context rot per Chroma (2025).",
        "fix": "Use answer-aware retrieval: score passages not just by topic similarity but by likelihood of containing the answer. Fine-tune a passage reranker on your domain.",
        "category": "distractors",
    },
    IssueCause.MISLEADING_SIMILAR_TERMS: {
        "description": "Content contains terms that are lexically similar to query terms but semantically different, creating confusion.",
        "fix": "Apply named entity disambiguation. Use sense-aware embeddings or add explicit disambiguation context.",
        "category": "distractors",
    },
    IssueCause.CONTRADICTORY_INFORMATION: {
        "description": "Multiple context segments contain conflicting facts, forcing the model to resolve contradictions stochastically.",
        "fix": "Implement contradiction detection in your retrieval pipeline. Flag conflicts and either resolve them or present them explicitly with timestamps and source authority rankings.",
        "category": "distractors",
    },
    IssueCause.STALE_INFORMATION: {
        "description": "Context includes outdated information that may conflict with more recent data.",
        "fix": "Add timestamp metadata to all context segments. Implement recency-weighted retrieval. Flag or exclude content older than a configurable freshness threshold.",
        "category": "distractors",
    },

    # Information Density
    IssueCause.VERBOSE_PADDING: {
        "description": "Context contains excessive qualifiers, hedging language, or verbose constructions that consume tokens without adding meaning.",
        "fix": "Apply extractive compression: distill passages to key claims before injection. Use an LLM-based compressor or rule-based sentence simplification.",
        "category": "density",
    },
    IssueCause.LOW_SIGNAL_RATIO: {
        "description": "The ratio of informative content to total tokens is below acceptable thresholds — too much noise, too little signal.",
        "fix": "Score each sentence by information density (unique entities, facts, numbers per token). Remove sentences below the density threshold.",
        "category": "density",
    },
    IssueCause.EXCESSIVE_FORMATTING: {
        "description": "Markdown headers, HTML tags, repeated delimiters, or other formatting consumes tokens without semantic value.",
        "fix": "Strip non-essential formatting before injection. Convert rich formatting to minimal, LLM-friendly plain text with light structural markers.",
        "category": "density",
    },
    IssueCause.FILLER_CONTENT: {
        "description": "Transitional phrases, social pleasantries, or meta-commentary ('As mentioned above...') wastes context budget.",
        "fix": "Build a filler-phrase blocklist and strip matches. Use sentence-level classification to identify and remove non-informative sentences.",
        "category": "density",
    },

    # Fragmentation
    IssueCause.BROKEN_REFERENCES: {
        "description": "Context contains references ('see above', 'the aforementioned', 'Table 3') that point to content not included in the window.",
        "fix": "Detect reference expressions and either resolve them (include referenced content) or remove the referring passages. Use coreference resolution.",
        "category": "fragmentation",
    },
    IssueCause.INCOMPLETE_CONTEXT: {
        "description": "A topic is introduced but not sufficiently developed — the model has enough to be confused but not enough to reason correctly.",
        "fix": "Implement context completeness checking. For each entity or topic introduced, verify that sufficient supporting context is present. Either expand or remove incomplete mentions.",
        "category": "fragmentation",
    },
    IssueCause.ORPHANED_ENTITIES: {
        "description": "Named entities appear without sufficient context for the model to understand what they refer to.",
        "fix": "Detect entities and verify each has a defining context within the window. Add brief entity descriptions or remove undefined entity references.",
        "category": "fragmentation",
    },
    IssueCause.MISSING_RELATIONSHIP_CONTEXT: {
        "description": "The context provides facts about entities but not the relationships between them, forcing statistical inference.",
        "fix": "Use knowledge graph subgraphs to explicitly encode entity relationships. Add relationship triples (entity-relation-entity) as structured context.",
        "category": "fragmentation",
    },

    # Structural
    IssueCause.NO_SECTION_BOUNDARIES: {
        "description": "Context is a single undifferentiated text block with no structural markers separating different types of information.",
        "fix": "Add explicit section delimiters (e.g., XML tags, markdown headers) to separate system instructions, retrieved documents, conversation history, and tool outputs.",
        "category": "structure",
    },
    IssueCause.MIXED_CONTENT_TYPES: {
        "description": "Different content types (instructions, data, conversation) are interleaved without clear separation.",
        "fix": "Reorganize context into typed sections: [SYSTEM], [RETRIEVED_CONTEXT], [CONVERSATION_HISTORY], [TOOL_OUTPUT]. Models attend better to well-structured context.",
        "category": "structure",
    },
    IssueCause.POOR_ORDERING: {
        "description": "Context segments are ordered in a way that doesn't support the model's attention patterns (most relevant info is buried in the middle).",
        "fix": "Place the most relevant information at the beginning and end of the context window (primacy/recency effect). Use the 'lost in the middle' research to optimize positioning.",
        "category": "structure",
    },
    IssueCause.MISSING_METADATA: {
        "description": "Context segments lack source attribution, timestamps, or confidence indicators.",
        "fix": "Prepend metadata headers to each context segment: [Source: X | Date: Y | Confidence: Z]. This helps the model weight information appropriately.",
        "category": "structure",
    },

    # Token Economics
    IssueCause.OVERSIZED_CONTEXT: {
        "description": "Total context exceeds the effective attention capacity of the target model, triggering context rot.",
        "fix": "Reduce context to the model's effective window (often 30-50% of marketed capacity). Use progressive summarization for older context. Apply the 'smallest high-signal set' principle.",
        "category": "economics",
    },
    IssueCause.ATTENTION_BUDGET_EXCEEDED: {
        "description": "The n² attention computation for the current context size exceeds the model's practical attention budget.",
        "fix": "Break complex queries into sub-agent calls with focused, smaller context windows. Use Anthropic's sub-agent pattern: return 1-2K token summaries from agents consuming 10K+ tokens.",
        "category": "economics",
    },
    IssueCause.HIGH_COST_LOW_SIGNAL: {
        "description": "The current context configuration produces a poor cost-to-quality ratio — tokens consumed far exceed the information they carry.",
        "fix": "Apply graph-based retrieval (80% token reduction documented in research). Extract function signatures and types instead of full source files. Use structured context over raw text.",
        "category": "economics",
    },
    IssueCause.CACHEABLE_CONTENT_NOT_CACHED: {
        "description": "Static content (system prompts, tool definitions, reference docs) is being re-sent on every request instead of using prompt caching.",
        "fix": "Enable prompt caching for static context components. OpenAI and Anthropic cache prompts over 1024 tokens at ~10% cost. Separate static from dynamic context.",
        "category": "economics",
    },
}


@dataclass
class ContextSegment:
    """A segment of context with metadata."""
    text: str
    source: str = "unknown"
    segment_type: str = "general"  # system, retrieved, history, tool_output
    timestamp: Optional[str] = None
    token_count: int = 0


@dataclass
class ContextIssue:
    """A diagnosed context quality issue with cause and remediation."""
    cause: IssueCause
    severity: Severity
    description: str
    fix: str
    category: str
    affected_segments: list[int] = field(default_factory=list)
    estimated_improvement: float = 0.0  # estimated CCS points improvement
    estimated_token_savings: int = 0
    evidence: str = ""

    @classmethod
    def from_cause(
        cls,
        cause: IssueCause,
        severity: Severity,
        affected_segments: list[int] | None = None,
        estimated_improvement: float = 0.0,
        estimated_token_savings: int = 0,
        evidence: str = "",
    ) -> ContextIssue:
        """Create an issue from the cause catalog."""
        catalog_entry = CAUSE_CATALOG[cause]
        return cls(
            cause=cause,
            severity=severity,
            description=catalog_entry["description"],
            fix=catalog_entry["fix"],
            category=catalog_entry["category"],
            affected_segments=affected_segments or [],
            estimated_improvement=estimated_improvement,
            estimated_token_savings=estimated_token_savings,
            evidence=evidence,
        )


@dataclass
class DimensionScore:
    """Score for a single quality dimension."""
    name: str
    score: float  # 0-100
    weight: float
    issues: list[ContextIssue] = field(default_factory=list)


@dataclass
class TokenEconomics:
    """Token spend analysis."""
    total_tokens: int = 0
    estimated_useful_tokens: int = 0
    wasted_tokens: int = 0
    waste_percentage: float = 0.0
    estimated_cost: float = 0.0
    wasted_cost: float = 0.0
    potential_savings: float = 0.0
    cost_per_million: float = 5.0  # default: Claude Sonnet-level input pricing


@dataclass
class ScoreResult:
    """Complete scoring result with diagnostics and remediation."""
    score: float  # 0-100 composite CCS
    grade: str  # A+ through F
    dimensions: dict[str, DimensionScore] = field(default_factory=dict)
    issues: list[ContextIssue] = field(default_factory=list)
    economics: TokenEconomics = field(default_factory=TokenEconomics)
    context_length: int = 0
    segment_count: int = 0
    summary: str = ""

    def to_dict(self) -> dict:
        """Serialize to dictionary for JSON output."""
        return {
            "score": round(self.score, 1),
            "grade": self.grade,
            "context_length": self.context_length,
            "segment_count": self.segment_count,
            "summary": self.summary,
            "dimensions": {
                name: {
                    "score": round(d.score, 1),
                    "weight": d.weight,
                    "issue_count": len(d.issues),
                }
                for name, d in self.dimensions.items()
            },
            "issues": [
                {
                    "cause": issue.cause.value,
                    "severity": issue.severity.value,
                    "category": issue.category,
                    "description": issue.description,
                    "fix": issue.fix,
                    "estimated_improvement": round(issue.estimated_improvement, 1),
                    "estimated_token_savings": issue.estimated_token_savings,
                    "evidence": issue.evidence,
                }
                for issue in self.issues
            ],
            "economics": {
                "total_tokens": self.economics.total_tokens,
                "estimated_useful_tokens": self.economics.estimated_useful_tokens,
                "wasted_tokens": self.economics.wasted_tokens,
                "waste_percentage": round(self.economics.waste_percentage, 1),
                "estimated_cost": round(self.economics.estimated_cost, 4),
                "wasted_cost": round(self.economics.wasted_cost, 4),
                "potential_savings": round(self.economics.potential_savings, 4),
            },
        }


# ── Snapshot / Recovery Models ──


@dataclass
class SnapshotDecision:
    """A decision extracted from session context."""
    description: str
    reasoning: str = ""
    affected_files: list[str] = field(default_factory=list)
    timestamp: str = ""


@dataclass
class SnapshotEntity:
    """An entity (file, class, config) extracted from context."""
    name: str
    type: str  # "file" | "class" | "config"
    context: str = ""
    last_mentioned_turn: int = -1


@dataclass
class ContextSnapshot:
    """Complete snapshot of session context for recovery after compaction."""
    session_id: str
    timestamp: str
    turn_count: int
    token_count: int
    quality_score: float
    decisions: list[SnapshotDecision] = field(default_factory=list)
    entities: list[SnapshotEntity] = field(default_factory=list)
    active_files: list[str] = field(default_factory=list)
    patterns: list[str] = field(default_factory=list)
    error_resolutions: list[str] = field(default_factory=list)
    current_task: str = ""
    compact_instructions: str = ""
