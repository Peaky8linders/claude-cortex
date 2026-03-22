"""Tests for brainiac consolidator module."""

import pytest
from datetime import datetime, timedelta
from brainiac.graph import BrainiacGraph, MemoryNode
from brainiac.consolidator import find_stale_nodes, evolve_context


@pytest.fixture
def tmp_graph(tmp_path):
    return BrainiacGraph(graph_dir=tmp_path)


class TestStaleNodes:
    def test_old_node_with_few_links_is_stale(self, tmp_graph):
        old_date = (datetime.now() - timedelta(days=90)).isoformat(timespec="seconds")
        tmp_graph.add_node(MemoryNode(
            id="pat-001", content="Old", timestamp=old_date,
            links=[], metadata={"type": "pattern", "updated": old_date}
        ))
        stale = find_stale_nodes(tmp_graph, days=60)
        assert len(stale) == 1
        assert stale[0].id == "pat-001"

    def test_recent_node_not_stale(self, tmp_graph):
        tmp_graph.add_node(MemoryNode(
            id="pat-001", content="Recent", timestamp=datetime.now().isoformat(timespec="seconds"),
            metadata={"type": "pattern"}
        ))
        assert find_stale_nodes(tmp_graph, days=60) == []

    def test_old_node_with_many_links_not_stale(self, tmp_graph):
        old_date = (datetime.now() - timedelta(days=90)).isoformat(timespec="seconds")
        tmp_graph.add_node(MemoryNode(
            id="pat-001", content="Old but connected", timestamp=old_date,
            links=["a", "b", "c"], metadata={"type": "pattern", "updated": old_date}
        ))
        assert find_stale_nodes(tmp_graph, days=60) == []


class TestEvolveContext:
    def test_evolve_appends_relationship_note(self, tmp_graph):
        tmp_graph.add_node(MemoryNode(
            id="pat-001", content="Existing", timestamp="2026-01-01",
            context="Original context", metadata={"type": "pattern"}
        ))
        new_node = MemoryNode(
            id="pat-002", content="New", timestamp="2026-01-02",
            keywords=["fast", "cache"], links=["pat-001"], metadata={"type": "pattern"}
        )
        tmp_graph.add_node(new_node)
        evolve_context(tmp_graph, new_node)
        assert "pat-002" in tmp_graph.get_node("pat-001").context

    def test_evolve_no_duplicate_notes(self, tmp_graph):
        tmp_graph.add_node(MemoryNode(
            id="pat-001", content="Existing", timestamp="2026-01-01",
            context="Original context", metadata={"type": "pattern"}
        ))
        new_node = MemoryNode(
            id="pat-002", content="New", timestamp="2026-01-02",
            keywords=["x"], links=["pat-001"], metadata={"type": "pattern"}
        )
        tmp_graph.add_node(new_node)
        evolve_context(tmp_graph, new_node)
        evolve_context(tmp_graph, new_node)  # Second call
        ctx = tmp_graph.get_node("pat-001").context
        assert ctx.count("pat-002") == 1  # Not duplicated
