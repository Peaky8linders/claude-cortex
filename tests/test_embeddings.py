"""Tests for brainiac embeddings module (no model loading — tests structure only)."""

import numpy as np
import pytest
from pathlib import Path
from brainiac.embeddings import similarity, find_similar, save_embeddings, load_embeddings


class TestSimilarity:
    def test_identical_vectors(self):
        v = [1.0, 0.0, 0.0]
        assert similarity(v, v) == pytest.approx(1.0)

    def test_orthogonal_vectors(self):
        assert similarity([1.0, 0.0], [0.0, 1.0]) == pytest.approx(0.0)

    def test_opposite_vectors(self):
        assert similarity([1.0, 0.0], [-1.0, 0.0]) == pytest.approx(-1.0)


class TestFindSimilar:
    def test_find_similar_basic(self):
        query = [1.0, 0.0, 0.0]
        embeddings = {
            "a": [0.9, 0.1, 0.0],
            "b": [0.0, 1.0, 0.0],
            "c": [0.8, 0.2, 0.0],
        }
        results = find_similar(query, embeddings, top_k=2)
        assert len(results) == 2
        assert results[0][0] == "a"  # Most similar
        assert results[0][1] > results[1][1]  # Sorted by score

    def test_find_similar_empty(self):
        assert find_similar([1.0], {}, top_k=5) == []

    def test_top_k_limits_results(self):
        embeddings = {f"n{i}": [float(i), 0.0] for i in range(10)}
        results = find_similar([1.0, 0.0], embeddings, top_k=3)
        assert len(results) == 3


class TestPersistence:
    def test_save_and_load_roundtrip(self, tmp_path):
        embs = {"pat-001": [0.1, 0.2, 0.3], "pat-002": [0.4, 0.5, 0.6]}
        save_embeddings(embs, tmp_path)
        loaded = load_embeddings(tmp_path)
        assert set(loaded.keys()) == {"pat-001", "pat-002"}
        assert loaded["pat-001"] == pytest.approx([0.1, 0.2, 0.3], abs=1e-6)

    def test_load_nonexistent_returns_empty(self, tmp_path):
        assert load_embeddings(tmp_path) == {}

    def test_save_empty_is_noop(self, tmp_path):
        save_embeddings({}, tmp_path)
        assert not (tmp_path / "embeddings.npz").exists()
