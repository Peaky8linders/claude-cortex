"""Comprehensive tests for brainiac graph engine."""

import json
import pytest
from pathlib import Path
from brainiac.graph import BrainiacGraph, MemoryNode, Edge


@pytest.fixture
def tmp_graph(tmp_path):
    """Create a graph with a temporary directory."""
    return BrainiacGraph(graph_dir=tmp_path)


@pytest.fixture
def populated_graph(tmp_graph):
    """Graph with 3 nodes and edges."""
    g = tmp_graph
    n1 = MemoryNode(id="pat-001", content="Pattern one", timestamp="2026-03-01",
                    keywords=["arch"], tags=["testing"], metadata={"type": "pattern", "projects": ["proj-a"]})
    n2 = MemoryNode(id="pat-002", content="Pattern two", timestamp="2026-03-02",
                    keywords=["design"], tags=["testing"], metadata={"type": "pattern", "projects": ["proj-a"]})
    n3 = MemoryNode(id="anti-001", content="Antipattern one", timestamp="2026-03-03",
                    keywords=["bad"], tags=["quality"], metadata={"type": "antipattern", "projects": ["proj-b"]})
    g.add_node(n1)
    g.add_node(n2)
    g.add_node(n3)
    g.add_edge(Edge(source="pat-001", target="pat-002", relation="semantic", weight=0.85))
    g.add_edge(Edge(source="pat-001", target="anti-001", relation="causal", weight=1.0))
    return g


# --- Node CRUD ---

class TestNodeCRUD:
    def test_add_node(self, tmp_graph):
        node = MemoryNode(id="pat-001", content="Test", timestamp="2026-01-01")
        result = tmp_graph.add_node(node)
        assert result.id == "pat-001"
        assert tmp_graph.get_node("pat-001") is node

    def test_add_duplicate_raises(self, tmp_graph):
        tmp_graph.add_node(MemoryNode(id="pat-001", content="A", timestamp="2026-01-01"))
        with pytest.raises(ValueError, match="already exists"):
            tmp_graph.add_node(MemoryNode(id="pat-001", content="B", timestamp="2026-01-02"))

    def test_update_node(self, tmp_graph):
        tmp_graph.add_node(MemoryNode(id="pat-001", content="Old", timestamp="2026-01-01"))
        tmp_graph.update_node("pat-001", content="New", tags=["updated"])
        node = tmp_graph.get_node("pat-001")
        assert node.content == "New"
        assert node.tags == ["updated"]

    def test_update_nonexistent_raises(self, tmp_graph):
        with pytest.raises(KeyError, match="not found"):
            tmp_graph.update_node("nope", content="X")

    def test_delete_node_removes_edges_and_links(self, populated_graph):
        g = populated_graph
        g.delete_node("pat-001")
        assert g.get_node("pat-001") is None
        assert all(e.source != "pat-001" and e.target != "pat-001" for e in g.edges)
        assert "pat-001" not in g.get_node("pat-002").links
        assert "pat-001" not in g.get_node("anti-001").links

    def test_delete_nonexistent_is_noop(self, tmp_graph):
        tmp_graph.delete_node("does-not-exist")  # Should not raise

    def test_get_nonexistent_returns_none(self, tmp_graph):
        assert tmp_graph.get_node("nope") is None


# --- Edge CRUD ---

class TestEdgeCRUD:
    def test_add_edge_updates_links(self, tmp_graph):
        tmp_graph.add_node(MemoryNode(id="a", content="A", timestamp="2026-01-01"))
        tmp_graph.add_node(MemoryNode(id="b", content="B", timestamp="2026-01-01"))
        tmp_graph.add_edge(Edge(source="a", target="b", relation="semantic"))
        assert "b" in tmp_graph.get_node("a").links
        assert "a" in tmp_graph.get_node("b").links

    def test_edge_deduplication_updates_weight(self, tmp_graph):
        tmp_graph.add_node(MemoryNode(id="a", content="A", timestamp="2026-01-01"))
        tmp_graph.add_node(MemoryNode(id="b", content="B", timestamp="2026-01-01"))
        tmp_graph.add_edge(Edge(source="a", target="b", relation="semantic", weight=0.5))
        tmp_graph.add_edge(Edge(source="a", target="b", relation="semantic", weight=0.9))
        assert len(tmp_graph.edges) == 1
        assert tmp_graph.edges[0].weight == 0.9  # max(0.5, 0.9)

    def test_edge_different_relations_not_deduped(self, tmp_graph):
        tmp_graph.add_node(MemoryNode(id="a", content="A", timestamp="2026-01-01"))
        tmp_graph.add_node(MemoryNode(id="b", content="B", timestamp="2026-01-01"))
        tmp_graph.add_edge(Edge(source="a", target="b", relation="semantic"))
        tmp_graph.add_edge(Edge(source="a", target="b", relation="temporal"))
        assert len(tmp_graph.edges) == 2

    def test_remove_edge(self, populated_graph):
        populated_graph.remove_edge("pat-001", "pat-002", "semantic")
        assert not any(e.source == "pat-001" and e.target == "pat-002" and e.relation == "semantic"
                       for e in populated_graph.edges)

    def test_remove_edge_with_relation_filter(self, tmp_graph):
        tmp_graph.add_node(MemoryNode(id="a", content="A", timestamp="2026-01-01"))
        tmp_graph.add_node(MemoryNode(id="b", content="B", timestamp="2026-01-01"))
        tmp_graph.add_edge(Edge(source="a", target="b", relation="semantic"))
        tmp_graph.add_edge(Edge(source="a", target="b", relation="causal"))
        tmp_graph.remove_edge("a", "b", "semantic")
        assert len(tmp_graph.edges) == 1
        assert tmp_graph.edges[0].relation == "causal"


# --- Queries ---

class TestQueries:
    def test_by_type(self, populated_graph):
        patterns = populated_graph.by_type("pattern")
        assert len(patterns) == 2
        assert all(n.metadata["type"] == "pattern" for n in patterns)

    def test_by_tag(self, populated_graph):
        testing = populated_graph.by_tag("testing")
        assert len(testing) == 2

    def test_by_project(self, populated_graph):
        proj_a = populated_graph.by_project("proj-a")
        assert len(proj_a) == 2

    def test_neighbors(self, populated_graph):
        neighbors = populated_graph.neighbors("pat-001")
        ids = {n.id for n in neighbors}
        assert ids == {"pat-002", "anti-001"}

    def test_neighbors_with_relation_filter(self, populated_graph):
        semantic_neighbors = populated_graph.neighbors("pat-001", relation="semantic")
        assert len(semantic_neighbors) == 1
        assert semantic_neighbors[0].id == "pat-002"

    def test_edges_for(self, populated_graph):
        edges = populated_graph.edges_for("pat-001")
        assert len(edges) == 2

    def test_edges_for_with_relation(self, populated_graph):
        causal = populated_graph.edges_for("pat-001", relation="causal")
        assert len(causal) == 1
        assert causal[0].target == "anti-001"


# --- Persistence ---

class TestPersistence:
    def test_save_and_reload(self, tmp_path):
        g1 = BrainiacGraph(graph_dir=tmp_path)
        g1.add_node(MemoryNode(id="pat-001", content="Test", timestamp="2026-01-01",
                               metadata={"type": "pattern"}))
        g1.add_edge(Edge(source="pat-001", target="pat-001", relation="semantic"))
        g1.save()

        g2 = BrainiacGraph(graph_dir=tmp_path)
        assert g2.get_node("pat-001") is not None
        assert g2.get_node("pat-001").content == "Test"
        assert len(g2.edges) == 1

    def test_corrupted_nodes_json_recovers(self, tmp_path):
        (tmp_path / "nodes.json").write_text("NOT VALID JSON", encoding="utf-8")
        g = BrainiacGraph(graph_dir=tmp_path)
        assert len(g.nodes) == 0

    def test_corrupted_edges_json_recovers(self, tmp_path):
        (tmp_path / "nodes.json").write_text("[]", encoding="utf-8")
        (tmp_path / "edges.json").write_text("{bad}", encoding="utf-8")
        g = BrainiacGraph(graph_dir=tmp_path)
        assert len(g.edges) == 0

    def test_empty_graph_dir(self, tmp_path):
        g = BrainiacGraph(graph_dir=tmp_path)
        assert len(g.nodes) == 0
        assert len(g.edges) == 0

    def test_node_to_dict_excludes_embedding(self):
        node = MemoryNode(id="test", content="X", timestamp="2026-01-01",
                          embedding=[0.1, 0.2, 0.3])
        d = node.to_dict()
        assert "embedding" not in d

    def test_node_from_dict_handles_missing_fields(self):
        d = {"id": "test", "content": "X", "timestamp": "2026-01-01"}
        node = MemoryNode.from_dict(d)
        assert node.embedding == []
        assert node.links == []
        assert node.tags == []


# --- ID Generation ---

class TestIDGeneration:
    def test_next_id_empty_graph(self, tmp_graph):
        assert tmp_graph.next_id("pattern") == "pat-001"
        assert tmp_graph.next_id("antipattern") == "anti-001"
        assert tmp_graph.next_id("workflow") == "wf-001"
        assert tmp_graph.next_id("hypothesis") == "hyp-001"
        assert tmp_graph.next_id("solution") == "sol-001"
        assert tmp_graph.next_id("decision") == "dec-001"

    def test_next_id_sequential(self, tmp_graph):
        tmp_graph.add_node(MemoryNode(id="pat-001", content="A", timestamp="2026-01-01",
                                      metadata={"type": "pattern"}))
        tmp_graph.add_node(MemoryNode(id="pat-002", content="B", timestamp="2026-01-01",
                                      metadata={"type": "pattern"}))
        assert tmp_graph.next_id("pattern") == "pat-003"

    def test_next_id_unknown_type_uses_mem_prefix(self, tmp_graph):
        assert tmp_graph.next_id("unknown_type") == "mem-001"

    def test_next_id_handles_gaps(self, tmp_graph):
        tmp_graph.add_node(MemoryNode(id="pat-001", content="A", timestamp="2026-01-01",
                                      metadata={"type": "pattern"}))
        tmp_graph.add_node(MemoryNode(id="pat-005", content="B", timestamp="2026-01-01",
                                      metadata={"type": "pattern"}))
        assert tmp_graph.next_id("pattern") == "pat-006"


# --- Stats ---

class TestStats:
    def test_stats_empty_graph(self, tmp_graph):
        s = tmp_graph.stats()
        assert s["total_nodes"] == 0
        assert s["total_edges"] == 0

    def test_stats_populated(self, populated_graph):
        s = populated_graph.stats()
        assert s["total_nodes"] == 3
        assert s["total_edges"] == 2
        assert s["nodes_by_type"]["pattern"] == 2
        assert s["nodes_by_type"]["antipattern"] == 1
        assert "semantic" in s["edges_by_relation"]
        assert "causal" in s["edges_by_relation"]
        assert len(s["most_connected"]) > 0

    def test_stats_orphan_count(self, tmp_graph):
        """Nodes with no edges should be counted as orphans."""
        tmp_graph.add_node(MemoryNode(id="pat-001", content="Connected", timestamp="2026-01-01",
                                       metadata={"type": "pattern"}))
        tmp_graph.add_node(MemoryNode(id="pat-002", content="Connected", timestamp="2026-01-01",
                                       metadata={"type": "pattern"}))
        tmp_graph.add_node(MemoryNode(id="pat-003", content="Orphan", timestamp="2026-01-01",
                                       metadata={"type": "pattern"}))
        tmp_graph.add_edge(Edge(source="pat-001", target="pat-002", relation="semantic"))
        s = tmp_graph.stats()
        assert s["orphan_count"] == 1

    def test_stats_no_orphans(self, populated_graph):
        """All nodes in populated_graph are connected."""
        s = populated_graph.stats()
        assert s["orphan_count"] == 0


# --- Adjacency Index ---

class TestAdjacencyIndex:
    def test_edges_for_uses_index(self, populated_graph):
        """edges_for should return correct results from adjacency index."""
        edges = populated_graph.edges_for("pat-001")
        assert len(edges) == 2
        relations = {e.relation for e in edges}
        assert relations == {"semantic", "causal"}

    def test_adjacency_index_after_delete(self, populated_graph):
        """Adjacency index should be rebuilt after node deletion."""
        populated_graph.delete_node("pat-002")
        edges = populated_graph.edges_for("pat-001")
        assert len(edges) == 1
        assert edges[0].relation == "causal"

    def test_adjacency_index_after_edge_remove(self, populated_graph):
        """Adjacency index should be rebuilt after edge removal."""
        populated_graph.remove_edge("pat-001", "pat-002", "semantic")
        edges = populated_graph.edges_for("pat-001")
        assert len(edges) == 1

    def test_adjacency_index_on_load(self, tmp_path):
        """Adjacency index should be built from loaded data."""
        g1 = BrainiacGraph(graph_dir=tmp_path)
        g1.add_node(MemoryNode(id="a", content="A", timestamp="2026-01-01"))
        g1.add_node(MemoryNode(id="b", content="B", timestamp="2026-01-01"))
        g1.add_edge(Edge(source="a", target="b", relation="semantic"))
        g1.save()

        g2 = BrainiacGraph(graph_dir=tmp_path)
        assert len(g2.edges_for("a")) == 1
        assert len(g2.edges_for("b")) == 1


# --- Atomic Save ---

class TestAtomicSave:
    def test_directory_level_atomic_save(self, tmp_path):
        """Both nodes.json and edges.json should be written together."""
        g = BrainiacGraph(graph_dir=tmp_path)
        g.add_node(MemoryNode(id="pat-001", content="Test", timestamp="2026-01-01"))
        g.add_edge(Edge(source="pat-001", target="pat-001", relation="semantic"))
        g.save()

        # Both files should exist and be valid JSON
        nodes = json.loads((tmp_path / "nodes.json").read_text(encoding="utf-8"))
        edges = json.loads((tmp_path / "edges.json").read_text(encoding="utf-8"))
        assert len(nodes) == 1
        assert len(edges) == 1

    def test_no_temp_files_after_save(self, tmp_path):
        """No .tmp or .save- directories should remain after save."""
        g = BrainiacGraph(graph_dir=tmp_path)
        g.add_node(MemoryNode(id="pat-001", content="Test", timestamp="2026-01-01"))
        g.save()

        remaining = list(tmp_path.glob(".save-*"))
        assert len(remaining) == 0
