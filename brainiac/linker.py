"""Auto-linking engine: creates semantic, temporal, causal, and entity edges."""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from .graph import BrainiacGraph, MemoryNode, Edge
from . import embeddings


SEMANTIC_THRESHOLD = 0.7
TEMPORAL_WINDOW_DAYS = 7


def link_new_node(graph: BrainiacGraph, node: MemoryNode, all_embeddings: Optional[dict] = None):
    """Auto-link a new node to existing graph nodes.

    Creates semantic, temporal, and entity edges automatically.
    Causal edges are only created explicitly via /learn.
    """
    if all_embeddings is None:
        all_embeddings = embeddings.load_embeddings(graph.graph_dir)

    # Skip self
    other_embeddings = {k: v for k, v in all_embeddings.items() if k != node.id}

    # --- Semantic edges ---
    if node.embedding and other_embeddings:
        similar = embeddings.find_similar(node.embedding, other_embeddings, top_k=10)
        for target_id, score in similar:
            if score >= SEMANTIC_THRESHOLD:
                # Boost confidence for nodes sharing projects/tags
                target_node = graph.get_node(target_id)
                confidence = round(score, 3)
                if target_node:
                    shared_projects = set(node.metadata.get("projects", [])) & set(target_node.metadata.get("projects", []))
                    shared_tags = set(node.tags) & set(target_node.tags)
                    confidence = min(1.0, round(score + len(shared_projects) * 0.02 + len(shared_tags) * 0.01, 3))

                graph.add_edge(Edge(
                    source=node.id,
                    target=target_id,
                    relation="semantic",
                    weight=confidence,
                    metadata={"auto": True, "created": _now(), "confidence": confidence},
                ))

    # --- Temporal edges ---
    _link_temporal(graph, node)

    # --- Entity edges (shared projects/tags) ---
    _link_entity(graph, node)


def _link_temporal(graph: BrainiacGraph, node: MemoryNode):
    """Link to recent nodes in the same project."""
    node_projects = set(node.metadata.get("projects", []))
    if not node_projects:
        return

    try:
        node_time = datetime.fromisoformat(node.timestamp)
    except (ValueError, TypeError):
        return

    for other in graph.nodes.values():
        if other.id == node.id:
            continue
        other_projects = set(other.metadata.get("projects", []))
        if not node_projects & other_projects:
            continue
        try:
            other_time = datetime.fromisoformat(other.timestamp)
        except (ValueError, TypeError):
            continue

        days_apart = abs((node_time - other_time).days)
        if days_apart <= TEMPORAL_WINDOW_DAYS:
            weight = round(1.0 - (days_apart / TEMPORAL_WINDOW_DAYS), 2)
            # Older → newer direction
            if node_time >= other_time:
                src, tgt = other.id, node.id
            else:
                src, tgt = node.id, other.id
            graph.add_edge(Edge(
                source=src,
                target=tgt,
                relation="temporal",
                weight=max(weight, 0.1),
                metadata={"auto": True, "days_apart": days_apart, "created": _now()},
            ))


def _link_entity(graph: BrainiacGraph, node: MemoryNode):
    """Link nodes that share projects or domain tags."""
    node_projects = set(node.metadata.get("projects", []))
    node_tags = set(node.tags)

    for other in graph.nodes.values():
        if other.id == node.id:
            continue

        other_projects = set(other.metadata.get("projects", []))
        other_tags = set(other.tags)

        shared_projects = node_projects & other_projects
        shared_tags = node_tags & other_tags

        # Need at least 2 shared attributes to create entity edge
        shared_count = len(shared_projects) + len(shared_tags)
        if shared_count >= 2:
            weight = min(shared_count / 5.0, 1.0)
            graph.add_edge(Edge(
                source=node.id,
                target=other.id,
                relation="entity",
                weight=round(weight, 2),
                metadata={
                    "auto": True,
                    "shared_projects": list(shared_projects),
                    "shared_tags": list(shared_tags),
                    "created": _now(),
                },
            ))



def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")
