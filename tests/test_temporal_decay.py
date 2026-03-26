"""Tests for temporal decay scoring and salience tiers.

Validates that:
1. Recently accessed nodes score higher than stale ones
2. Frequently accessed nodes get a boost
3. Dormant nodes are excluded from retrieval
4. Demote/promote commands work correctly
5. record_access updates metadata correctly
"""

import pytest
from datetime import datetime, timedelta

from brainiac.graph import BrainiacGraph, MemoryNode, Edge
from brainiac.retriever import (
    decay_weight,
    record_access,
    is_retrievable,
    RetrievalResult,
    rerank,
    DECAY_HALF_LIFE_DAYS,
    DECAY_FLOOR,
)


def make_node(node_id: str, days_ago: int = 0, unique_sessions: int = 1,
              salience: str = "active") -> MemoryNode:
    """Create a node last accessed `days_ago` days in the past."""
    ts = (datetime.now() - timedelta(days=days_ago)).isoformat(timespec="seconds")
    return MemoryNode(
        id=node_id,
        content=f"Test node {node_id}",
        timestamp=ts,
        keywords=["test"],
        metadata={
            "type": "pattern",
            "last_accessed": ts,
            "unique_sessions": unique_sessions,
            "salience": salience,
        },
    )


@pytest.fixture
def tmp_graph(tmp_path):
    graph_dir = tmp_path / "graph"
    graph_dir.mkdir()
    (graph_dir / "nodes.json").write_text("[]")
    (graph_dir / "edges.json").write_text("[]")
    return BrainiacGraph(graph_dir=graph_dir)


class TestDecayWeight:
    """Test the temporal decay function."""

    def test_recent_node_scores_high(self):
        """A node accessed today should have decay close to 1.0."""
        node = make_node("fresh", days_ago=0)
        weight = decay_weight(node)
        assert weight >= 0.6  # log(2) * ~1.0

    def test_stale_node_scores_low(self):
        """A node accessed 90 days ago should have low decay."""
        node = make_node("stale", days_ago=90)
        weight = decay_weight(node)
        assert weight < 0.3

    def test_half_life_is_30_days(self):
        """At exactly one half-life, decay should be ~0.5 (times frequency)."""
        node = make_node("half", days_ago=DECAY_HALF_LIFE_DAYS, unique_sessions=1)
        weight = decay_weight(node)
        # 0.5^1 * log(2) ≈ 0.5 * 0.693 ≈ 0.347
        assert 0.2 < weight < 0.6

    def test_decay_never_reaches_zero(self):
        """Even very old nodes should have a positive weight."""
        node = make_node("ancient", days_ago=365)
        weight = decay_weight(node)
        assert weight > 0

    def test_frequency_boost(self):
        """Nodes accessed from many sessions should score higher."""
        one_session = make_node("low_freq", days_ago=15, unique_sessions=1)
        many_sessions = make_node("high_freq", days_ago=15, unique_sessions=10)
        w_low = decay_weight(one_session)
        w_high = decay_weight(many_sessions)
        assert w_high > w_low

    def test_fallback_on_missing_timestamps(self):
        """Nodes without last_accessed should still get a decay score."""
        node = MemoryNode(
            id="no_ts", content="test", timestamp="2026-01-01",
            metadata={"type": "pattern"},
        )
        # Should not raise
        weight = decay_weight(node)
        assert weight > 0

    def test_explicit_now(self):
        """Passing explicit now should work."""
        node = make_node("test", days_ago=0)
        future = datetime.now() + timedelta(days=60)
        weight = decay_weight(node, now=future)
        # 60 days from now, the node is stale
        assert weight < 0.5


class TestSalienceTiers:
    """Test salience-based filtering."""

    def test_active_is_retrievable(self):
        node = make_node("active", salience="active")
        assert is_retrievable(node) is True

    def test_background_is_retrievable(self):
        node = make_node("bg", salience="background")
        assert is_retrievable(node) is True

    def test_dormant_is_not_retrievable(self):
        node = make_node("dormant", salience="dormant")
        assert is_retrievable(node) is False

    def test_default_salience_is_retrievable(self):
        """Nodes without salience field should default to active."""
        node = MemoryNode(id="old", content="test", timestamp="2026-01-01",
                          metadata={"type": "pattern"})
        assert is_retrievable(node) is True


class TestRecordAccess:
    """Test access recording."""

    def test_updates_last_accessed(self, tmp_graph):
        node = make_node("pat-001")
        tmp_graph.add_node(node)
        record_access(tmp_graph, ["pat-001"], session_id="sess-1")
        assert "last_accessed" in node.metadata

    def test_increments_access_count(self, tmp_graph):
        node = make_node("pat-001")
        node.metadata["access_count"] = 0
        tmp_graph.add_node(node)
        record_access(tmp_graph, ["pat-001"], session_id="sess-1")
        assert node.metadata["access_count"] == 1
        record_access(tmp_graph, ["pat-001"], session_id="sess-1")
        assert node.metadata["access_count"] == 2

    def test_tracks_unique_sessions(self, tmp_graph):
        node = make_node("pat-001")
        node.metadata["unique_sessions"] = 0
        node.metadata["accessed_sessions"] = []
        tmp_graph.add_node(node)
        record_access(tmp_graph, ["pat-001"], session_id="sess-1")
        record_access(tmp_graph, ["pat-001"], session_id="sess-1")  # same session
        record_access(tmp_graph, ["pat-001"], session_id="sess-2")  # new session
        assert node.metadata["unique_sessions"] == 2

    def test_skips_nonexistent_nodes(self, tmp_graph):
        """Should not raise for missing node IDs."""
        record_access(tmp_graph, ["nonexistent"], session_id="sess-1")


class TestDemotePromote:
    """Test the demote/promote CLI commands."""

    def test_demote_dry_run(self, tmp_graph, capsys):
        from brainiac.cli import cmd_demote
        node = make_node("pat-001", days_ago=60)
        tmp_graph.add_node(node)
        cmd_demote(tmp_graph, stale_days=30, dry_run=True)
        output = capsys.readouterr().out
        assert "pat-001" in output
        assert "DEMOTION candidates" in output
        # Should NOT actually demote in dry run
        assert node.metadata.get("salience", "active") != "dormant"

    def test_demote_apply(self, tmp_graph):
        from brainiac.cli import cmd_demote
        node = make_node("pat-001", days_ago=60)
        tmp_graph.add_node(node)
        tmp_graph.save()
        cmd_demote(tmp_graph, stale_days=30, dry_run=False)
        assert node.metadata["salience"] == "dormant"
        assert "demoted_at" in node.metadata

    def test_demote_skips_recently_accessed(self, tmp_graph, capsys):
        from brainiac.cli import cmd_demote
        node = make_node("pat-001", days_ago=5)
        tmp_graph.add_node(node)
        cmd_demote(tmp_graph, stale_days=30, dry_run=True)
        output = capsys.readouterr().out
        assert "Graph is fresh" in output

    def test_promote_from_dormant(self, tmp_graph, capsys):
        from brainiac.cli import cmd_promote
        node = make_node("pat-001", salience="dormant")
        tmp_graph.add_node(node)
        tmp_graph.save()
        cmd_promote(tmp_graph, "pat-001", "active")
        assert node.metadata["salience"] == "active"

    def test_promote_invalid_salience(self, tmp_graph, capsys):
        from brainiac.cli import cmd_promote
        node = make_node("pat-001")
        tmp_graph.add_node(node)
        cmd_promote(tmp_graph, "pat-001", "invalid")
        output = capsys.readouterr().out
        assert "Error" in output


class TestRerankWithDecay:
    """Test that rerank integrates temporal decay."""

    def test_stale_node_ranks_lower(self):
        """A stale node with same similarity should rank below a fresh one."""
        fresh = make_node("fresh", days_ago=1, unique_sessions=3)
        stale = make_node("stale", days_ago=90, unique_sessions=1)

        results = [
            RetrievalResult(node=stale, score=0.5, path=["stale"], relations=[]),
            RetrievalResult(node=fresh, score=0.5, path=["fresh"], relations=[]),
        ]

        # Same embedding for both (identical similarity)
        query_vec = [1.0] + [0.0] * 383
        embs = {
            "fresh": [1.0] + [0.0] * 383,
            "stale": [1.0] + [0.0] * 383,
        }

        reranked = rerank(results, query_vec, embs)
        assert reranked[0].node.id == "fresh"
        assert reranked[0].score > reranked[1].score
