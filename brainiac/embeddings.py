"""Local embedding engine using sentence-transformers."""

from __future__ import annotations

import numpy as np
from pathlib import Path
from typing import Optional

from . import GRAPH_DIR

MODEL_NAME = "all-MiniLM-L6-v2"
EMBEDDING_DIM = 384
_model = None


def _get_model():
    """Lazy-load the sentence-transformer model."""
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer
        _model = SentenceTransformer(MODEL_NAME)
    return _model


def embed(text: str) -> list[float]:
    """Embed a single text string."""
    model = _get_model()
    vec = model.encode(text, normalize_embeddings=True)
    return vec.tolist()


def embed_batch(texts: list[str]) -> list[list[float]]:
    """Embed multiple texts efficiently."""
    if not texts:
        return []
    model = _get_model()
    vecs = model.encode(texts, normalize_embeddings=True, batch_size=32)
    return vecs.tolist()


def similarity(a: list[float], b: list[float]) -> float:
    """Cosine similarity between two vectors (pre-normalized)."""
    va, vb = np.array(a), np.array(b)
    return float(np.dot(va, vb))


def find_similar(
    query_embedding: list[float],
    node_embeddings: dict[str, list[float]],
    top_k: int = 10,
) -> list[tuple[str, float]]:
    """Find top-k most similar nodes by embedding cosine similarity."""
    if not node_embeddings:
        return []

    query = np.array(query_embedding)
    results = []
    for node_id, emb in node_embeddings.items():
        score = float(np.dot(query, np.array(emb)))
        results.append((node_id, score))

    results.sort(key=lambda x: x[1], reverse=True)
    return results[:top_k]


# --- Persistence ---

def save_embeddings(embeddings: dict[str, list[float]], graph_dir: Optional[Path] = None):
    """Save embeddings as compressed numpy file."""
    gdir = graph_dir or GRAPH_DIR
    gdir.mkdir(parents=True, exist_ok=True)
    path = gdir / "embeddings.npz"

    if not embeddings:
        return

    ids = sorted(embeddings.keys())
    matrix = np.array([embeddings[i] for i in ids], dtype=np.float32)
    np.savez_compressed(path, ids=np.array(ids), matrix=matrix)


def load_embeddings(graph_dir: Optional[Path] = None) -> dict[str, list[float]]:
    """Load embeddings from compressed numpy file."""
    gdir = graph_dir or GRAPH_DIR
    path = gdir / "embeddings.npz"

    if not path.exists():
        return {}

    data = np.load(path, allow_pickle=False)
    ids = data["ids"].tolist()
    matrix = data["matrix"]
    return {nid: matrix[i].tolist() for i, nid in enumerate(ids)}
