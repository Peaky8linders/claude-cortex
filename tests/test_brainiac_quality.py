"""Tests for brainiac quality command."""

import json
import tempfile
from pathlib import Path

import pytest

from brainiac.graph import BrainiacGraph, MemoryNode, Edge


@pytest.fixture
def temp_graph(tmp_path):
    """Create a temporary graph directory."""
    graph_dir = tmp_path / "graph"
    graph_dir.mkdir()
    (graph_dir / "nodes.json").write_text("[]")
    (graph_dir / "edges.json").write_text("[]")
    return BrainiacGraph(graph_dir=graph_dir)


class TestQualityCommand:
    """Test the quality scoring logic (mirrors computeQualityScore from TS)."""

    def test_empty_graph_baseline(self, temp_graph):
        """Empty graph should score baseline 70."""
        from brainiac.cli import cmd_quality
        import io
        import sys

        # Capture stdout
        captured = io.StringIO()
        old_stdout = sys.stdout
        old_argv = sys.argv
        sys.stdout = captured
        sys.argv = ["brainiac", "quality"]

        try:
            cmd_quality(temp_graph)
        finally:
            sys.stdout = old_stdout
            sys.argv = old_argv

        score = int(captured.getvalue().strip())
        assert score == 70, f"Empty graph should score 70, got {score}"

    def test_decision_nodes_boost(self, temp_graph):
        """Decision nodes should boost score (+3 each, max +15)."""
        for i in range(3):
            node = MemoryNode(
                id=f"dec-{i:03d}",
                content=f"Decision {i}",
                timestamp="2026-01-01",
                metadata={"type": "decision"},
            )
            temp_graph.nodes[node.id] = node
        temp_graph.save()

        from brainiac.cli import cmd_quality
        import io, sys

        captured = io.StringIO()
        old_stdout, old_argv = sys.stdout, sys.argv
        sys.stdout = captured
        sys.argv = ["brainiac", "quality"]
        try:
            cmd_quality(temp_graph)
        finally:
            sys.stdout = old_stdout
            sys.argv = old_argv

        score = int(captured.getvalue().strip())
        # 70 base + 9 (3 decisions * 3) - 6 (3 orphans * 2) = 73
        assert score == 73, f"3 decisions should score 73, got {score}"

    def test_solution_nodes_boost(self, temp_graph):
        """Solution nodes should boost score (+5 each, max +10)."""
        for i in range(2):
            node = MemoryNode(
                id=f"sol-{i:03d}",
                content=f"Solution {i}",
                timestamp="2026-01-01",
                metadata={"type": "solution"},
            )
            temp_graph.nodes[node.id] = node
        temp_graph.save()

        from brainiac.cli import cmd_quality
        import io, sys

        captured = io.StringIO()
        old_stdout, old_argv = sys.stdout, sys.argv
        sys.stdout = captured
        sys.argv = ["brainiac", "quality"]
        try:
            cmd_quality(temp_graph)
        finally:
            sys.stdout = old_stdout
            sys.argv = old_argv

        score = int(captured.getvalue().strip())
        # 70 base + 10 (2 solutions * 5) - 4 (2 orphans * 2) = 76
        assert score == 76, f"2 solutions should score 76, got {score}"

    def test_edge_density_bonus(self, temp_graph):
        """Good edge density (>= 1.5 edges/node) should add +5."""
        # Add 2 nodes with 3 edges (density = 1.5)
        for i in range(2):
            node = MemoryNode(
                id=f"pat-{i:03d}",
                content=f"Pattern {i}",
                timestamp="2026-01-01",
                metadata={"type": "pattern"},
            )
            temp_graph.nodes[node.id] = node

        for i in range(3):
            temp_graph.edges.append(Edge(
                source="pat-000", target="pat-001",
                relation="semantic", weight=1.0,
            ))
        temp_graph.save()

        from brainiac.cli import cmd_quality
        import io, sys

        captured = io.StringIO()
        old_stdout, old_argv = sys.stdout, sys.argv
        sys.stdout = captured
        sys.argv = ["brainiac", "quality"]
        try:
            cmd_quality(temp_graph)
        finally:
            sys.stdout = old_stdout
            sys.argv = old_argv

        score = int(captured.getvalue().strip())
        # 70 base + 5 (edge density) + 0 orphans (both connected) = 75
        assert score == 75, f"Good edge density should score 75, got {score}"

    def test_orphan_penalty(self, temp_graph):
        """Orphaned nodes should penalize score (-2 each, max -15)."""
        for i in range(8):
            node = MemoryNode(
                id=f"pat-{i:03d}",
                content=f"Pattern {i}",
                timestamp="2026-01-01",
                metadata={"type": "pattern"},
            )
            temp_graph.nodes[node.id] = node
        temp_graph.save()

        from brainiac.cli import cmd_quality
        import io, sys

        captured = io.StringIO()
        old_stdout, old_argv = sys.stdout, sys.argv
        sys.stdout = captured
        sys.argv = ["brainiac", "quality"]
        try:
            cmd_quality(temp_graph)
        finally:
            sys.stdout = old_stdout
            sys.argv = old_argv

        score = int(captured.getvalue().strip())
        # 70 base - 15 (8 orphans * 2 = 16, capped at 15) = 55
        assert score == 55, f"8 orphans should score 55, got {score}"

    def test_score_clamped_0_100(self, temp_graph):
        """Score should always be between 0 and 100."""
        from brainiac.cli import cmd_quality
        import io, sys

        captured = io.StringIO()
        old_stdout, old_argv = sys.stdout, sys.argv
        sys.stdout = captured
        sys.argv = ["brainiac", "quality"]
        try:
            cmd_quality(temp_graph)
        finally:
            sys.stdout = old_stdout
            sys.argv = old_argv

        score = int(captured.getvalue().strip())
        assert 0 <= score <= 100, f"Score {score} out of range"

    def test_verbose_output(self, temp_graph):
        """--verbose should show detailed breakdown."""
        from brainiac.cli import cmd_quality
        import io, sys

        captured = io.StringIO()
        old_stdout, old_argv = sys.stdout, sys.argv
        sys.stdout = captured
        sys.argv = ["brainiac", "quality", "--verbose"]
        try:
            cmd_quality(temp_graph)
        finally:
            sys.stdout = old_stdout
            sys.argv = old_argv

        output = captured.getvalue()
        assert "Quality:" in output
        assert "Nodes:" in output
        assert "Edges:" in output
