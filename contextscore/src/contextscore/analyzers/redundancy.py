"""
Redundancy Analyzer.

Detects duplicate, near-duplicate, paraphrased, and boilerplate content
that wastes tokens without adding information.
"""

from __future__ import annotations

from contextscore.analyzers.base import BaseAnalyzer
from contextscore.models import DimensionScore, ContextIssue, IssueCause, Severity
from contextscore.utils import (
    content_hash,
    jaccard_similarity,
    cosine_similarity_bow,
    word_tokenize,
    estimate_tokens,
)


class RedundancyAnalyzer(BaseAnalyzer):

    name = "redundancy"
    weight = 0.15

    EXACT_DUP_THRESHOLD = 1.0
    NEAR_DUP_THRESHOLD = 0.85
    PARAPHRASE_THRESHOLD = 0.70
    BOILERPLATE_MIN_OCCURRENCES = 3
    BOILERPLATE_MIN_LENGTH = 20

    MAX_PAIRWISE_SEGMENTS = 100  # Cap O(n²) comparisons for large contexts

    def analyze(self, segments: list[str], query: str) -> DimensionScore:
        issues: list[ContextIssue] = []

        if len(segments) < 2:
            return DimensionScore(name=self.name, score=100.0, weight=self.weight)

        # Cap pairwise comparisons for scalability
        capped = segments[:self.MAX_PAIRWISE_SEGMENTS]

        # ── Exact duplicates (O(n) via hashing) ──
        hashes: dict[str, list[int]] = {}
        for i, seg in enumerate(capped):
            h = content_hash(seg)
            hashes.setdefault(h, []).append(i)

        dup_indices: set[int] = set()
        for h, indices in hashes.items():
            if len(indices) > 1:
                dup_indices.update(indices[1:])
                issues.append(ContextIssue.from_cause(
                    cause=IssueCause.DUPLICATE_CONTENT,
                    severity=Severity.HIGH,
                    affected_segments=indices[1:],
                    estimated_improvement=5.0,
                    estimated_token_savings=sum(
                        estimate_tokens(capped[i]) for i in indices[1:]
                    ),
                    evidence=f"Segments {indices} are exact duplicates",
                ))

        # ── Near-duplicates and paraphrases (O(n²) — capped) ──
        # Pre-compute word sets once
        word_sets = [set(word_tokenize(seg)) for seg in capped]

        for i in range(len(capped)):
            if i in dup_indices:
                continue
            for j in range(i + 1, len(capped)):
                if j in dup_indices:
                    continue
                if content_hash(capped[i]) == content_hash(capped[j]):
                    continue

                jacc = jaccard_similarity(word_sets[i], word_sets[j])

                if jacc >= self.NEAR_DUP_THRESHOLD:
                    issues.append(ContextIssue.from_cause(
                        cause=IssueCause.NEAR_DUPLICATE,
                        severity=Severity.HIGH,
                        affected_segments=[j],
                        estimated_improvement=4.0,
                        estimated_token_savings=estimate_tokens(capped[j]),
                        evidence=f"Segments {i} and {j} have {jacc:.2f} Jaccard similarity",
                    ))
                elif jacc < self.PARAPHRASE_THRESHOLD:
                    cos_sim = cosine_similarity_bow(capped[i], capped[j])
                    if cos_sim >= self.PARAPHRASE_THRESHOLD:
                        issues.append(ContextIssue.from_cause(
                            cause=IssueCause.PARAPHRASED_REPETITION,
                            severity=Severity.MEDIUM,
                            affected_segments=[j],
                            estimated_improvement=3.0,
                            estimated_token_savings=estimate_tokens(capped[j]) // 2,
                            evidence=f"Segments {i} and {j}: Jaccard={jacc:.2f}, Cosine={cos_sim:.2f} (paraphrased)",
                        ))

        # ── Boilerplate detection ──
        # Find repeated substrings across segments
        sentence_counts: dict[str, int] = {}
        for seg in segments:
            sentences = seg.split('.')
            for sent in sentences:
                sent = sent.strip().lower()
                if len(sent) >= self.BOILERPLATE_MIN_LENGTH:
                    sentence_counts[sent] = sentence_counts.get(sent, 0) + 1

        boilerplate_count = sum(
            1 for count in sentence_counts.values()
            if count >= self.BOILERPLATE_MIN_OCCURRENCES
        )
        if boilerplate_count > 0:
            issues.append(ContextIssue.from_cause(
                cause=IssueCause.BOILERPLATE_REPETITION,
                severity=Severity.MEDIUM,
                estimated_improvement=2.0,
                estimated_token_savings=boilerplate_count * 50,
                evidence=f"{boilerplate_count} sentences appear {self.BOILERPLATE_MIN_OCCURRENCES}+ times across segments",
            ))

        # ── Score calculation ──
        total_tokens = sum(estimate_tokens(s) for s in segments)
        wasted_tokens = sum(i.estimated_token_savings for i in issues)
        waste_ratio = wasted_tokens / max(total_tokens, 1)

        # Score: 100 = no redundancy, 0 = all redundant
        score = max(0.0, 100.0 * (1.0 - waste_ratio * 2))

        return DimensionScore(
            name=self.name,
            score=min(100.0, score),
            weight=self.weight,
            issues=issues,
        )
