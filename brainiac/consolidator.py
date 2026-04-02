"""Memory evolution: merge, abstract, prune candidates. All propose-only."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Optional

from .graph import BrainiacGraph, MemoryNode
from . import embeddings


MERGE_THRESHOLD = 0.9
CLUSTER_MIN_SIZE = 3
STALE_DAYS = 60

# Confidence thresholds for disambiguation
AUTO_MERGE_CONFIDENCE = 0.95    # Above this: safe to auto-merge (propose-only still)
HUMAN_REVIEW_THRESHOLD = 0.8    # Below this: flag for human review
# Merge uses larger boosts than linker (0.02/0.01) because merge is a higher-stakes
# decision — shared attributes should carry more weight when proposing deduplication.
DETERMINISTIC_BOOST_PROJECT = 0.03  # Boost per shared project
DETERMINISTIC_BOOST_TAG = 0.02      # Boost per shared tag
DETERMINISTIC_BOOST_TYPE = 0.02     # Boost if same node type


@dataclass
class MergeCandidate:
    """A proposed merge between two nodes with confidence scoring."""

    id_a: str
    id_b: str
    embedding_similarity: float
    shared_projects: list[str] = field(default_factory=list)
    shared_tags: list[str] = field(default_factory=list)
    same_type: bool = False
    confidence: float = 0.0
    review_level: str = "auto"  # "auto" | "review" | "manual"

    def compute_confidence(self):
        """Combine embedding similarity with deterministic signals."""
        self.confidence = self.embedding_similarity

        # Deterministic boosts (capped at 0.08 total to prevent marginal pairs
        # from being boosted into auto-merge territory)
        boost = 0.0
        boost += min(len(self.shared_projects) * DETERMINISTIC_BOOST_PROJECT, 0.06)
        boost += min(len(self.shared_tags) * DETERMINISTIC_BOOST_TAG, 0.04)
        if self.same_type:
            boost += DETERMINISTIC_BOOST_TYPE
        self.confidence += min(boost, 0.08)

        self.confidence = min(self.confidence, 1.0)

        # Assign review level
        if self.confidence >= AUTO_MERGE_CONFIDENCE:
            self.review_level = "auto"
        elif self.confidence >= HUMAN_REVIEW_THRESHOLD:
            self.review_level = "review"
        else:
            self.review_level = "manual"


def find_merge_candidates(
    graph: BrainiacGraph,
    all_embeddings: Optional[dict] = None,
) -> list[MergeCandidate]:
    """Find node pairs with >0.9 similarity that could be merged.

    Returns MergeCandidate objects with confidence scoring and review levels.
    """
    if all_embeddings is None:
        all_embeddings = embeddings.load_embeddings(graph.graph_dir)

    candidates: list[MergeCandidate] = []
    ids = list(all_embeddings.keys())

    for i, id_a in enumerate(ids):
        node_a = graph.get_node(id_a)
        if node_a is None:
            continue
        for id_b in ids[i + 1:]:
            score = embeddings.similarity(all_embeddings[id_a], all_embeddings[id_b])
            if score >= MERGE_THRESHOLD:
                node_b = graph.get_node(id_b)

                # Compute deterministic signals
                projects_a = set(node_a.metadata.get("projects", []) if node_a else [])
                projects_b = set(node_b.metadata.get("projects", []) if node_b else [])
                tags_a = set(node_a.tags if node_a else [])
                tags_b = set(node_b.tags if node_b else [])
                type_a = node_a.metadata.get("type", "") if node_a else ""
                type_b = node_b.metadata.get("type", "") if node_b else ""

                candidate = MergeCandidate(
                    id_a=id_a,
                    id_b=id_b,
                    embedding_similarity=round(score, 3),
                    shared_projects=sorted(projects_a & projects_b),
                    shared_tags=sorted(tags_a & tags_b),
                    same_type=type_a == type_b and type_a != "",
                )
                candidate.compute_confidence()
                candidates.append(candidate)

    candidates.sort(key=lambda x: x.confidence, reverse=True)
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


def node_last_touched(node: MemoryNode) -> Optional[datetime]:
    """Get the most recent timestamp for a node.

    Checks last_accessed > updated > timestamp, returning the most
    recent parseable datetime. Returns None if nothing is parseable.

    Shared by find_stale_nodes() and cmd_demote() to avoid duplicate
    staleness heuristics.
    """
    for field in ("last_accessed", "updated"):
        val = node.metadata.get(field)
        if val:
            try:
                return datetime.fromisoformat(str(val))
            except (ValueError, TypeError):
                continue
    # Fall back to node.timestamp
    try:
        return datetime.fromisoformat(str(node.timestamp))
    except (ValueError, TypeError):
        return None


def find_stale_nodes(graph: BrainiacGraph, days: int = STALE_DAYS) -> list[MemoryNode]:
    """Find nodes not updated in `days` and with few connections."""
    cutoff = datetime.now() - timedelta(days=days)
    stale = []

    for node in graph.nodes.values():
        node_time = node_last_touched(node)
        if node_time is None:
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
