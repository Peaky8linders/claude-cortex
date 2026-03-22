"""
Information Density Analyzer.

Measures the ratio of meaningful information to total tokens.
Detects verbose padding, low signal content, excessive formatting, and filler.
"""

from __future__ import annotations

from contextscore.analyzers.base import BaseAnalyzer
from contextscore.models import DimensionScore, ContextIssue, IssueCause, Severity
from contextscore.utils import (
    information_density,
    detect_formatting_overhead,
    detect_filler_phrases,
    estimate_tokens,
)


class DensityAnalyzer(BaseAnalyzer):

    name = "density"
    weight = 0.15

    DENSITY_LOW_THRESHOLD = 0.15
    DENSITY_MEDIUM_THRESHOLD = 0.25
    FORMATTING_HIGH_THRESHOLD = 0.20
    FILLER_HIGH_THRESHOLD = 3  # number of filler phrases

    def analyze(self, segments: list[str], query: str) -> DimensionScore:
        issues: list[ContextIssue] = []

        if not segments:
            return DimensionScore(name=self.name, score=50.0, weight=self.weight)

        densities = []
        total_filler_count = 0
        total_formatting_overhead = 0.0

        for i, seg in enumerate(segments):
            # Information density
            density = information_density(seg)
            densities.append(density)

            if density < self.DENSITY_LOW_THRESHOLD:
                issues.append(ContextIssue.from_cause(
                    cause=IssueCause.LOW_SIGNAL_RATIO,
                    severity=Severity.HIGH,
                    affected_segments=[i],
                    estimated_improvement=4.0,
                    estimated_token_savings=int(estimate_tokens(seg) * 0.6),
                    evidence=f"Segment {i} information density: {density:.2f} (threshold: {self.DENSITY_LOW_THRESHOLD})",
                ))
            elif density < self.DENSITY_MEDIUM_THRESHOLD:
                issues.append(ContextIssue.from_cause(
                    cause=IssueCause.VERBOSE_PADDING,
                    severity=Severity.MEDIUM,
                    affected_segments=[i],
                    estimated_improvement=2.0,
                    estimated_token_savings=int(estimate_tokens(seg) * 0.3),
                    evidence=f"Segment {i} information density: {density:.2f} (could be compressed)",
                ))

            # Formatting overhead
            fmt_overhead = detect_formatting_overhead(seg)
            total_formatting_overhead += fmt_overhead

            if fmt_overhead > self.FORMATTING_HIGH_THRESHOLD:
                issues.append(ContextIssue.from_cause(
                    cause=IssueCause.EXCESSIVE_FORMATTING,
                    severity=Severity.LOW,
                    affected_segments=[i],
                    estimated_improvement=1.0,
                    estimated_token_savings=int(estimate_tokens(seg) * fmt_overhead),
                    evidence=f"Segment {i} has {fmt_overhead:.0%} formatting overhead",
                ))

            # Filler phrases
            fillers = detect_filler_phrases(seg)
            total_filler_count += len(fillers)

        # Overall filler assessment
        if total_filler_count >= self.FILLER_HIGH_THRESHOLD:
            issues.append(ContextIssue.from_cause(
                cause=IssueCause.FILLER_CONTENT,
                severity=Severity.MEDIUM,
                estimated_improvement=2.0,
                estimated_token_savings=total_filler_count * 8,  # ~8 tokens per filler phrase
                evidence=f"Found {total_filler_count} filler phrases across context",
            ))

        # ── Score ──
        avg_density = sum(densities) / len(densities) if densities else 0.0
        # Scale: 0.0 density → 0, 0.4+ density → 100
        raw_score = min(100.0, avg_density * 250)

        # Adjust for formatting overhead
        avg_formatting = total_formatting_overhead / len(segments) if segments else 0
        raw_score *= (1.0 - avg_formatting * 0.5)

        return DimensionScore(
            name=self.name,
            score=max(0.0, min(100.0, raw_score)),
            weight=self.weight,
            issues=issues,
        )
