"""Intent-aware multi-hop retrieval engine (MAGMA-inspired)."""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass
from typing import Optional

import numpy as np

from .graph import BrainiacGraph, MemoryNode
from . import embeddings


# Intent-to-edge-weight maps (from MAGMA paper)
INTENT_WEIGHTS = {
    "what":  {"semantic": 3.0, "entity": 2.0, "temporal": 0.5, "causal": 1.0},
    "why":   {"causal": 5.0, "semantic": 1.0, "temporal": 2.0, "entity": 0.5},
    "when":  {"temporal": 4.0, "causal": 2.0, "semantic": 1.0, "entity": 0.5},
    "who":   {"entity": 5.0, "semantic": 1.5, "temporal": 1.0, "causal": 0.5},
    "how":   {"semantic": 3.0, "causal": 2.5, "entity": 1.0, "temporal": 0.5},
}

MAX_HOPS = 3
MAX_NODES = 20


@dataclass
class RetrievalResult:
    node: MemoryNode
    score: float
    path: list[str]     # How we got here (node IDs)
    relations: list[str]  # Edge types traversed


def detect_intent(query: str) -> str:
    """Classify query intent to weight edge traversal."""
    q = query.lower()
    if re.search(r"\bwhy\b|reason|cause|because|led to", q):
        return "why"
    if re.search(r"\bwhen\b|timeline|before|after|sequence|history", q):
        return "when"
    if re.search(r"\bwho\b|which project|where|team", q):
        return "who"
    if re.search(r"\bhow\b|approach|method|technique|way to", q):
        return "how"
    return "what"


def retrieve(
    graph: BrainiacGraph,
    query: str,
    top_k: int = 10,
    all_embeddings: Optional[dict] = None,
) -> list[RetrievalResult]:
    """Intent-aware multi-hop retrieval.

    1. Detect intent from query
    2. Find anchor nodes via embedding similarity
    3. BFS along intent-weighted edges
    4. Return top-k by combined score
    """
    if all_embeddings is None:
        all_embeddings = embeddings.load_embeddings(graph.graph_dir)

    if not all_embeddings:
        return []

    intent = detect_intent(query)
    weights = INTENT_WEIGHTS[intent]

    # Step 1: Embed query and find anchors
    query_vec = embeddings.embed(query)
    similar = embeddings.find_similar(query_vec, all_embeddings, top_k=5)

    if not similar:
        return []

    # Step 2: BFS from anchors with intent-weighted scoring
    results: dict[str, RetrievalResult] = {}

    for anchor_id, anchor_score in similar:
        node = graph.get_node(anchor_id)
        if not node:
            continue

        results[anchor_id] = RetrievalResult(
            node=node,
            score=anchor_score,
            path=[anchor_id],
            relations=[],
        )

        # BFS from anchor
        frontier = [(anchor_id, anchor_score, [anchor_id], [])]
        visited = {anchor_id}

        for hop in range(MAX_HOPS):
            next_frontier = []
            for current_id, current_score, path, rels in frontier:
                for edge in graph.edges_for(current_id):
                    neighbor_id = edge.target if edge.source == current_id else edge.source
                    if neighbor_id in visited:
                        continue

                    edge_weight = weights.get(edge.relation, 1.0)
                    hop_decay = 0.7 ** hop
                    neighbor_score = current_score * edge.weight * edge_weight * hop_decay * 0.3

                    neighbor_node = graph.get_node(neighbor_id)
                    if not neighbor_node:
                        continue

                    new_path = path + [neighbor_id]
                    new_rels = rels + [edge.relation]

                    if neighbor_id not in results or results[neighbor_id].score < neighbor_score:
                        results[neighbor_id] = RetrievalResult(
                            node=neighbor_node,
                            score=neighbor_score,
                            path=new_path,
                            relations=new_rels,
                        )

                    visited.add(neighbor_id)
                    next_frontier.append((neighbor_id, neighbor_score, new_path, new_rels))

            frontier = next_frontier
            if len(results) >= MAX_NODES:
                break

    # Re-rank: rescore all candidates against the original query embedding
    # SmartSearch (Derehag et al.) showed 77.5% of gold evidence is discarded
    # without re-ranking. This second pass replaces hop-decayed BFS scores
    # with direct query-candidate similarity, rescuing buried multi-hop results.
    reranked = rerank(list(results.values()), query_vec, all_embeddings)

    # Score-adaptive truncation: cut results where score drops sharply
    # SmartSearch showed truncation strategy matters more than recall
    truncated = truncate_adaptive(reranked)

    return truncated[:top_k]


def rerank(
    results: list[RetrievalResult],
    query_vec: list[float],
    all_embeddings: dict[str, list[float]],
) -> list[RetrievalResult]:
    """Re-rank retrieval results by direct cosine similarity to query.

    BFS scoring decays with hops (0.7^hop * 0.3), which buries relevant
    nodes found via multi-hop traversal. Re-ranking replaces BFS scores
    with a blend of direct similarity and graph-traversal signal.

    Blend: 0.7 * direct_similarity + 0.3 * normalized_bfs_score
    This preserves graph structure signal while letting direct relevance dominate.
    """
    if not results:
        return results

    query = np.array(query_vec)

    # Normalize BFS scores to 0-1 range for blending
    max_bfs = max(r.score for r in results) if results else 1.0
    if max_bfs == 0:
        max_bfs = 1.0

    for result in results:
        emb = all_embeddings.get(result.node.id)
        if emb:
            direct_sim = float(np.dot(query, np.array(emb)))
            direct_sim = max(0.0, direct_sim)  # clamp negatives
        else:
            direct_sim = 0.0

        normalized_bfs = result.score / max_bfs
        result.score = 0.7 * direct_sim + 0.3 * normalized_bfs

    results.sort(key=lambda r: r.score, reverse=True)
    return results


def truncate_adaptive(
    results: list[RetrievalResult],
    min_results: int = 3,
    drop_threshold: float = 0.5,
) -> list[RetrievalResult]:
    """Score-adaptive truncation: cut where score drops sharply.

    If the relative score drop between consecutive results exceeds
    drop_threshold (50%), truncate there. Always keeps at least
    min_results items.

    Inspired by SmartSearch's score-adaptive truncation that achieved
    8.5x token reduction while maintaining 93.5% accuracy.
    """
    if len(results) <= min_results:
        return results

    for i in range(min_results, len(results)):
        prev_score = results[i - 1].score
        curr_score = results[i].score
        if prev_score > 0 and (prev_score - curr_score) / prev_score > drop_threshold:
            return results[:i]

    return results


def search_simple(
    graph: BrainiacGraph,
    query: str,
    top_k: int = 10,
    all_embeddings: Optional[dict] = None,
) -> list[tuple[MemoryNode, float]]:
    """Simple embedding-only search without graph traversal."""
    if all_embeddings is None:
        all_embeddings = embeddings.load_embeddings(graph.graph_dir)

    if not all_embeddings:
        return []

    query_vec = embeddings.embed(query)
    similar = embeddings.find_similar(query_vec, all_embeddings, top_k=top_k)
    return [(graph.get_node(nid), score) for nid, score in similar if graph.get_node(nid)]
