"""Tests for re-ranking and score-adaptive truncation (Tier 1 retrieval improvements)."""

import pytest
import numpy as np

from brainiac.graph import BrainiacGraph, MemoryNode, Edge
from brainiac.retriever import (
    RetrievalResult,
    rerank,
    truncate_adaptive,
    retrieve,
)
from brainiac import embeddings


@pytest.fixture
def temp_graph(tmp_path):
    """Create a temporary graph with nodes and embeddings."""
    graph_dir = tmp_path / "graph"
    graph_dir.mkdir()
    (graph_dir / "nodes.json").write_text("[]")
    (graph_dir / "edges.json").write_text("[]")
    return BrainiacGraph(graph_dir=graph_dir)


def make_result(node_id, score, content="test"):
    """Helper to create a RetrievalResult.

    Uses a recent timestamp so temporal decay doesn't distort test expectations.
    """
    from datetime import datetime
    now = datetime.now().isoformat(timespec="seconds")
    node = MemoryNode(
        id=node_id, content=content, timestamp=now,
        metadata={"type": "pattern", "last_accessed": now, "unique_sessions": 3},
    )
    return RetrievalResult(node=node, score=score, path=[node_id], relations=[])


class TestRerank:
    """Test the re-ranking pass."""

    def test_rerank_empty(self):
        """Empty results should return empty."""
        assert rerank([], [0.0] * 384, {}) == []

    def test_rerank_preserves_results(self):
        """Re-ranking should not add or remove results."""
        results = [make_result("a", 0.5), make_result("b", 0.3)]
        query_vec = [0.0] * 384
        embs = {"a": [0.0] * 384, "b": [0.0] * 384}
        reranked = rerank(results, query_vec, embs)
        assert len(reranked) == 2

    def test_rerank_promotes_directly_similar(self):
        """A node with low BFS score but high direct similarity should be promoted."""
        # Node "buried" has low BFS score (0.1) but its embedding is identical to query
        # Node "anchor" has high BFS score (0.9) but orthogonal embedding
        query_vec = np.random.randn(384).tolist()
        query_norm = (np.array(query_vec) / np.linalg.norm(query_vec)).tolist()

        results = [
            make_result("anchor", 0.9),  # high BFS, will have low direct sim
            make_result("buried", 0.1),  # low BFS, will have high direct sim
        ]

        embs = {
            "anchor": np.zeros(384).tolist(),  # orthogonal to query
            "buried": query_norm,              # identical to query
        }

        reranked = rerank(results, query_norm, embs)
        # "buried" should now rank first (0.7 * 1.0 + 0.3 * low_bfs > 0.7 * 0.0 + 0.3 * 1.0)
        assert reranked[0].node.id == "buried"

    def test_rerank_blends_bfs_and_direct(self):
        """Score should be 0.7 * direct * decay + 0.3 * normalized_bfs.

        With temporal decay, a recently-accessed node with unique_sessions=3
        gets a frequency boost of log(4) ≈ 1.386, so the expected score is:
        0.7 * 1.0 * log(4) + 0.3 * 1.0 ≈ 1.27
        """
        query_vec = [1.0] + [0.0] * 383
        results = [make_result("a", 1.0)]
        embs = {"a": [1.0] + [0.0] * 383}  # perfect match
        reranked = rerank(results, query_vec, embs)
        # Score > 1.0 because frequency boost from unique_sessions=3
        assert reranked[0].score > 0.9

    def test_rerank_handles_missing_embedding(self):
        """Nodes without embeddings get direct_sim=0."""
        query_vec = [1.0] + [0.0] * 383
        results = [make_result("no_emb", 0.5)]
        embs = {}  # no embedding for this node
        reranked = rerank(results, query_vec, embs)
        # 0.7 * 0.0 + 0.3 * 1.0 = 0.3
        assert abs(reranked[0].score - 0.3) < 0.01


class TestTruncateAdaptive:
    """Test score-adaptive truncation."""

    def test_truncate_empty(self):
        """Empty results should return empty."""
        assert truncate_adaptive([]) == []

    def test_truncate_below_min(self):
        """Results below min_results should not be truncated."""
        results = [make_result("a", 0.9), make_result("b", 0.1)]
        assert len(truncate_adaptive(results, min_results=3)) == 2

    def test_truncate_at_sharp_drop(self):
        """Should truncate where score drops > 50%."""
        results = [
            make_result("a", 0.9),
            make_result("b", 0.85),
            make_result("c", 0.8),
            make_result("d", 0.3),  # 62.5% drop from 0.8 → should truncate here
            make_result("e", 0.1),
        ]
        truncated = truncate_adaptive(results)
        assert len(truncated) == 3
        assert truncated[-1].node.id == "c"

    def test_truncate_no_sharp_drop(self):
        """Gradual scores should not trigger truncation."""
        results = [
            make_result("a", 0.9),
            make_result("b", 0.7),
            make_result("c", 0.5),
            make_result("d", 0.35),
        ]
        truncated = truncate_adaptive(results)
        assert len(truncated) == 4  # no >50% drop between consecutive

    def test_truncate_respects_min_results(self):
        """Even with sharp drop, keep min_results."""
        results = [
            make_result("a", 1.0),
            make_result("b", 0.01),  # 99% drop, but min_results=3
            make_result("c", 0.001),
            make_result("d", 0.0001),
        ]
        truncated = truncate_adaptive(results, min_results=3)
        assert len(truncated) >= 3

    def test_truncate_custom_threshold(self):
        """Custom drop_threshold should work."""
        results = [
            make_result("a", 1.0),
            make_result("b", 0.8),
            make_result("c", 0.75),
            make_result("d", 0.5),   # 33% drop from 0.75
        ]
        # With 30% threshold, should truncate at d
        truncated = truncate_adaptive(results, min_results=3, drop_threshold=0.3)
        assert len(truncated) == 3


class TestExpandCommand:
    """Test the brainiac expand CLI command."""

    def test_expand_existing_node(self, temp_graph, capsys):
        """Expanding an existing node should show full content."""
        from brainiac.cli import cmd_expand

        node = MemoryNode(
            id="dec-001", content="Use JSON persistence for zero-dep graph storage",
            timestamp="2026-01-15", keywords=["JSON", "persistence", "graph"],
            tags=["architecture"], metadata={"type": "decision", "status": "active"},
        )
        temp_graph.nodes[node.id] = node
        temp_graph.save()

        cmd_expand(temp_graph, "dec-001")
        output = capsys.readouterr().out
        assert "dec-001" in output
        assert "JSON persistence" in output
        assert "decision" in output

    def test_expand_nonexistent_node(self, temp_graph, capsys):
        """Expanding a missing node should report not found."""
        from brainiac.cli import cmd_expand
        cmd_expand(temp_graph, "nonexistent-999")
        output = capsys.readouterr().out
        assert "not found" in output

    def test_expand_shows_connections(self, temp_graph, capsys):
        """Expanding should show connected nodes."""
        from brainiac.cli import cmd_expand

        n1 = MemoryNode(id="pat-001", content="Pattern A", timestamp="2026-01-01",
                         metadata={"type": "pattern"})
        n2 = MemoryNode(id="pat-002", content="Pattern B", timestamp="2026-01-01",
                         metadata={"type": "pattern"})
        temp_graph.nodes[n1.id] = n1
        temp_graph.nodes[n2.id] = n2
        temp_graph.add_edge(Edge(source="pat-001", target="pat-002",
                                  relation="semantic", weight=0.85))
        temp_graph.save()

        cmd_expand(temp_graph, "pat-001")
        output = capsys.readouterr().out
        assert "Connections" in output
        assert "pat-002" in output
        assert "semantic" in output
