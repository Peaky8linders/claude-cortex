"""
Fragmentation Analyzer.

Detects broken references, incomplete context, orphaned entities,
and missing relationship context that force the model into statistical guessing.
"""

from __future__ import annotations

from contextscore.analyzers.base import BaseAnalyzer
from contextscore.models import DimensionScore, ContextIssue, IssueCause, Severity
from contextscore.utils import (
    detect_references,
    extract_entities,
    estimate_tokens,
    word_tokenize,
)


class FragmentationAnalyzer(BaseAnalyzer):

    name = "fragmentation"
    weight = 0.10

    ENTITY_CONTEXT_MIN_MENTIONS = 2  # entity needs at least 2 mentions to be "contextualized"

    def analyze(self, segments: list[str], query: str) -> DimensionScore:
        issues: list[ContextIssue] = []

        if not segments:
            return DimensionScore(name=self.name, score=50.0, weight=self.weight)

        full_context = "\n\n".join(segments)

        # ── Broken references ──
        refs = detect_references(full_context)
        if refs:
            issues.append(ContextIssue.from_cause(
                cause=IssueCause.BROKEN_REFERENCES,
                severity=Severity.MEDIUM,
                estimated_improvement=3.0,
                evidence=f"Found {len(refs)} potential dangling references: {refs[:5]}",
            ))

        # ── Orphaned entities ──
        entities = extract_entities(full_context)
        all_words = word_tokenize(full_context)
        word_freq = {}
        for w in all_words:
            word_freq[w] = word_freq.get(w, 0) + 1

        orphaned = []
        for entity in entities:
            entity_words = word_tokenize(entity)
            # Check if the entity appears with sufficient context
            entity_freq = min(
                word_freq.get(w, 0) for w in entity_words
            ) if entity_words else 0

            if entity_freq < self.ENTITY_CONTEXT_MIN_MENTIONS:
                orphaned.append(entity)

        if orphaned:
            issues.append(ContextIssue.from_cause(
                cause=IssueCause.ORPHANED_ENTITIES,
                severity=Severity.LOW,
                estimated_improvement=2.0,
                evidence=f"{len(orphaned)} entities appear without sufficient context: {orphaned[:5]}",
            ))

        # ── Incomplete context detection ──
        # Check if segments introduce topics that aren't developed
        for i, seg in enumerate(segments):
            seg_entities = extract_entities(seg)
            seg_tokens = estimate_tokens(seg)

            # Very short segments with entities = likely incomplete
            if seg_entities and seg_tokens < 30:
                issues.append(ContextIssue.from_cause(
                    cause=IssueCause.INCOMPLETE_CONTEXT,
                    severity=Severity.MEDIUM,
                    affected_segments=[i],
                    estimated_improvement=2.0,
                    evidence=f"Segment {i} introduces entities {seg_entities[:3]} in only {seg_tokens} tokens",
                ))

        # ── Missing relationship context ──
        # Heuristic: if many entities exist but few connecting verbs/prepositions
        # link them, relationships are likely implicit
        if len(entities) > 5:
            relationship_words = {'between', 'relates', 'connected', 'associated',
                                  'linked', 'caused', 'depends', 'requires', 'affects',
                                  'belongs', 'contains', 'includes', 'manages', 'owns'}
            rel_count = sum(1 for w in all_words if w in relationship_words)
            entity_to_rel_ratio = rel_count / len(entities) if entities else 0

            if entity_to_rel_ratio < 0.2:
                issues.append(ContextIssue.from_cause(
                    cause=IssueCause.MISSING_RELATIONSHIP_CONTEXT,
                    severity=Severity.MEDIUM,
                    estimated_improvement=4.0,
                    evidence=f"{len(entities)} entities found but only {rel_count} relationship indicators (ratio: {entity_to_rel_ratio:.2f})",
                ))

        # ── Score ──
        # Start at 100, deduct for issues
        score = 100.0
        for issue in issues:
            if issue.severity == Severity.CRITICAL:
                score -= 20
            elif issue.severity == Severity.HIGH:
                score -= 12
            elif issue.severity == Severity.MEDIUM:
                score -= 7
            elif issue.severity == Severity.LOW:
                score -= 3

        return DimensionScore(
            name=self.name,
            score=max(0.0, min(100.0, score)),
            weight=self.weight,
            issues=issues,
        )
