"""Tests for CLI commands: demote, promote, frontmatter parsing, command registry."""

from datetime import datetime, timedelta

import pytest

from brainiac.graph import BrainiacGraph, MemoryNode, Edge
from brainiac.cli import (
    cmd_demote, cmd_promote, _parse_frontmatter, COMMANDS,
    QUALITY_BASELINE, QUALITY_DECISION_WEIGHT, QUALITY_DECISION_CAP,
)


@pytest.fixture
def graph_with_stale_nodes(tmp_path):
    """Graph with nodes of varying staleness."""
    g = BrainiacGraph(graph_dir=tmp_path)
    now = datetime.now()

    # Fresh node (accessed today)
    g.add_node(MemoryNode(
        id="pat-001", content="Fresh pattern", timestamp=now.isoformat(timespec="seconds"),
        metadata={"type": "pattern", "salience": "active",
                  "last_accessed": now.isoformat(timespec="seconds")},
    ))

    # Stale node (accessed 60 days ago)
    stale_time = (now - timedelta(days=60)).isoformat(timespec="seconds")
    g.add_node(MemoryNode(
        id="pat-002", content="Stale pattern", timestamp=stale_time,
        metadata={"type": "pattern", "salience": "active",
                  "last_accessed": stale_time, "unique_sessions": 1},
    ))

    # Already dormant node
    g.add_node(MemoryNode(
        id="pat-003", content="Dormant pattern", timestamp=stale_time,
        metadata={"type": "pattern", "salience": "dormant",
                  "last_accessed": stale_time},
    ))

    return g


class TestDemote:
    def test_dry_run_lists_candidates(self, graph_with_stale_nodes, capsys):
        cmd_demote(graph_with_stale_nodes, stale_days=30, dry_run=True)
        output = capsys.readouterr().out
        assert "pat-002" in output
        assert "pat-001" not in output  # fresh node excluded
        assert "pat-003" not in output  # already dormant excluded

    def test_apply_demotes_nodes(self, graph_with_stale_nodes):
        cmd_demote(graph_with_stale_nodes, stale_days=30, dry_run=False)
        node = graph_with_stale_nodes.get_node("pat-002")
        assert node.metadata["salience"] == "dormant"
        assert "demoted_at" in node.metadata

    def test_apply_preserves_fresh_nodes(self, graph_with_stale_nodes):
        cmd_demote(graph_with_stale_nodes, stale_days=30, dry_run=False)
        fresh = graph_with_stale_nodes.get_node("pat-001")
        assert fresh.metadata["salience"] == "active"

    def test_no_candidates(self, graph_with_stale_nodes, capsys):
        cmd_demote(graph_with_stale_nodes, stale_days=365, dry_run=True)
        output = capsys.readouterr().out
        assert "Graph is fresh" in output


class TestPromote:
    def test_promote_dormant_to_active(self, graph_with_stale_nodes, capsys):
        cmd_promote(graph_with_stale_nodes, "pat-003", "active")
        node = graph_with_stale_nodes.get_node("pat-003")
        assert node.metadata["salience"] == "active"
        assert "demoted_at" not in node.metadata

    def test_promote_to_background(self, graph_with_stale_nodes, capsys):
        cmd_promote(graph_with_stale_nodes, "pat-003", "background")
        node = graph_with_stale_nodes.get_node("pat-003")
        assert node.metadata["salience"] == "background"

    def test_promote_invalid_salience(self, graph_with_stale_nodes, capsys):
        cmd_promote(graph_with_stale_nodes, "pat-003", "invalid")
        output = capsys.readouterr().out
        assert "Error" in output

    def test_promote_nonexistent_node(self, graph_with_stale_nodes, capsys):
        cmd_promote(graph_with_stale_nodes, "nope-999", "active")
        output = capsys.readouterr().out
        assert "not found" in output


class TestParseFrontmatter:
    def test_basic_frontmatter(self):
        content = "---\ntitle: Test\ntags: [a, b, c]\n---\nBody text here"
        meta, body = _parse_frontmatter(content)
        assert meta["title"] == "Test"
        assert meta["tags"] == ["a", "b", "c"]
        assert body == "Body text here"

    def test_no_frontmatter(self):
        content = "Just plain text"
        meta, body = _parse_frontmatter(content)
        assert meta == {}
        assert body == "Just plain text"

    def test_empty_list(self):
        content = "---\ntags: []\n---\nBody"
        meta, body = _parse_frontmatter(content)
        assert meta["tags"] == []

    def test_quoted_values(self):
        content = "---\nname: 'quoted value'\n---\nBody"
        meta, body = _parse_frontmatter(content)
        assert meta["name"] == "quoted value"


class TestCommandRegistry:
    def test_all_commands_registered(self):
        expected = {"stats", "quality", "expand", "search", "add", "link",
                    "consolidate", "demote", "promote", "render", "migrate",
                    "integrity", "export", "ingest", "clusters"}
        assert set(COMMANDS.keys()) == expected

    def test_all_commands_are_callable(self):
        for name, handler in COMMANDS.items():
            assert callable(handler), f"Command '{name}' is not callable"

    def test_quality_constants_are_positive(self):
        assert QUALITY_BASELINE > 0
        assert QUALITY_DECISION_WEIGHT > 0
        assert QUALITY_DECISION_CAP > 0
