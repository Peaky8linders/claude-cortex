"""
ContextScorer — the main entry point for context quality scoring.

Orchestrates all analyzers, computes composite score, and assembles
the complete diagnostic + remediation report.
"""

from __future__ import annotations

from contextscore.models import (
    ScoreResult,
    DimensionScore,
    ContextIssue,
    TokenEconomics,
    Severity,
)
from contextscore.analyzers import (
    SemanticRelevanceAnalyzer,
    RedundancyAnalyzer,
    DistractorAnalyzer,
    DensityAnalyzer,
    FragmentationAnalyzer,
    StructureAnalyzer,
    EconomicsAnalyzer,
)
from contextscore.utils import estimate_tokens, split_segments


class ContextScorer:
    """
    Main scoring engine.

    Usage:
        scorer = ContextScorer()
        result = scorer.score(context="...", query="...")
        print(result.score, result.grade)
        for issue in result.issues:
            print(issue.cause, issue.fix)
    """

    GRADE_THRESHOLDS = [
        (95, "A+"), (90, "A"), (85, "A-"),
        (80, "B+"), (75, "B"), (70, "B-"),
        (65, "C+"), (60, "C"), (55, "C-"),
        (50, "D+"), (45, "D"), (40, "D-"),
        (0, "F"),
    ]

    def __init__(
        self,
        cost_per_million_tokens: float = 5.0,
        max_segments: int = 200,
    ):
        """
        Initialize the scorer.

        Args:
            cost_per_million_tokens: Input token cost per million tokens.
                Defaults to $5.00 (Claude Sonnet-level pricing).
            max_segments: Maximum segments to analyze (caps O(n²) analyzers).
        """
        self.cost_per_million = cost_per_million_tokens
        self.max_segments = max_segments
        self.analyzers = [
            SemanticRelevanceAnalyzer(),
            RedundancyAnalyzer(),
            DistractorAnalyzer(),
            DensityAnalyzer(),
            FragmentationAnalyzer(),
            StructureAnalyzer(),
            EconomicsAnalyzer(),
        ]

    def __repr__(self) -> str:
        return (
            f"ContextScorer(cost_per_million={self.cost_per_million}, "
            f"analyzers={len(self.analyzers)}, max_segments={self.max_segments})"
        )

    def score(
        self,
        context: str,
        query: str,
        segments: list[str] | None = None,
        segment_delimiter: str | None = None,
    ) -> ScoreResult:
        """
        Score a context window for quality.

        Args:
            context: The full context string.
            query: The current user query/task.
            segments: Pre-split context segments (optional).
            segment_delimiter: Delimiter to split context (default: double newline).

        Returns:
            ScoreResult with composite score, dimension scores, issues, and economics.
        """
        # Split context into segments
        if segments is None:
            segments = split_segments(context, segment_delimiter)

        if not segments:
            segments = [context] if context else []

        # Cap segments for O(n²) analyzer scalability
        if len(segments) > self.max_segments:
            segments = segments[:self.max_segments]

        # Run all analyzers
        dimensions: dict[str, DimensionScore] = {}
        all_issues: list[ContextIssue] = []

        for analyzer in self.analyzers:
            dim_score = analyzer.analyze(segments, query)
            dimensions[dim_score.name] = dim_score
            all_issues.extend(dim_score.issues)

        # Compute composite score (weighted average)
        total_weight = sum(d.weight for d in dimensions.values())
        if total_weight > 0:
            composite = sum(
                d.score * d.weight for d in dimensions.values()
            ) / total_weight
        else:
            composite = 0.0

        # Sort issues by severity and estimated improvement
        severity_order = {
            Severity.CRITICAL: 0,
            Severity.HIGH: 1,
            Severity.MEDIUM: 2,
            Severity.LOW: 3,
            Severity.INFO: 4,
        }
        all_issues.sort(
            key=lambda i: (severity_order[i.severity], -i.estimated_improvement)
        )

        # Compute token economics
        economics = self._compute_economics(segments, all_issues)

        # Determine grade
        grade = self._compute_grade(composite)

        # Generate summary
        summary = self._generate_summary(composite, grade, dimensions, all_issues)

        return ScoreResult(
            score=round(composite, 1),
            grade=grade,
            dimensions=dimensions,
            issues=all_issues,
            economics=economics,
            context_length=estimate_tokens(context) if context else 0,
            segment_count=len(segments),
            summary=summary,
        )

    def _compute_grade(self, score: float) -> str:
        for threshold, grade in self.GRADE_THRESHOLDS:
            if score >= threshold:
                return grade
        return "F"

    def _compute_economics(
        self, segments: list[str], issues: list[ContextIssue]
    ) -> TokenEconomics:
        total_tokens = sum(estimate_tokens(seg) for seg in segments)
        wasted_tokens = sum(i.estimated_token_savings for i in issues)
        wasted_tokens = min(wasted_tokens, total_tokens)  # can't waste more than total

        estimated_cost = (total_tokens / 1_000_000) * self.cost_per_million
        wasted_cost = (wasted_tokens / 1_000_000) * self.cost_per_million
        waste_pct = (wasted_tokens / total_tokens * 100) if total_tokens > 0 else 0.0

        return TokenEconomics(
            total_tokens=total_tokens,
            estimated_useful_tokens=total_tokens - wasted_tokens,
            wasted_tokens=wasted_tokens,
            waste_percentage=waste_pct,
            estimated_cost=estimated_cost,
            wasted_cost=wasted_cost,
            potential_savings=wasted_cost,
            cost_per_million=self.cost_per_million,
        )

    def _generate_summary(
        self,
        score: float,
        grade: str,
        dimensions: dict[str, DimensionScore],
        issues: list[ContextIssue],
    ) -> str:
        critical = sum(1 for i in issues if i.severity == Severity.CRITICAL)
        high = sum(1 for i in issues if i.severity == Severity.HIGH)

        # Find weakest dimension
        weakest = min(dimensions.values(), key=lambda d: d.score) if dimensions else None
        strongest = max(dimensions.values(), key=lambda d: d.score) if dimensions else None

        parts = [f"Context Coherence Score: {score:.0f}/100 (Grade: {grade})."]

        if critical > 0:
            parts.append(f"{critical} critical issue(s) require immediate attention.")
        if high > 0:
            parts.append(f"{high} high-severity issue(s) detected.")

        if weakest and strongest:
            parts.append(
                f"Weakest dimension: {weakest.name} ({weakest.score:.0f}). "
                f"Strongest: {strongest.name} ({strongest.score:.0f})."
            )

        total_savings = sum(i.estimated_token_savings for i in issues)
        if total_savings > 0:
            parts.append(
                f"Addressing all issues could save ~{total_savings:,} tokens per request."
            )

        return " ".join(parts)

    def score_batch(
        self,
        items: list[dict],
    ) -> list[ScoreResult]:
        """
        Score multiple context windows.

        Args:
            items: List of dicts with 'context' and 'query' keys.

        Returns:
            List of ScoreResult objects.
        """
        return [
            self.score(context=item["context"], query=item["query"])
            for item in items
        ]
