"""
Semantic Relevance Analyzer.

Measures how well each context segment aligns with the current query.
Detects irrelevant segments, topic drift, and semantic mismatches.
"""

from __future__ import annotations

from contextscore.analyzers.base import BaseAnalyzer
from contextscore.models import DimensionScore, ContextIssue, IssueCause, Severity
from contextscore.utils import (
    cosine_similarity_bow,
    estimate_tokens,
    word_tokenize,
)


class SemanticRelevanceAnalyzer(BaseAnalyzer):

    name = "semantic_relevance"
    weight = 0.25

    IRRELEVANT_THRESHOLD = 0.02
    LOW_ALIGNMENT_THRESHOLD = 0.10
    DRIFT_THRESHOLD = 0.4  # similarity drop between consecutive segments

    def analyze(self, segments: list[str], query: str) -> DimensionScore:
        issues: list[ContextIssue] = []

        if not segments or not query:
            return DimensionScore(name=self.name, score=50.0, weight=self.weight, issues=[])

        # Score each segment's relevance to query
        similarities = []
        for i, seg in enumerate(segments):
            sim = cosine_similarity_bow(seg, query)
            similarities.append((i, sim))

            if sim < self.IRRELEVANT_THRESHOLD:
                issues.append(ContextIssue.from_cause(
                    cause=IssueCause.IRRELEVANT_SEGMENT,
                    severity=Severity.HIGH,
                    affected_segments=[i],
                    estimated_improvement=5.0,
                    estimated_token_savings=estimate_tokens(seg),
                    evidence=f"Segment {i} has {sim:.2f} similarity to query (threshold: {self.IRRELEVANT_THRESHOLD})",
                ))
            elif sim < self.LOW_ALIGNMENT_THRESHOLD:
                issues.append(ContextIssue.from_cause(
                    cause=IssueCause.LOW_QUERY_ALIGNMENT,
                    severity=Severity.MEDIUM,
                    affected_segments=[i],
                    estimated_improvement=3.0,
                    estimated_token_savings=estimate_tokens(seg) // 2,
                    evidence=f"Segment {i} has {sim:.2f} similarity to query (threshold: {self.LOW_ALIGNMENT_THRESHOLD})",
                ))

        # Detect topic drift (progressive decline in relevance)
        if len(similarities) >= 3:
            recent_sims = [s for _, s in similarities[-3:]]
            early_sims = [s for _, s in similarities[:3]]
            avg_recent = sum(recent_sims) / len(recent_sims)
            avg_early = sum(early_sims) / len(early_sims)

            if avg_early > 0 and (avg_early - avg_recent) / max(avg_early, 0.01) > self.DRIFT_THRESHOLD:
                issues.append(ContextIssue.from_cause(
                    cause=IssueCause.TOPIC_DRIFT,
                    severity=Severity.MEDIUM,
                    affected_segments=list(range(len(segments) - 3, len(segments))),
                    estimated_improvement=4.0,
                    evidence=f"Average relevance dropped from {avg_early:.2f} (early) to {avg_recent:.2f} (recent)",
                ))

        # Compute dimension score
        if similarities:
            avg_sim = sum(s for _, s in similarities) / len(similarities)
            # Scale: 0.0 sim → 0 score, 0.5+ sim → 100 score
            raw_score = min(100.0, avg_sim * 200)
        else:
            raw_score = 0.0

        # Penalize for issues
        penalty = sum(2.0 for i in issues if i.severity == Severity.HIGH)
        penalty += sum(1.0 for i in issues if i.severity == Severity.MEDIUM)
        final_score = max(0.0, min(100.0, raw_score - penalty))

        return DimensionScore(
            name=self.name,
            score=final_score,
            weight=self.weight,
            issues=issues,
        )
