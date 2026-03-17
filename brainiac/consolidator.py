"""Memory evolution: merge, abstract, prune candidates. All propose-only."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from .graph import BrainiacGraph, MemoryNode
from . import embeddings


MERGE_THRESHOLD = 0.9
CLUSTER_MIN_SIZE = 3
STALE_DAYS = 60


def find_merge_candidates(
    graph: BrainiacGraph,
    all_embeddings: Optional[dict] = None,
) -> list[tuple[str, str, float]]:
    """Find node pairs with >0.9 similarity that could be merged."""
    if all_embeddings is None:
        all_embeddings = embeddings.load_embeddings(graph.graph_dir)

    candidates = []
    ids = list(all_embeddings.keys())

    for i, id_a in enumerate(ids):
        for id_b in ids[i + 1:]:
            score = embeddings.similarity(all_embeddings[id_a], all_embeddings[id_b])
            if score >= MERGE_THRESHOLD:
                candidates.append((id_a, id_b, round(score, 3)))

    candidates.sort(key=lambda x: x[2], reverse=True)
    return candidates


def find_abstraction_candidates(
    graph: BrainiacGraph,
    all_embeddings: Optional[dict] = None,
) -> list[list[str]]:
    """Find clusters of 3+ nodes that share high similarity — candidates for
    a higher-level summary node.
    """
    if all_embeddings is None:
        all_embeddings = embeddings.load_embeddings(graph.graph_dir)

    # Simple greedy clustering at 0.75 threshold
    threshold = 0.75
    ids = list(all_embeddings.keys())
    used = set()
    clusters = []

    for i, id_a in enumerate(ids):
        if id_a in used:
            continue
        cluster = [id_a]
        for id_b in ids[i + 1:]:
            if id_b in used:
                continue
            score = embeddings.similarity(all_embeddings[id_a], all_embeddings[id_b])
            if score >= threshold:
                cluster.append(id_b)
        if len(cluster) >= CLUSTER_MIN_SIZE:
            clusters.append(cluster)
            used.update(cluster)

    return clusters


def find_stale_nodes(graph: BrainiacGraph, days: int = STALE_DAYS) -> list[MemoryNode]:
    """Find nodes not updated in `days` and with few connections."""
    cutoff = datetime.now() - timedelta(days=days)
    stale = []

    for node in graph.nodes.values():
        try:
            updated = node.metadata.get("updated", node.timestamp)
            node_time = datetime.fromisoformat(updated)
        except (ValueError, TypeError):
            continue

        if node_time < cutoff and len(node.links) <= 1:
            stale.append(node)

    return stale


def evolve_context(graph: BrainiacGraph, new_node: MemoryNode):
    """Update context descriptions of nodes linked to a new node.

    When a new node arrives, its neighbors may gain richer context
    from the relationship. This is the A-MEM 'memory evolution' step.
    """
    for linked_id in new_node.links:
        linked = graph.get_node(linked_id)
        if linked and linked.context:
            # Append relationship note to context
            relationship_note = f" [Related: {new_node.id} — {new_node.keywords[:3]}]"
            if relationship_note not in linked.context:
                linked.context += relationship_note
