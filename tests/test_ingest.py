"""Tests for brainiac ingest module."""

import pytest
from pathlib import Path
from unittest.mock import patch
from datetime import datetime

from brainiac.graph import BrainiacGraph, MemoryNode
from brainiac.ingest import (
    scan_inbox,
    parse_frontmatter,
    parse_inbox_file,
    find_enrichment_target,
    enrich_node,
    create_node,
    move_to_processed,
    cmd_ingest,
    IngestItem,
    ENRICHMENT_THRESHOLD,
)


@pytest.fixture
def tmp_graph(tmp_path):
    return BrainiacGraph(graph_dir=tmp_path)


@pytest.fixture
def inbox_dir(tmp_path):
    d = tmp_path / "inbox"
    d.mkdir()
    return d


def _fake_embed(text):
    """Deterministic fake embedding based on text hash."""
    import hashlib
    h = hashlib.md5(text.encode()).hexdigest()
    vec = [int(c, 16) / 15.0 for c in h]
    # Pad to 384 dims with zeros
    vec = (vec * 24)[:384]
    # Normalize
    norm = sum(x * x for x in vec) ** 0.5
    return [x / norm for x in vec] if norm > 0 else vec


# --- scan_inbox ---

class TestScanInbox:
    def test_empty_dir(self, inbox_dir):
        assert scan_inbox(inbox_dir) == []

    def test_finds_md_files(self, inbox_dir):
        (inbox_dir / "a.md").write_text("content")
        (inbox_dir / "b.md").write_text("content")
        (inbox_dir / "c.txt").write_text("not markdown")
        files = scan_inbox(inbox_dir)
        assert len(files) == 2
        assert all(f.suffix == ".md" for f in files)

    def test_missing_dir(self, tmp_path):
        assert scan_inbox(tmp_path / "nonexistent") == []


# --- parse_frontmatter ---

class TestParseFrontmatter:
    def test_with_frontmatter(self):
        text = "---\ntype: pattern\ntags: [a, b]\n---\nBody text"
        meta, body = parse_frontmatter(text)
        assert meta["type"] == "pattern"
        assert meta["tags"] == ["a", "b"]
        assert body == "Body text"

    def test_without_frontmatter(self):
        text = "Just plain text"
        meta, body = parse_frontmatter(text)
        assert meta == {}
        assert body == "Just plain text"

    def test_empty_frontmatter(self):
        text = "---\n\n---\nBody"
        meta, body = parse_frontmatter(text)
        assert meta == {}
        assert body == "Body"


# --- parse_inbox_file ---

class TestParseInboxFile:
    def test_valid_file(self, inbox_dir):
        f = inbox_dir / "test.md"
        f.write_text("---\ntype: pattern\ntags: [cache]\n---\nCache invalidation strategy")
        item = parse_inbox_file(f)
        assert item is not None
        assert item.node_type == "pattern"
        assert item.tags == ["cache"]
        assert "Cache invalidation" in item.content

    def test_no_frontmatter(self, inbox_dir):
        f = inbox_dir / "plain.md"
        f.write_text("Just some knowledge about testing")
        item = parse_inbox_file(f)
        assert item is not None
        assert item.node_type == "memory"
        assert item.tags == []

    def test_empty_body(self, inbox_dir):
        f = inbox_dir / "empty.md"
        f.write_text("---\ntype: pattern\n---\n   ")
        assert parse_inbox_file(f) is None

    def test_invalid_type_falls_back(self, inbox_dir):
        f = inbox_dir / "badtype.md"
        f.write_text("---\ntype: banana\n---\nSome content")
        item = parse_inbox_file(f)
        assert item.node_type == "memory"

    def test_string_tags_normalized(self, inbox_dir):
        f = inbox_dir / "strtag.md"
        f.write_text("---\ntags: solo\n---\nContent here")
        item = parse_inbox_file(f)
        assert item.tags == ["solo"]


# --- find_enrichment_target ---

class TestFindEnrichmentTarget:
    def test_no_embeddings(self):
        assert find_enrichment_target({}, [0.1] * 384) is None

    def test_below_threshold(self):
        # Two very different embeddings
        emb_a = [1.0] + [0.0] * 383
        emb_b = [0.0] + [1.0] + [0.0] * 382
        result = find_enrichment_target({"pat-001": emb_a}, emb_b)
        assert result is None

    def test_above_threshold(self):
        emb = [1.0] + [0.0] * 383
        # Same embedding = similarity 1.0
        result = find_enrichment_target({"pat-001": emb}, emb)
        assert result is not None
        assert result[0] == "pat-001"
        assert result[1] >= ENRICHMENT_THRESHOLD


# --- enrich_node ---

class TestEnrichNode:
    @patch("brainiac.ingest.embeddings.embed", side_effect=_fake_embed)
    def test_content_merged(self, mock_embed, tmp_graph):
        tmp_graph.add_node(MemoryNode(
            id="pat-001", content="Original content", timestamp="2026-01-01",
            keywords=["Original"], tags=["a"], metadata={"type": "pattern", "projects": ["p1"]}
        ))
        all_embs = {"pat-001": _fake_embed("Original content")}
        enrich_node(tmp_graph, "pat-001", "New content", ["b"], ["New"], ["p2"], all_embs)

        node = tmp_graph.get_node("pat-001")
        assert "Original content" in node.content
        assert "New content" in node.content
        assert "---" in node.content  # separator
        assert "a" in node.tags
        assert "b" in node.tags
        assert "p2" in node.metadata["projects"]

    @patch("brainiac.ingest.embeddings.embed", side_effect=_fake_embed)
    def test_content_capped(self, mock_embed, tmp_graph):
        long_content = "x" * 9000
        tmp_graph.add_node(MemoryNode(
            id="pat-001", content=long_content, timestamp="2026-01-01",
            metadata={"type": "pattern"}
        ))
        all_embs = {"pat-001": _fake_embed(long_content)}
        enrich_node(tmp_graph, "pat-001", "y" * 3000, [], [], [], all_embs)
        node = tmp_graph.get_node("pat-001")
        assert len(node.content) <= 10_000

    @patch("brainiac.ingest.embeddings.embed", side_effect=_fake_embed)
    def test_tags_deduplicated(self, mock_embed, tmp_graph):
        tmp_graph.add_node(MemoryNode(
            id="pat-001", content="Test", timestamp="2026-01-01",
            tags=["a", "b"], metadata={"type": "pattern"}
        ))
        all_embs = {"pat-001": _fake_embed("Test")}
        enrich_node(tmp_graph, "pat-001", "More", ["b", "c"], [], [], all_embs)
        node = tmp_graph.get_node("pat-001")
        assert node.tags == ["a", "b", "c"]


# --- create_node ---

class TestCreateNode:
    @patch("brainiac.ingest.link_new_node")
    @patch("brainiac.ingest.embeddings.embed", side_effect=_fake_embed)
    def test_creates_with_correct_metadata(self, mock_embed, mock_link, tmp_graph):
        item = IngestItem(
            path=Path("test.md"),
            content="Knowledge about caching strategies",
            node_type="pattern",
            tags=["cache"],
            projects=["myproject"],
            confidence="high",
        )
        all_embs = {}
        node = create_node(tmp_graph, item, all_embs)

        assert node.id.startswith("pat-")
        assert node.metadata["type"] == "pattern"
        assert node.metadata["source"] == "ingest:test.md"
        assert "cache" in node.tags
        assert node.id in all_embs
        mock_link.assert_called_once()


# --- move_to_processed ---

class TestMoveToProcessed:
    def test_moves_file(self, inbox_dir):
        f = inbox_dir / "test.md"
        f.write_text("content")
        dest = move_to_processed(f, inbox_dir / "processed")
        assert not f.exists()
        assert dest.exists()
        assert "test.md" in dest.name

    def test_conflict_resolution(self, inbox_dir):
        proc = inbox_dir / "processed"
        proc.mkdir()
        f = inbox_dir / "test.md"
        f.write_text("content")
        # Pre-create a conflict
        (proc / f"{datetime.now().strftime('%Y%m%d-%H%M%S')}_test.md").write_text("old")
        dest = move_to_processed(f, proc)
        assert dest.exists()


# --- cmd_ingest ---

class TestCmdIngest:
    @patch("brainiac.ingest.embeddings.save_embeddings")
    @patch("brainiac.ingest.embeddings.load_embeddings", return_value={})
    @patch("brainiac.ingest.embeddings.embed", side_effect=_fake_embed)
    @patch("brainiac.ingest.link_new_node")
    @patch("brainiac.ingest.render_views")
    @patch("brainiac.ingest.update_index")
    def test_dry_run_no_changes(self, mock_idx, mock_rv, mock_link, mock_embed,
                                 mock_load, mock_save, tmp_graph, inbox_dir, capsys):
        (inbox_dir / "a.md").write_text("---\ntype: pattern\n---\nTest content here")
        cmd_ingest(tmp_graph, dry_run=True, inbox_dir=inbox_dir)
        output = capsys.readouterr().out
        assert "CREATE" in output
        assert "dry run" in output
        # File should still be in inbox
        assert (inbox_dir / "a.md").exists()
        mock_save.assert_not_called()

    @patch("brainiac.ingest.embeddings.save_embeddings")
    @patch("brainiac.ingest.embeddings.load_embeddings", return_value={})
    @patch("brainiac.ingest.embeddings.embed", side_effect=_fake_embed)
    @patch("brainiac.ingest.link_new_node")
    @patch("brainiac.ingest.render_views")
    @patch("brainiac.ingest.update_index")
    def test_creates_node_and_moves_file(self, mock_idx, mock_rv, mock_link, mock_embed,
                                          mock_load, mock_save, tmp_graph, inbox_dir, capsys):
        (inbox_dir / "a.md").write_text("---\ntype: solution\n---\nA useful solution")
        cmd_ingest(tmp_graph, dry_run=False, inbox_dir=inbox_dir)
        output = capsys.readouterr().out
        assert "CREATED" in output
        assert not (inbox_dir / "a.md").exists()
        assert (inbox_dir / "processed").exists()
        mock_save.assert_called_once()

    def test_empty_inbox(self, tmp_graph, inbox_dir, capsys):
        cmd_ingest(tmp_graph, inbox_dir=inbox_dir)
        output = capsys.readouterr().out
        assert "No files to process" in output
