"""
Distractor Analyzer.

Detects content that is topically related but does not answer the query —
the #1 cause of context rot per Chroma (2025) research.
Also detects contradictions and stale information.
"""

from __future__ import annotations

import re
from contextscore.analyzers.base import BaseAnalyzer
from contextscore.models import DimensionScore, ContextIssue, IssueCause, Severity
from contextscore.utils import (
    cosine_similarity_bow,
    word_tokenize,
    estimate_tokens,
)


class DistractorAnalyzer(BaseAnalyzer):

    name = "distractors"
    weight = 0.20

    # A distractor is topically related (sim > 0.1) but not answer-relevant (sim < 0.25)
    TOPICAL_FLOOR = 0.08
    ANSWER_CEILING = 0.20

    def analyze(self, segments: list[str], query: str) -> DimensionScore:
        issues: list[ContextIssue] = []

        if not segments or not query:
            return DimensionScore(name=self.name, score=80.0, weight=self.weight)

        distractor_count = 0
        total_distractor_tokens = 0

        for i, seg in enumerate(segments):
            sim = cosine_similarity_bow(seg, query)

            # Topical distractor: related enough to seem relevant,
            # but not aligned enough to contain the answer
            if self.TOPICAL_FLOOR < sim < self.ANSWER_CEILING:
                # Additional check: does the segment contain question-answering signals?
                has_answer_signals = self._has_answer_signals(seg, query)
                if not has_answer_signals:
                    distractor_count += 1
                    total_distractor_tokens += estimate_tokens(seg)
                    issues.append(ContextIssue.from_cause(
                        cause=IssueCause.TOPICAL_DISTRACTOR,
                        severity=Severity.HIGH,
                        affected_segments=[i],
                        estimated_improvement=5.0,
                        estimated_token_savings=estimate_tokens(seg),
                        evidence=f"Segment {i} is topically related (sim={sim:.2f}) but unlikely to contain the answer",
                    ))

        # ── Contradiction detection ──
        contradictions = self._detect_contradictions(segments)
        for (i, j, evidence) in contradictions:
            issues.append(ContextIssue.from_cause(
                cause=IssueCause.CONTRADICTORY_INFORMATION,
                severity=Severity.CRITICAL,
                affected_segments=[i, j],
                estimated_improvement=8.0,
                evidence=evidence,
            ))

        # ── Stale information detection ──
        stale_segments = self._detect_stale_content(segments)
        for idx in stale_segments:
            issues.append(ContextIssue.from_cause(
                cause=IssueCause.STALE_INFORMATION,
                severity=Severity.MEDIUM,
                affected_segments=[idx],
                estimated_improvement=2.0,
                evidence=f"Segment {idx} contains temporal markers suggesting outdated information",
            ))

        # ── Score ──
        if len(segments) > 0:
            distractor_ratio = distractor_count / len(segments)
            # Each distractor degrades score significantly (research-backed)
            score = max(0.0, 100.0 - (distractor_ratio * 150))
            # Extra penalty for contradictions
            score -= len(contradictions) * 10
            score = max(0.0, min(100.0, score))
        else:
            score = 80.0

        return DimensionScore(
            name=self.name,
            score=score,
            weight=self.weight,
            issues=issues,
        )

    def _has_answer_signals(self, segment: str, query: str) -> bool:
        """Check if a segment contains signals that it might answer the query."""
        query_words = set(word_tokenize(query))
        seg_words = set(word_tokenize(segment))

        # Check for entity overlap (proper nouns, numbers, specific terms)
        query_specifics = {w for w in query_words if len(w) > 4}
        seg_specifics = {w for w in seg_words if len(w) > 4}

        if not query_specifics:
            return False

        overlap = query_specifics & seg_specifics
        return len(overlap) / len(query_specifics) > 0.3

    def _detect_contradictions(self, segments: list[str]) -> list[tuple[int, int, str]]:
        """
        Simple contradiction detection using negation patterns.
        Looks for segments that make opposing claims about the same subject.
        """
        contradictions = []
        negation_patterns = [
            (r'\bis not\b', r'\bis\b'),
            (r'\bcannot\b', r'\bcan\b'),
            (r'\bnever\b', r'\balways\b'),
            (r'\bno longer\b', r'\bstill\b'),
            (r'\bdecreased\b', r'\bincreased\b'),
            (r'\bfailed\b', r'\bsucceeded\b'),
        ]

        for i in range(len(segments)):
            for j in range(i + 1, len(segments)):
                # Check if segments share subject matter
                sim = cosine_similarity_bow(segments[i], segments[j])
                if sim < 0.3:
                    continue

                # Check for opposing claims
                for neg, pos in negation_patterns:
                    has_neg_i = bool(re.search(neg, segments[i], re.IGNORECASE))
                    has_pos_j = bool(re.search(pos, segments[j], re.IGNORECASE))
                    has_neg_j = bool(re.search(neg, segments[j], re.IGNORECASE))
                    has_pos_i = bool(re.search(pos, segments[i], re.IGNORECASE))

                    if (has_neg_i and has_pos_j) or (has_neg_j and has_pos_i):
                        contradictions.append((
                            i, j,
                            f"Segments {i} and {j} contain potentially contradictory claims (pattern: {neg}/{pos})"
                        ))
                        break  # One contradiction per pair is enough

        return contradictions

    def _detect_stale_content(self, segments: list[str]) -> list[int]:
        """Detect segments that may contain outdated information."""
        stale_patterns = [
            r'\b(?:as of|updated?|current as of)\s+(?:20[0-1]\d|2020|2021|2022)\b',
            r'\b(?:last (?:year|quarter|month))(?:\s|,|\.)',
            r'\bpreviously\b.*\bbut now\b',
            r'\b(?:deprecated|obsolete|discontinued|legacy)\b',
        ]
        stale_indices = []
        for i, seg in enumerate(segments):
            for pattern in stale_patterns:
                if re.search(pattern, seg, re.IGNORECASE):
                    stale_indices.append(i)
                    break
        return stale_indices
