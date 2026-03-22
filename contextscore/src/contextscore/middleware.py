"""
ContextScore LangChain Middleware — Phase 2 Preview

Demonstrates how ContextScore can be integrated as middleware in a
LangChain/LlamaIndex pipeline to score context quality before it
reaches the LLM.

This is a reference implementation for the Phase 2 integration layer.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Callable

from contextscore.scorer import ContextScorer
from contextscore.models import ScoreResult

logger = logging.getLogger("contextscore.middleware")


class ContextQualityGate:
    """
    Middleware that scores context quality and optionally blocks
    low-quality context from reaching the LLM.

    Usage with a generic pipeline:
        gate = ContextQualityGate(min_score=60)
        result = gate.evaluate(context=full_context, query=user_query)

        if result.passed:
            # Proceed with LLM call
            response = llm.invoke(full_context)
        else:
            # Handle low-quality context
            logger.warning(f"Context blocked: {result.score_result.score}")
            # Apply suggested fixes or fallback

    Usage as a decorator:
        @gate.guard
        def call_llm(context: str, query: str) -> str:
            return llm.invoke(context)
    """

    def __init__(
        self,
        min_score: float = 50.0,
        warn_score: float = 70.0,
        cost_per_million: float = 5.0,
        on_block: Callable[[ScoreResult], Any] | None = None,
        on_warn: Callable[[ScoreResult], Any] | None = None,
    ):
        """
        Args:
            min_score: Block context below this CCS score.
            warn_score: Log warnings below this score (but still pass).
            cost_per_million: Token pricing for economics calculation.
            on_block: Callback when context is blocked.
            on_warn: Callback when context triggers a warning.
        """
        self.min_score = min_score
        self.warn_score = warn_score
        self.scorer = ContextScorer(cost_per_million_tokens=cost_per_million)
        self.on_block = on_block
        self.on_warn = on_warn

        # Metrics
        self._total_evaluations = 0
        self._total_blocked = 0
        self._total_warned = 0
        self._total_tokens_saved = 0

    def evaluate(self, context: str, query: str) -> "GateResult":
        """Evaluate context quality and return pass/warn/block decision."""
        score_result = self.scorer.score(context=context, query=query)
        self._total_evaluations += 1

        if score_result.score < self.min_score:
            self._total_blocked += 1
            self._total_tokens_saved += score_result.economics.total_tokens
            if self.on_block:
                self.on_block(score_result)
            logger.warning(
                f"Context BLOCKED (CCS={score_result.score:.1f}, "
                f"grade={score_result.grade}, issues={len(score_result.issues)})"
            )
            return GateResult(passed=False, warned=False, score_result=score_result)

        if score_result.score < self.warn_score:
            self._total_warned += 1
            if self.on_warn:
                self.on_warn(score_result)
            logger.info(
                f"Context WARNING (CCS={score_result.score:.1f}, "
                f"grade={score_result.grade}, issues={len(score_result.issues)})"
            )
            return GateResult(passed=True, warned=True, score_result=score_result)

        return GateResult(passed=True, warned=False, score_result=score_result)

    def guard(self, func: Callable) -> Callable:
        """Decorator that guards an LLM call with context quality scoring."""
        def wrapper(context: str, query: str, *args, **kwargs):
            result = self.evaluate(context, query)
            if not result.passed:
                raise ContextQualityError(
                    f"Context quality too low: {result.score_result.score:.1f}/100 "
                    f"(minimum: {self.min_score})",
                    score_result=result.score_result,
                )
            return func(context, query, *args, **kwargs)
        return wrapper

    @property
    def metrics(self) -> dict:
        """Return accumulated quality gate metrics."""
        return {
            "total_evaluations": self._total_evaluations,
            "total_blocked": self._total_blocked,
            "total_warned": self._total_warned,
            "block_rate": (
                self._total_blocked / self._total_evaluations
                if self._total_evaluations > 0 else 0
            ),
            "tokens_saved_by_blocking": self._total_tokens_saved,
        }


class GateResult:
    """Result of a context quality gate evaluation."""

    def __init__(self, passed: bool, warned: bool, score_result: ScoreResult):
        self.passed = passed
        self.warned = warned
        self.score_result = score_result

    def __repr__(self) -> str:
        status = "PASSED" if self.passed else "BLOCKED"
        if self.warned:
            status = "WARNED"
        return (
            f"GateResult({status}, score={self.score_result.score:.1f}, "
            f"grade={self.score_result.grade})"
        )


class ContextQualityError(Exception):
    """Raised when context quality is below the minimum threshold."""

    def __init__(self, message: str, score_result: ScoreResult):
        super().__init__(message)
        self.score_result = score_result


# ── Example usage ──
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)

    gate = ContextQualityGate(min_score=50, warn_score=70)

    # Good context
    good_result = gate.evaluate(
        context=(
            "[SYSTEM] You are a cloud infrastructure expert.\n\n"
            "Source: AWS Docs | Date: 2025\n"
            "EC2 Auto Scaling adjusts capacity based on demand.\n"
            "Launch templates define instance configuration.\n\n"
            "Source: AWS Best Practices | Date: 2025\n"
            "Use target tracking scaling policies for predictable workloads.\n"
            "Step scaling is better for sudden traffic spikes."
        ),
        query="How should I configure auto-scaling for my web app?",
    )
    print(f"Good context: {good_result}")

    # Poor context
    poor_result = gate.evaluate(
        context=(
            "The weather is nice today.\n\n"
            "I had pizza for lunch.\n\n"
            "The stock market went up.\n\n"
            "Someone mentioned servers once."
        ),
        query="How should I configure auto-scaling for my web app?",
    )
    print(f"Poor context: {poor_result}")

    print(f"\nGate metrics: {json.dumps(gate.metrics, indent=2)}")
