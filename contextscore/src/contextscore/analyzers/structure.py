"""
Structure Analyzer.

Evaluates how well the context is organized: section boundaries,
content type separation, ordering for attention patterns, and metadata presence.
"""

from __future__ import annotations

import re
from contextscore.analyzers.base import BaseAnalyzer
from contextscore.models import DimensionScore, ContextIssue, IssueCause, Severity
from contextscore.utils import cosine_similarity_bow, estimate_tokens


class StructureAnalyzer(BaseAnalyzer):

    name = "structure"
    weight = 0.05

    SECTION_MARKERS = [
        r'#{1,6}\s+',           # Markdown headers
        r'</?(?:section|div|h[1-6])',  # HTML structural
        r'\[(?:SYSTEM|CONTEXT|HISTORY|USER|TOOL|RETRIEVED|INSTRUCTIONS)\]',  # Role markers
        r'---+',                 # Horizontal rules
        r'={3,}',               # Alternative rules
        r'</?(?:system|user|assistant|tool)',  # Chat role tags
    ]

    METADATA_PATTERNS = [
        r'(?:source|from|via|ref):\s*\S+',
        r'(?:date|timestamp|updated):\s*\S+',
        r'(?:confidence|score|relevance):\s*[\d.]+',
        r'(?:author|by):\s*\S+',
    ]

    CONTENT_TYPE_KEYWORDS = {
        'instruction': {'must', 'should', 'always', 'never', 'ensure', 'follow', 'rule'},
        'data': {'table', 'row', 'column', 'field', 'value', 'record', 'id'},
        'conversation': {'user', 'assistant', 'said', 'asked', 'replied', 'message'},
        'code': {'function', 'class', 'import', 'return', 'def', 'const', 'var'},
    }

    def analyze(self, segments: list[str], query: str) -> DimensionScore:
        issues: list[ContextIssue] = []

        if not segments:
            return DimensionScore(name=self.name, score=50.0, weight=self.weight)

        full_context = "\n\n".join(segments)

        # ── Section boundary detection ──
        has_boundaries = False
        for pattern in self.SECTION_MARKERS:
            if re.search(pattern, full_context, re.IGNORECASE):
                has_boundaries = True
                break

        if not has_boundaries and len(segments) > 3:
            issues.append(ContextIssue.from_cause(
                cause=IssueCause.NO_SECTION_BOUNDARIES,
                severity=Severity.MEDIUM,
                estimated_improvement=3.0,
                evidence="No structural markers found separating context sections",
            ))

        # ── Mixed content types ──
        segment_types = []
        for seg in segments:
            seg_lower = seg.lower()
            seg_words = set(seg_lower.split())
            detected_types = []
            for ctype, keywords in self.CONTENT_TYPE_KEYWORDS.items():
                overlap = seg_words & keywords
                if len(overlap) >= 2:
                    detected_types.append(ctype)
            segment_types.append(detected_types)

        # Check for interleaving
        if len(segments) >= 4:
            type_sequence = [t[0] if t else 'unknown' for t in segment_types]
            transitions = sum(
                1 for i in range(1, len(type_sequence))
                if type_sequence[i] != type_sequence[i - 1]
            )
            transition_rate = transitions / max(len(type_sequence) - 1, 1)

            if transition_rate > 0.6:
                issues.append(ContextIssue.from_cause(
                    cause=IssueCause.MIXED_CONTENT_TYPES,
                    severity=Severity.LOW,
                    estimated_improvement=2.0,
                    evidence=f"Content types alternate {transitions} times across {len(segments)} segments (rate: {transition_rate:.2f})",
                ))

        # ── Ordering analysis (lost in the middle) ──
        if query and len(segments) >= 5:
            sims = [cosine_similarity_bow(seg, query) for seg in segments]
            n = len(sims)
            third = n // 3

            if third > 0:
                start_avg = sum(sims[:third]) / third
                middle_avg = sum(sims[third:2 * third]) / max(1, 2 * third - third)
                end_avg = sum(sims[2 * third:]) / max(1, n - 2 * third)

                # Best content should be at start or end, not buried in middle
                if middle_avg > max(start_avg, end_avg) * 1.3:
                    issues.append(ContextIssue.from_cause(
                        cause=IssueCause.POOR_ORDERING,
                        severity=Severity.MEDIUM,
                        estimated_improvement=3.0,
                        evidence=f"Most relevant content is in the middle (start={start_avg:.2f}, middle={middle_avg:.2f}, end={end_avg:.2f}). Move to start/end for better attention.",
                    ))

        # ── Metadata presence ──
        has_metadata = False
        for pattern in self.METADATA_PATTERNS:
            if re.search(pattern, full_context, re.IGNORECASE):
                has_metadata = True
                break

        if not has_metadata and len(segments) > 2:
            issues.append(ContextIssue.from_cause(
                cause=IssueCause.MISSING_METADATA,
                severity=Severity.LOW,
                estimated_improvement=1.0,
                evidence="No source attribution, timestamps, or confidence metadata found",
            ))

        # ── Score ──
        score = 100.0
        for issue in issues:
            if issue.severity == Severity.MEDIUM:
                score -= 12
            elif issue.severity == Severity.LOW:
                score -= 5

        return DimensionScore(
            name=self.name,
            score=max(0.0, min(100.0, score)),
            weight=self.weight,
            issues=issues,
        )
