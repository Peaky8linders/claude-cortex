"""
Token Economics Analyzer.

Evaluates the cost-efficiency of the context configuration.
Detects oversized context, attention budget issues, and caching opportunities.
"""

from __future__ import annotations

from contextscore.analyzers.base import BaseAnalyzer
from contextscore.models import DimensionScore, ContextIssue, IssueCause, Severity
from contextscore.utils import estimate_tokens, information_density


class EconomicsAnalyzer(BaseAnalyzer):

    name = "economics"
    weight = 0.10

    # Effective attention thresholds (based on research)
    ATTENTION_WARNING_TOKENS = 32_000
    ATTENTION_CRITICAL_TOKENS = 100_000

    # Cost thresholds
    HIGH_COST_DENSITY_THRESHOLD = 0.15  # below this density, cost/signal is poor

    # Caching detection
    STATIC_SEGMENT_KEYWORDS = {
        'you are', 'system prompt', 'instructions:', 'rules:',
        'always', 'never', 'your role', 'you must',
        'tool_definition', 'function_definition', 'schema:',
        'you are an', 'always be', 'never make', 'always cite',
    }

    def analyze(self, segments: list[str], query: str) -> DimensionScore:
        issues: list[ContextIssue] = []

        if not segments:
            return DimensionScore(name=self.name, score=50.0, weight=self.weight)

        total_tokens = sum(estimate_tokens(seg) for seg in segments)

        # ── Oversized context ──
        if total_tokens > self.ATTENTION_CRITICAL_TOKENS:
            issues.append(ContextIssue.from_cause(
                cause=IssueCause.OVERSIZED_CONTEXT,
                severity=Severity.CRITICAL,
                estimated_improvement=10.0,
                estimated_token_savings=total_tokens - self.ATTENTION_WARNING_TOKENS,
                evidence=f"Context is {total_tokens:,} tokens — well above the {self.ATTENTION_CRITICAL_TOKENS:,} effective attention threshold",
            ))
        elif total_tokens > self.ATTENTION_WARNING_TOKENS:
            issues.append(ContextIssue.from_cause(
                cause=IssueCause.ATTENTION_BUDGET_EXCEEDED,
                severity=Severity.HIGH,
                estimated_improvement=6.0,
                estimated_token_savings=total_tokens - self.ATTENTION_WARNING_TOKENS,
                evidence=f"Context is {total_tokens:,} tokens — approaching attention budget limits",
            ))

        # ── High cost, low signal segments ──
        for i, seg in enumerate(segments):
            seg_tokens = estimate_tokens(seg)
            density = information_density(seg)

            if density < self.HIGH_COST_DENSITY_THRESHOLD and seg_tokens > 200:
                issues.append(ContextIssue.from_cause(
                    cause=IssueCause.HIGH_COST_LOW_SIGNAL,
                    severity=Severity.HIGH,
                    affected_segments=[i],
                    estimated_improvement=3.0,
                    estimated_token_savings=int(seg_tokens * 0.7),
                    evidence=f"Segment {i}: {seg_tokens} tokens at {density:.2f} density = poor cost/signal ratio",
                ))

        # ── Cacheable content not cached ──
        static_segments = []
        for i, seg in enumerate(segments):
            seg_lower = seg.lower()
            is_static = any(kw in seg_lower for kw in self.STATIC_SEGMENT_KEYWORDS)
            if is_static:
                static_segments.append(i)

        if static_segments:
            static_tokens = sum(estimate_tokens(segments[i]) for i in static_segments)
            if static_tokens > 200:  # Only flag if material savings
                issues.append(ContextIssue.from_cause(
                    cause=IssueCause.CACHEABLE_CONTENT_NOT_CACHED,
                    severity=Severity.MEDIUM,
                    affected_segments=static_segments,
                    estimated_improvement=2.0,
                    estimated_token_savings=int(static_tokens * 0.9),  # 90% savings from caching
                    evidence=f"{len(static_segments)} segments ({static_tokens} tokens) appear static and cacheable",
                ))

        # ── Score ──
        score = 100.0
        for issue in issues:
            if issue.severity == Severity.CRITICAL:
                score -= 25
            elif issue.severity == Severity.HIGH:
                score -= 12
            elif issue.severity == Severity.MEDIUM:
                score -= 6

        return DimensionScore(
            name=self.name,
            score=max(0.0, min(100.0, score)),
            weight=self.weight,
            issues=issues,
        )
