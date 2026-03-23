"""Tests for brainiac quality command."""

import io
import sys

import pytest

from brainiac.graph import BrainiacGraph, MemoryNode, Edge
from brainiac.cli import cmd_quality


@pytest.fixture
def temp_graph(tmp_path):
    """Create a temporary graph directory."""
    graph_dir = tmp_path / "graph"
    graph_dir.mkdir()
    (graph_dir / "nodes.json").write_text("[]")
    (graph_dir / "edges.json").write_text("[]")
    return BrainiacGraph(graph_dir=graph_dir)


def run_quality(graph, verbose=False) -> str:
    """Run cmd_quality and return captured stdout."""
    captured = io.StringIO()
    old_stdout = sys.stdout
    sys.stdout = captured
    try:
        cmd_quality(graph, verbose=verbose)
    finally:
        sys.stdout = old_stdout
    return captured.getvalue().strip()


class TestQualityCommand:
    """Test the quality scoring logic (mirrors computeQualityScore from TS)."""

    def test_empty_graph_baseline(self, temp_graph):
        """Empty graph should score baseline 70."""
        score = int(run_quality(temp_graph))
        assert score == 70, f"Empty graph should score 70, got {score}"

    def test_decision_nodes_boost(self, temp_graph):
        """Decision nodes should boost score (+3 each, max +15)."""
        for i in range(3):
            temp_graph.nodes[f"dec-{i:03d}"] = MemoryNode(
                id=f"dec-{i:03d}", content=f"Decision {i}",
                timestamp="2026-01-01", metadata={"type": "decision"},
            )
        temp_graph.save()
        score = int(run_quality(temp_graph))
        # 70 base + 9 (3 decisions * 3) - 6 (3 orphans * 2) = 73
        assert score == 73, f"3 decisions should score 73, got {score}"

    def test_solution_nodes_boost(self, temp_graph):
        """Solution nodes should boost score (+5 each, max +10)."""
        for i in range(2):
            temp_graph.nodes[f"sol-{i:03d}"] = MemoryNode(
                id=f"sol-{i:03d}", content=f"Solution {i}",
                timestamp="2026-01-01", metadata={"type": "solution"},
            )
        temp_graph.save()
        score = int(run_quality(temp_graph))
        # 70 base + 10 (2 solutions * 5) - 4 (2 orphans * 2) = 76
        assert score == 76, f"2 solutions should score 76, got {score}"

    def test_edge_density_bonus(self, temp_graph):
        """Good edge density (>= 1.5 edges/node) should add +5."""
        for i in range(2):
            temp_graph.nodes[f"pat-{i:03d}"] = MemoryNode(
                id=f"pat-{i:03d}", content=f"Pattern {i}",
                timestamp="2026-01-01", metadata={"type": "pattern"},
            )
        for i in range(3):
            temp_graph.edges.append(Edge(
                source="pat-000", target="pat-001",
                relation="semantic", weight=1.0,
            ))
        temp_graph.save()
        score = int(run_quality(temp_graph))
        # 70 base + 5 (edge density) + 0 orphans (both connected) = 75
        assert score == 75, f"Good edge density should score 75, got {score}"

    def test_orphan_penalty(self, temp_graph):
        """Orphaned nodes should penalize score (-2 each, max -15)."""
        for i in range(8):
            temp_graph.nodes[f"pat-{i:03d}"] = MemoryNode(
                id=f"pat-{i:03d}", content=f"Pattern {i}",
                timestamp="2026-01-01", metadata={"type": "pattern"},
            )
        temp_graph.save()
        score = int(run_quality(temp_graph))
        # 70 base - 15 (8 orphans * 2 = 16, capped at 15) = 55
        assert score == 55, f"8 orphans should score 55, got {score}"

    def test_score_clamped_0_100(self, temp_graph):
        """Score should always be between 0 and 100."""
        score = int(run_quality(temp_graph))
        assert 0 <= score <= 100, f"Score {score} out of range"

    def test_verbose_output(self, temp_graph):
        """verbose=True should show detailed breakdown."""
        output = run_quality(temp_graph, verbose=True)
        assert "Quality:" in output
        assert "Nodes:" in output
        assert "Edges:" in output
