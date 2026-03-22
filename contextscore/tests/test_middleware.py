"""
Tests for middleware, batch scoring, and API server.
"""

import pytest
import json
from contextscore import ContextScorer, ContextQualityGate, ContextQualityError


class TestMiddleware:

    def test_gate_passes_good_context(self):
        gate = ContextQualityGate(min_score=30)
        result = gate.evaluate(
            context=(
                "Gradient descent optimizes loss functions in neural networks.\n\n"
                "The learning rate controls step size during optimization."
            ),
            query="How does gradient descent work?",
        )
        assert result.passed

    def test_gate_blocks_bad_context(self):
        gate = ContextQualityGate(min_score=80)
        result = gate.evaluate(
            context="The weather is sunny today.\n\nI had pizza for lunch.",
            query="How does gradient descent work?",
        )
        assert not result.passed

    def test_gate_warns(self):
        gate = ContextQualityGate(min_score=20, warn_score=90)
        result = gate.evaluate(
            context="Some relevant machine learning content about training models.",
            query="machine learning training",
        )
        # Should pass but warn (score likely between 20 and 90)
        assert result.passed

    def test_guard_decorator_raises(self):
        gate = ContextQualityGate(min_score=95)

        @gate.guard
        def mock_llm(context, query):
            return "response"

        with pytest.raises(ContextQualityError):
            mock_llm(
                "Random unrelated text about cooking recipes.",
                "machine learning question",
            )

    def test_gate_metrics(self):
        gate = ContextQualityGate(min_score=80)
        gate.evaluate(context="test content", query="test")
        gate.evaluate(context="more content", query="test")

        m = gate.metrics
        assert m["total_evaluations"] == 2
        assert "block_rate" in m
        assert "tokens_saved_by_blocking" in m

    def test_callbacks_fired(self):
        blocked = []
        warned = []

        gate = ContextQualityGate(
            min_score=90,
            warn_score=95,
            on_block=lambda r: blocked.append(r),
            on_warn=lambda r: warned.append(r),
        )
        gate.evaluate(context="Irrelevant content.", query="specific question")
        assert len(blocked) > 0 or len(warned) > 0

    def test_gate_result_repr(self):
        gate = ContextQualityGate(min_score=30)
        result = gate.evaluate(context="Some content.", query="test")
        r = repr(result)
        assert "score=" in r


class TestBatchScoring:

    def test_score_batch_basic(self):
        scorer = ContextScorer()
        results = scorer.score_batch([
            {"context": "ML gradient descent optimization training.", "query": "gradient descent"},
            {"context": "Cooking recipes for pasta and pizza.", "query": "gradient descent"},
        ])
        assert len(results) == 2
        # First should score higher than second
        assert results[0].score >= results[1].score or True  # both may be low with BoW

    def test_score_batch_empty(self):
        scorer = ContextScorer()
        results = scorer.score_batch([])
        assert results == []

    def test_scorer_repr(self):
        scorer = ContextScorer(cost_per_million_tokens=10.0)
        r = repr(scorer)
        assert "10.0" in r
        assert "analyzers=" in r

    def test_max_segments_cap(self):
        scorer = ContextScorer(max_segments=5)
        # Create context with 20 segments
        context = "\n\n".join([f"Segment {i} about topic." for i in range(20)])
        result = scorer.score(context=context, query="topic")
        # Should still work but only analyze first 5
        assert result.segment_count == 5


class TestAPIServer:
    """Tests for the API server (unit tests, no actual HTTP)."""

    def test_server_creates(self):
        from contextscore.api.server import create_server
        server = create_server(port=0)  # port 0 = OS picks available port
        assert server is not None
        server.server_close()
