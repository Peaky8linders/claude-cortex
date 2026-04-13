"""Tests for brainiac clusters module."""

import pytest
import numpy as np
from collections import Counter

from brainiac.graph import BrainiacGraph, MemoryNode, Edge
from brainiac.clusters import (
    compute_distance_matrix,
    run_clustering,
    label_cluster,
    find_representatives,
    compute_cross_cluster_edges,
    build_report,
    generate_report_markdown,
    Cluster,
    CrossClusterLink,
)


@pytest.fixture
def tmp_graph(tmp_path):
    return BrainiacGraph(graph_dir=tmp_path)


def _make_embedding(group: int, dim: int = 384) -> list[float]:
    """Create a deterministic normalized embedding for a group.

    Nodes in the same group get similar embeddings (cosine sim ~0.95+).
    Nodes in different groups get dissimilar embeddings (cosine sim ~0.0).
    """
    vec = np.zeros(dim, dtype=np.float32)
    # Spread groups across dimensions
    start = group * 20
    for i in range(start, min(start + 20, dim)):
        vec[i] = 1.0
    # Add small noise for intra-group variation
    rng = np.random.RandomState(group * 1000 + hash(str(group)) % 100)
    vec += rng.randn(dim) * 0.05
    # Normalize
    norm = np.linalg.norm(vec)
    if norm > 0:
        vec /= norm
    return vec.tolist()


def _make_node(nid: str, ntype: str = "pattern", keywords: list = None,
               tags: list = None, projects: list = None) -> MemoryNode:
    return MemoryNode(
        id=nid,
        content=f"Content for {nid}",
        timestamp="2026-01-01T00:00:00",
        keywords=keywords or [],
        tags=tags or [],
        metadata={
            "type": ntype,
            "projects": projects or [],
        },
    )


# --- compute_distance_matrix ---

class TestComputeDistanceMatrix:
    def test_two_identical_embeddings(self):
        emb = [1.0] + [0.0] * 383
        all_embs = {"a": emb, "b": emb}
        condensed, ids = compute_distance_matrix(all_embs)
        assert len(ids) == 2
        assert len(condensed) == 1
        assert condensed[0] == pytest.approx(0.0, abs=1e-5)

    def test_two_orthogonal_embeddings(self):
        emb_a = [1.0] + [0.0] * 383
        emb_b = [0.0, 1.0] + [0.0] * 382
        all_embs = {"a": emb_a, "b": emb_b}
        condensed, ids = compute_distance_matrix(all_embs)
        assert condensed[0] == pytest.approx(1.0, abs=1e-5)

    def test_single_node_returns_empty(self):
        all_embs = {"a": [1.0] + [0.0] * 383}
        condensed, ids = compute_distance_matrix(all_embs)
        assert len(condensed) == 0
        assert ids == ["a"]

    def test_empty_returns_empty(self):
        condensed, ids = compute_distance_matrix({})
        assert len(condensed) == 0
        assert ids == []


# --- run_clustering ---

class TestRunClustering:
    def test_two_obvious_clusters(self):
        """Two groups of similar embeddings should form two clusters."""
        all_embs = {}
        for i in range(3):
            all_embs[f"a-{i}"] = _make_embedding(0)
        for i in range(3):
            all_embs[f"b-{i}"] = _make_embedding(1)

        condensed, ids = compute_distance_matrix(all_embs)
        assignment = run_clustering(condensed, ids, threshold=0.5, min_size=2)

        # All a-nodes should be in one cluster, all b-nodes in another
        a_clusters = {assignment[f"a-{i}"] for i in range(3)}
        b_clusters = {assignment[f"b-{i}"] for i in range(3)}
        assert len(a_clusters) == 1  # All in same cluster
        assert len(b_clusters) == 1
        assert a_clusters != b_clusters  # Different clusters

    def test_single_node_is_orphan(self):
        all_embs = {"a": [1.0] + [0.0] * 383}
        condensed, ids = compute_distance_matrix(all_embs)
        assignment = run_clustering(condensed, ids)
        assert assignment["a"] == -1

    def test_min_size_filters_small_clusters(self):
        """A cluster of 1 node should be marked as orphan when min_size=2."""
        emb_group = _make_embedding(0)
        outlier = _make_embedding(5)
        all_embs = {"a": emb_group, "b": emb_group, "c": outlier}
        condensed, ids = compute_distance_matrix(all_embs)
        assignment = run_clustering(condensed, ids, threshold=0.5, min_size=2)
        # c should be orphan
        assert assignment["c"] == -1


# --- label_cluster ---

class TestLabelCluster:
    def test_labels_from_keywords(self, tmp_graph):
        tmp_graph.add_node(_make_node("pat-001", keywords=["Cache", "Redis", "Fast"]))
        tmp_graph.add_node(_make_node("pat-002", keywords=["Cache", "Memory", "Redis"]))
        label, dtype, top_kw = label_cluster(tmp_graph, ["pat-001", "pat-002"])
        assert "Cache" in label
        assert "Redis" in label
        assert dtype == "pattern"

    def test_empty_cluster(self, tmp_graph):
        label, dtype, top_kw = label_cluster(tmp_graph, [])
        assert label == "Unnamed"


# --- find_representatives ---

class TestFindRepresentatives:
    def test_highest_degree_first(self, tmp_graph):
        tmp_graph.add_node(_make_node("a"))
        tmp_graph.add_node(_make_node("b"))
        tmp_graph.add_node(_make_node("c"))
        # a has 2 edges, b has 1, c has 0
        tmp_graph.add_edge(Edge(source="a", target="b", relation="semantic"))
        tmp_graph.add_edge(Edge(source="a", target="c", relation="semantic"))
        reps = find_representatives(tmp_graph, ["a", "b", "c"], k=2)
        assert reps[0] == "a"
        assert len(reps) == 2

    def test_k_larger_than_cluster(self, tmp_graph):
        tmp_graph.add_node(_make_node("a"))
        reps = find_representatives(tmp_graph, ["a"], k=5)
        assert reps == ["a"]


# --- compute_cross_cluster_edges ---

class TestCrossClusterEdges:
    def test_finds_cross_edges(self, tmp_graph):
        tmp_graph.add_node(_make_node("a"))
        tmp_graph.add_node(_make_node("b"))
        tmp_graph.add_edge(Edge(source="a", target="b", relation="semantic", weight=0.8))

        clusters = [
            Cluster(id=1, label="Group A", node_ids=["a"], dominant_type="pattern",
                    top_keywords=["x"]),
            Cluster(id=2, label="Group B", node_ids=["b"], dominant_type="pattern",
                    top_keywords=["y"]),
        ]
        links = compute_cross_cluster_edges(tmp_graph, clusters)
        assert len(links) == 1
        assert links[0].edge_count == 1

    def test_ignores_intra_edges(self, tmp_graph):
        tmp_graph.add_node(_make_node("a"))
        tmp_graph.add_node(_make_node("b"))
        tmp_graph.add_edge(Edge(source="a", target="b", relation="semantic"))

        clusters = [
            Cluster(id=1, label="Same", node_ids=["a", "b"], dominant_type="pattern",
                    top_keywords=["x"]),
        ]
        links = compute_cross_cluster_edges(tmp_graph, clusters)
        assert len(links) == 0


# --- build_report ---

class TestBuildReport:
    def test_basic_report(self, tmp_graph):
        tmp_graph.add_node(_make_node("pat-001", keywords=["Cache"]))
        tmp_graph.add_node(_make_node("pat-002", keywords=["Cache"]))
        tmp_graph.add_node(_make_node("sol-001", keywords=["Deploy"]))

        assignment = {"pat-001": 1, "pat-002": 1, "sol-001": -1}
        report = build_report(tmp_graph, assignment)
        assert len(report.clusters) == 1
        assert len(report.orphan_node_ids) == 1
        assert "sol-001" in report.orphan_node_ids


# --- generate_report_markdown ---

class TestGenerateReport:
    def test_contains_expected_sections(self, tmp_graph):
        tmp_graph.add_node(_make_node("pat-001", keywords=["Cache", "Redis"]))
        tmp_graph.add_node(_make_node("pat-002", keywords=["Cache"]))
        tmp_graph.add_node(_make_node("sol-001", keywords=["Deploy"]))
        tmp_graph.add_edge(Edge(source="pat-001", target="sol-001", relation="semantic", weight=0.7))

        assignment = {"pat-001": 1, "pat-002": 1, "sol-001": -1}
        report = build_report(tmp_graph, assignment)
        md = generate_report_markdown(tmp_graph, report)

        assert "# Knowledge Graph Report" in md
        assert "## Domains" in md
        assert "Cache" in md
        assert "## Unclustered Nodes" in md
        assert "sol-001" in md
