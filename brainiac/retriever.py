"""Intent-aware multi-hop retrieval engine (MAGMA-inspired)."""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass
from typing import Optional

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

    # Sort by score and return top_k
    sorted_results = sorted(results.values(), key=lambda r: r.score, reverse=True)
    return sorted_results[:top_k]


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
