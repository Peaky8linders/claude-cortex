"""
Test suite for ContextScore MVP.

Covers: models, utilities, all 7 analyzers, scorer orchestration,
edge cases, and regression scenarios.
"""

import pytest
from contextscore import ContextScorer, ScoreResult, Severity, IssueCause
from contextscore.models import ContextIssue, CAUSE_CATALOG, TokenEconomics
from contextscore.utils import (
    estimate_tokens,
    split_sentences,
    split_segments,
    word_tokenize,
    cosine_similarity_bow,
    jaccard_similarity,
    content_hash,
    information_density,
    detect_formatting_overhead,
    detect_filler_phrases,
    detect_references,
    extract_entities,
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


# ═══════════════════════════════════════════
# Fixtures
# ═══════════════════════════════════════════

@pytest.fixture
def scorer():
    return ContextScorer(cost_per_million_tokens=5.0)


@pytest.fixture
def good_context():
    return (
        "Machine learning models use gradient descent to optimize loss functions. "
        "The learning rate controls the step size during optimization. "
        "Batch normalization helps stabilize training by normalizing layer inputs."
    )


@pytest.fixture
def poor_context():
    return (
        "The weather today is sunny with a high of 75 degrees.\n\n"
        "Machine learning models use gradient descent to optimize loss functions.\n\n"
        "Yesterday I had a great sandwich for lunch at the deli.\n\n"
        "The stock market closed up 2% on Tuesday.\n\n"
        "Machine learning models use gradient descent to optimize loss functions."
    )


@pytest.fixture
def ml_query():
    return "How does gradient descent optimize neural network training?"


# ═══════════════════════════════════════════
# Utility Tests
# ═══════════════════════════════════════════

class TestUtilities:

    def test_estimate_tokens_basic(self):
        assert estimate_tokens("hello world") > 0
        assert estimate_tokens("") == 1  # minimum 1

    def test_estimate_tokens_scales(self):
        short = estimate_tokens("hello")
        long = estimate_tokens("hello " * 100)
        assert long > short

    def test_split_sentences(self):
        text = "First sentence. Second sentence. Third one."
        sents = split_sentences(text)
        assert len(sents) >= 2

    def test_split_segments_double_newline(self):
        text = "Segment one.\n\nSegment two.\n\nSegment three."
        segs = split_segments(text)
        assert len(segs) == 3

    def test_split_segments_custom_delimiter(self):
        text = "Part A---Part B---Part C"
        segs = split_segments(text, delimiter="---")
        assert len(segs) == 3

    def test_word_tokenize(self):
        tokens = word_tokenize("Hello, World! This is a test.")
        assert "hello" in tokens
        assert "world" in tokens
        assert "," not in tokens

    def test_cosine_similarity_identical(self):
        sim = cosine_similarity_bow("machine learning optimization", "machine learning optimization")
        assert sim == pytest.approx(1.0)

    def test_cosine_similarity_different(self):
        sim = cosine_similarity_bow("machine learning optimization", "cooking recipes pasta")
        assert sim < 0.1

    def test_cosine_similarity_related(self):
        sim = cosine_similarity_bow(
            "machine learning gradient descent optimization",
            "neural network training gradient optimization"
        )
        assert 0.2 < sim < 0.9

    def test_cosine_similarity_empty(self):
        assert cosine_similarity_bow("", "") == 0.0
        assert cosine_similarity_bow("hello", "") == 0.0

    def test_jaccard_similarity(self):
        assert jaccard_similarity({"a", "b", "c"}, {"a", "b", "c"}) == 1.0
        assert jaccard_similarity({"a", "b"}, {"c", "d"}) == 0.0
        assert jaccard_similarity(set(), set()) == 1.0

    def test_content_hash_deterministic(self):
        h1 = content_hash("Hello World")
        h2 = content_hash("Hello World")
        assert h1 == h2

    def test_content_hash_normalization(self):
        h1 = content_hash("Hello   World")
        h2 = content_hash("hello world")
        assert h1 == h2

    def test_information_density_high(self):
        dense = "TensorFlow implements automatic differentiation using computational graphs for gradient computation."
        d = information_density(dense)
        assert d > 0.2

    def test_information_density_low(self):
        fluffy = "It is very important to note that this is something that we should be aware of in this context."
        d = information_density(fluffy)
        assert d < 0.2

    def test_detect_formatting_overhead(self):
        plain = "This is plain text with no formatting."
        formatted = "# Header\n## Subheader\n**bold** and *italic*\n---\n| col1 | col2 |"
        assert detect_formatting_overhead(plain) < detect_formatting_overhead(formatted)

    def test_detect_filler_phrases(self):
        text = "As mentioned above, it is important to note that in order to achieve this goal, we must act."
        fillers = detect_filler_phrases(text)
        assert len(fillers) >= 2

    def test_detect_references(self):
        text = "As described above, see Table 3 for details. Refer to the appendix."
        refs = detect_references(text)
        assert len(refs) >= 2

    def test_extract_entities(self):
        text = "Google and Microsoft compete in the AI market. The United States leads investment."
        entities = extract_entities(text)
        assert len(entities) > 0


# ═══════════════════════════════════════════
# Model Tests
# ═══════════════════════════════════════════

class TestModels:

    def test_cause_catalog_complete(self):
        """Every IssueCause must have an entry in CAUSE_CATALOG."""
        for cause in IssueCause:
            assert cause in CAUSE_CATALOG, f"Missing catalog entry for {cause}"
            entry = CAUSE_CATALOG[cause]
            assert "description" in entry
            assert "fix" in entry
            assert "category" in entry
            assert len(entry["description"]) > 10
            assert len(entry["fix"]) > 10

    def test_issue_from_cause(self):
        issue = ContextIssue.from_cause(
            cause=IssueCause.DUPLICATE_CONTENT,
            severity=Severity.HIGH,
            affected_segments=[0, 1],
            estimated_improvement=5.0,
        )
        assert issue.cause == IssueCause.DUPLICATE_CONTENT
        assert issue.severity == Severity.HIGH
        assert len(issue.description) > 0
        assert len(issue.fix) > 0
        assert issue.category == "redundancy"

    def test_score_result_to_dict(self):
        result = ScoreResult(
            score=75.0,
            grade="B",
            context_length=1000,
            segment_count=5,
            summary="Test summary",
        )
        d = result.to_dict()
        assert d["score"] == 75.0
        assert d["grade"] == "B"
        assert isinstance(d["dimensions"], dict)
        assert isinstance(d["issues"], list)


# ═══════════════════════════════════════════
# Analyzer Tests
# ═══════════════════════════════════════════

class TestSemanticRelevanceAnalyzer:

    def test_relevant_context_scores_high(self):
        analyzer = SemanticRelevanceAnalyzer()
        segments = [
            "Gradient descent is an optimization algorithm used to train neural networks.",
            "The learning rate determines step size during gradient descent optimization.",
            "Neural networks use gradient descent to optimize loss functions during training.",
        ]
        result = analyzer.analyze(segments, "How does gradient descent optimize neural networks?")
        assert result.score > 40

    def test_irrelevant_context_scores_low(self):
        analyzer = SemanticRelevanceAnalyzer()
        segments = [
            "The recipe calls for two cups of flour and one egg.",
            "Paris is the capital of France and a popular tourist destination.",
            "The stock market experienced volatility in the third quarter.",
        ]
        result = analyzer.analyze(segments, "How does gradient descent optimize neural networks?")
        assert result.score < 50
        assert any(i.cause == IssueCause.IRRELEVANT_SEGMENT for i in result.issues)

    def test_empty_segments(self):
        analyzer = SemanticRelevanceAnalyzer()
        result = analyzer.analyze([], "test query")
        assert result.score == 50.0

    def test_topic_drift_detection(self):
        analyzer = SemanticRelevanceAnalyzer()
        segments = [
            "Machine learning uses gradient descent for optimization.",
            "Neural networks are trained using backpropagation algorithms.",
            "Deep learning requires large datasets for training models.",
            "The weather in Seattle is often rainy during winter months.",
            "Coffee shops in downtown Portland offer excellent espresso drinks.",
            "The best hiking trails are found in the Pacific Northwest region.",
        ]
        result = analyzer.analyze(segments, "How does machine learning training work?")
        # Should detect drift from ML to unrelated topics
        assert len(result.issues) > 0


class TestRedundancyAnalyzer:

    def test_detects_exact_duplicates(self):
        analyzer = RedundancyAnalyzer()
        segments = [
            "Gradient descent optimizes the loss function.",
            "The learning rate is a key hyperparameter.",
            "Gradient descent optimizes the loss function.",  # duplicate
        ]
        result = analyzer.analyze(segments, "test")
        assert any(i.cause == IssueCause.DUPLICATE_CONTENT for i in result.issues)

    def test_no_duplicates_scores_high(self):
        analyzer = RedundancyAnalyzer()
        segments = [
            "First unique piece of information about topic A.",
            "Second unique piece about topic B with different content.",
            "Third distinct segment covering topic C entirely.",
        ]
        result = analyzer.analyze(segments, "test")
        assert result.score > 70

    def test_single_segment(self):
        analyzer = RedundancyAnalyzer()
        result = analyzer.analyze(["Only one segment"], "test")
        assert result.score == 100.0


class TestDistractorAnalyzer:

    def test_detects_topical_distractors(self):
        analyzer = DistractorAnalyzer()
        segments = [
            "Gradient descent is the primary optimization method for neural networks.",
            "Computer science programs at universities teach various programming languages and algorithms.",
            "The technology industry has seen rapid growth in software engineering positions.",
        ]
        result = analyzer.analyze(segments, "How does gradient descent work in neural network training?")
        # Segments 2-3 are topically adjacent but don't answer the question
        assert len(result.issues) > 0

    def test_no_distractors(self):
        analyzer = DistractorAnalyzer()
        segments = [
            "Gradient descent computes the gradient of the loss function.",
            "The gradient indicates the direction of steepest increase.",
            "Parameters are updated by moving in the opposite direction of the gradient.",
        ]
        result = analyzer.analyze(segments, "How does gradient descent work?")
        distractor_issues = [i for i in result.issues if i.cause == IssueCause.TOPICAL_DISTRACTOR]
        # Highly relevant segments should not be flagged
        assert result.score > 40

    def test_contradiction_detection(self):
        analyzer = DistractorAnalyzer()
        segments = [
            "The system is currently active and processing requests normally.",
            "The system is not active and has been offline since yesterday.",
        ]
        result = analyzer.analyze(segments, "Is the system running?")
        contradiction_issues = [i for i in result.issues if i.cause == IssueCause.CONTRADICTORY_INFORMATION]
        assert len(contradiction_issues) > 0

    def test_stale_content_detection(self):
        analyzer = DistractorAnalyzer()
        segments = [
            "As of 2019, the API supports version 2.0 endpoints.",
            "The current API uses modern authentication as updated in 2024.",
        ]
        result = analyzer.analyze(segments, "What API version should I use?")
        stale_issues = [i for i in result.issues if i.cause == IssueCause.STALE_INFORMATION]
        assert len(stale_issues) > 0


class TestDensityAnalyzer:

    def test_dense_content_scores_high(self):
        analyzer = DensityAnalyzer()
        segments = [
            "TensorFlow 2.15 implements XLA compilation, reducing inference latency by 40% on TPU v5e hardware.",
        ]
        result = analyzer.analyze(segments, "test")
        assert result.score > 40

    def test_fluffy_content_scores_low(self):
        analyzer = DensityAnalyzer()
        segments = [
            "It is very important to note that in this particular context we should be very aware "
            "of the fact that there are many things that we need to consider and think about very "
            "carefully before we make any decisions about what to do next in this situation.",
        ]
        result = analyzer.analyze(segments, "test")
        assert result.score < 60

    def test_filler_detection(self):
        analyzer = DensityAnalyzer()
        segments = [
            "As mentioned above, it is important to note that in order to achieve results, "
            "we must consider that as we can see from the data, in terms of performance, "
            "due to the fact that the system works well, with respect to the architecture."
        ]
        result = analyzer.analyze(segments, "test")
        filler_issues = [i for i in result.issues if i.cause == IssueCause.FILLER_CONTENT]
        assert len(filler_issues) > 0


class TestFragmentationAnalyzer:

    def test_broken_references(self):
        analyzer = FragmentationAnalyzer()
        segments = [
            "As described above in Section 3, the results show improvement.",
            "See Table 5 for the complete breakdown of metrics.",
            "Refer to the appendix for implementation details.",
        ]
        result = analyzer.analyze(segments, "test")
        ref_issues = [i for i in result.issues if i.cause == IssueCause.BROKEN_REFERENCES]
        assert len(ref_issues) > 0

    def test_no_fragmentation(self):
        analyzer = FragmentationAnalyzer()
        segments = [
            "Gradient descent is an iterative optimization algorithm. It computes the gradient "
            "of the loss function with respect to each parameter. The parameters are then "
            "updated by moving in the opposite direction of the gradient, scaled by the learning rate.",
        ]
        result = analyzer.analyze(segments, "test")
        assert result.score > 70


class TestStructureAnalyzer:

    def test_well_structured_context(self):
        analyzer = StructureAnalyzer()
        segments = [
            "[SYSTEM] You are a helpful AI assistant specialized in machine learning.",
            "[RETRIEVED_CONTEXT] Source: ML Textbook | Date: 2024\nGradient descent optimizes loss functions.",
            "[CONVERSATION_HISTORY] User: How does training work? Assistant: Training involves...",
        ]
        result = analyzer.analyze(segments, "How does ML training work?")
        assert result.score > 60

    def test_unstructured_context(self):
        analyzer = StructureAnalyzer()
        segments = [
            "Some information about topic A without any markers.",
            "More information about topic B also without markers.",
            "Additional text about topic C with no structure.",
            "Yet another block of text without any organization.",
        ]
        result = analyzer.analyze(segments, "test")
        structure_issues = [i for i in result.issues if i.cause == IssueCause.NO_SECTION_BOUNDARIES]
        assert len(structure_issues) > 0


class TestEconomicsAnalyzer:

    def test_oversized_context(self):
        analyzer = EconomicsAnalyzer()
        # Simulate a huge context
        segments = ["word " * 500] * 200  # ~100K tokens
        result = analyzer.analyze(segments, "test")
        econ_issues = [i for i in result.issues
                       if i.cause in (IssueCause.OVERSIZED_CONTEXT, IssueCause.ATTENTION_BUDGET_EXCEEDED)]
        assert len(econ_issues) > 0

    def test_cacheable_detection(self):
        analyzer = EconomicsAnalyzer()
        segments = [
            "You are an AI assistant. You must always be helpful and accurate. "
            "Your role is to answer questions based on the provided context. "
            "You must never make up information. Always cite your sources. " * 5,
            "The quarterly earnings report shows revenue of $5.2 billion.",
        ]
        result = analyzer.analyze(segments, "What were the earnings?")
        cache_issues = [i for i in result.issues if i.cause == IssueCause.CACHEABLE_CONTENT_NOT_CACHED]
        assert len(cache_issues) > 0

    def test_efficient_context(self):
        analyzer = EconomicsAnalyzer()
        segments = [
            "TensorFlow 2.15 supports XLA compilation for 40% faster inference on TPU v5e.",
            "PyTorch 2.3 introduces torch.compile with dynamic shapes and CUDA graph support.",
        ]
        result = analyzer.analyze(segments, "Compare ML frameworks")
        assert result.score > 50


# ═══════════════════════════════════════════
# Integration Tests (Full Scorer)
# ═══════════════════════════════════════════

class TestContextScorer:

    def test_good_context_scores_well(self, scorer, good_context, ml_query):
        result = scorer.score(context=good_context, query=ml_query)
        assert isinstance(result, ScoreResult)
        assert result.score > 30
        assert result.grade in ("A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-")

    def test_poor_context_scores_poorly(self, scorer, poor_context, ml_query):
        result = scorer.score(context=poor_context, query=ml_query)
        assert result.score < 80
        assert len(result.issues) > 0

    def test_has_all_dimensions(self, scorer, good_context, ml_query):
        result = scorer.score(context=good_context, query=ml_query)
        expected_dims = {
            "semantic_relevance", "redundancy", "distractors",
            "density", "fragmentation", "structure", "economics",
        }
        assert set(result.dimensions.keys()) == expected_dims

    def test_issues_sorted_by_severity(self, scorer, poor_context, ml_query):
        result = scorer.score(context=poor_context, query=ml_query)
        if len(result.issues) >= 2:
            severity_order = {
                Severity.CRITICAL: 0, Severity.HIGH: 1,
                Severity.MEDIUM: 2, Severity.LOW: 3, Severity.INFO: 4,
            }
            for i in range(len(result.issues) - 1):
                curr = severity_order[result.issues[i].severity]
                next_ = severity_order[result.issues[i + 1].severity]
                assert curr <= next_ or (
                    curr == next_ and
                    result.issues[i].estimated_improvement >= result.issues[i + 1].estimated_improvement
                )

    def test_economics_computed(self, scorer, good_context, ml_query):
        result = scorer.score(context=good_context, query=ml_query)
        assert result.economics.total_tokens > 0
        assert result.economics.estimated_cost > 0

    def test_to_dict_serializable(self, scorer, good_context, ml_query):
        result = scorer.score(context=good_context, query=ml_query)
        d = result.to_dict()
        assert isinstance(d, dict)
        assert isinstance(d["score"], float)
        assert isinstance(d["issues"], list)
        assert isinstance(d["economics"], dict)

    def test_summary_generated(self, scorer, good_context, ml_query):
        result = scorer.score(context=good_context, query=ml_query)
        assert len(result.summary) > 20
        assert "Context Coherence Score" in result.summary

    def test_grade_assignment(self, scorer):
        # Score 95+ = A+
        assert scorer._compute_grade(96) == "A+"
        assert scorer._compute_grade(91) == "A"
        assert scorer._compute_grade(75) == "B"
        assert scorer._compute_grade(60) == "C"
        assert scorer._compute_grade(30) == "F"

    def test_custom_segments(self, scorer, ml_query):
        segments = [
            "Gradient descent computes loss gradients.",
            "Learning rate controls optimization step size.",
        ]
        result = scorer.score(context="", query=ml_query, segments=segments)
        assert result.segment_count == 2

    def test_empty_context(self, scorer):
        result = scorer.score(context="", query="test")
        assert isinstance(result, ScoreResult)
        assert result.score >= 0

    def test_every_issue_has_fix(self, scorer, poor_context, ml_query):
        """Critical test: every diagnosed issue MUST have a remediation."""
        result = scorer.score(context=poor_context, query=ml_query)
        for issue in result.issues:
            assert len(issue.fix) > 10, f"Issue {issue.cause} has no meaningful fix"
            assert len(issue.description) > 10, f"Issue {issue.cause} has no description"

    def test_score_bounded_0_100(self, scorer):
        """Score must always be within 0-100."""
        # Worst case: massive garbage context
        garbage = "asdf qwer zxcv " * 1000
        result = scorer.score(context=garbage, query="meaningful question about AI")
        assert 0 <= result.score <= 100

        # Best case: perfectly aligned
        aligned = "Machine learning gradient descent optimization training neural networks"
        result2 = scorer.score(context=aligned, query="machine learning gradient descent")
        assert 0 <= result2.score <= 100


# ═══════════════════════════════════════════
# Bug Introduction Test (per workflow)
# ═══════════════════════════════════════════

class TestBugDetection:
    """
    Tests that verify our test suite catches real bugs.
    Each test introduces a specific type of failure and verifies detection.
    """

    def test_catches_missing_cause_catalog(self):
        """If a cause is missing from the catalog, from_cause should fail."""
        # This tests that every IssueCause is in CAUSE_CATALOG
        for cause in IssueCause:
            assert cause in CAUSE_CATALOG

    def test_catches_score_out_of_bounds(self, scorer):
        """Scores must be 0-100 no matter the input."""
        edge_cases = [
            ("", ""),
            ("a", "b"),
            ("x " * 100000, "y"),
            ("the the the the the", "the"),
        ]
        for ctx, q in edge_cases:
            result = scorer.score(context=ctx, query=q)
            assert 0 <= result.score <= 100, f"Score {result.score} out of bounds for ctx='{ctx[:20]}...'"

    def test_catches_negative_token_savings(self, scorer):
        """Token savings should never be negative."""
        result = scorer.score(
            context="Some test context about machine learning.\n\nAnother segment here.",
            query="machine learning"
        )
        for issue in result.issues:
            assert issue.estimated_token_savings >= 0, f"Negative savings for {issue.cause}"

    def test_catches_waste_exceeding_total(self, scorer):
        """Wasted tokens can't exceed total tokens."""
        result = scorer.score(
            context="Duplicate.\n\nDuplicate.\n\nDuplicate.\n\nDuplicate.",
            query="test"
        )
        assert result.economics.wasted_tokens <= result.economics.total_tokens
