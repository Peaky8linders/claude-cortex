"""Community detection and domain clustering for the knowledge graph."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

import numpy as np

from . import KNOWLEDGE_ROOT
from . import embeddings
from .graph import BrainiacGraph, MemoryNode

REPORT_PATH = KNOWLEDGE_ROOT / "GRAPH_REPORT.md"
DEFAULT_DISTANCE_THRESHOLD = 0.5
DEFAULT_MIN_CLUSTER_SIZE = 2


@dataclass
class Cluster:
    """A discovered knowledge domain."""
    id: int
    label: str
    node_ids: list[str]
    dominant_type: str
    top_keywords: list[str]
    representative_ids: list[str] = field(default_factory=list)


@dataclass
class CrossClusterLink:
    """An edge connecting two different clusters."""
    cluster_a_label: str
    cluster_b_label: str
    edge_count: int
    strongest_edge: tuple[str, str, str] = ("", "", "")  # source, target, relation


@dataclass
class ClusterReport:
    """Full clustering analysis output."""
    clusters: list[Cluster]
    cross_links: list[CrossClusterLink]
    orphan_node_ids: list[str]
    timestamp: str = ""


def compute_distance_matrix(
    all_embs: dict[str, list[float]],
) -> tuple[np.ndarray, list[str]]:
    """Compute condensed cosine distance matrix from embeddings.

    Returns (condensed_distances, node_ids) where condensed_distances
    is suitable for scipy.cluster.hierarchy.linkage.
    """
    ids = sorted(all_embs.keys())
    if len(ids) < 2:
        return np.array([]), ids

    matrix = np.array([all_embs[nid] for nid in ids], dtype=np.float32)

    # Cosine similarity for normalized vectors = dot product
    sim_matrix = matrix @ matrix.T
    # Clip to handle floating-point edge cases
    np.clip(sim_matrix, -1.0, 1.0, out=sim_matrix)
    dist_matrix = 1.0 - sim_matrix

    # Extract condensed form (upper triangle)
    n = len(ids)
    condensed = np.zeros(n * (n - 1) // 2, dtype=np.float64)
    idx = 0
    for i in range(n):
        for j in range(i + 1, n):
            condensed[idx] = max(dist_matrix[i, j], 0.0)
            idx += 1

    return condensed, ids


def run_clustering(
    condensed_distances: np.ndarray,
    node_ids: list[str],
    threshold: float = DEFAULT_DISTANCE_THRESHOLD,
    min_size: int = DEFAULT_MIN_CLUSTER_SIZE,
) -> dict[str, int]:
    """Run hierarchical agglomerative clustering.

    Returns a dict mapping node_id -> cluster_id.
    Nodes in clusters smaller than min_size get cluster_id = -1 (orphans).
    """
    if len(node_ids) < 2 or len(condensed_distances) == 0:
        return {nid: -1 for nid in node_ids}

    from scipy.cluster.hierarchy import linkage, fcluster

    Z = linkage(condensed_distances, method="average")
    labels = fcluster(Z, t=threshold, criterion="distance")

    # Map to dict
    assignment = {}
    for i, nid in enumerate(node_ids):
        assignment[nid] = int(labels[i])

    # Demote small clusters to orphan (-1)
    cluster_sizes = Counter(assignment.values())
    for nid in assignment:
        if cluster_sizes[assignment[nid]] < min_size:
            assignment[nid] = -1

    return assignment


def label_cluster(
    graph: BrainiacGraph,
    node_ids: list[str],
) -> tuple[str, str, list[str]]:
    """Generate a label for a cluster from member nodes.

    Returns (label_string, dominant_type, top_keywords).
    """
    keyword_counts: Counter = Counter()
    type_counts: Counter = Counter()

    for nid in node_ids:
        node = graph.get_node(nid)
        if node is None:
            continue
        keyword_counts.update(node.keywords)
        keyword_counts.update(node.tags)
        ntype = node.metadata.get("type", "memory")
        type_counts[ntype] += 1

    top_kw = [kw for kw, _ in keyword_counts.most_common(5)]
    dominant_type = type_counts.most_common(1)[0][0] if type_counts else "memory"

    # Build label from top 3 keywords
    label_parts = [kw for kw, _ in keyword_counts.most_common(3)]
    label = ", ".join(label_parts) if label_parts else "Unnamed"

    return label, dominant_type, top_kw


def find_representatives(
    graph: BrainiacGraph,
    node_ids: list[str],
    k: int = 3,
) -> list[str]:
    """Find top-k representative nodes by degree centrality (edge count)."""
    degree: dict[str, int] = {nid: 0 for nid in node_ids}
    member_set = set(node_ids)

    for edge in graph.edges:
        if edge.source in member_set:
            degree[edge.source] = degree.get(edge.source, 0) + 1
        if edge.target in member_set:
            degree[edge.target] = degree.get(edge.target, 0) + 1

    ranked = sorted(degree.items(), key=lambda x: x[1], reverse=True)
    return [nid for nid, _ in ranked[:k]]


def compute_cross_cluster_edges(
    graph: BrainiacGraph,
    clusters: list[Cluster],
) -> list[CrossClusterLink]:
    """Find edges that connect nodes in different clusters."""
    # Build node -> cluster label map
    node_to_cluster: dict[str, str] = {}
    for cluster in clusters:
        for nid in cluster.node_ids:
            node_to_cluster[nid] = cluster.label

    # Count cross-cluster edges
    pair_counts: dict[tuple[str, str], int] = {}
    pair_strongest: dict[tuple[str, str], tuple[str, str, str, float]] = {}

    for edge in graph.edges:
        src_cluster = node_to_cluster.get(edge.source)
        tgt_cluster = node_to_cluster.get(edge.target)
        if src_cluster and tgt_cluster and src_cluster != tgt_cluster:
            pair = tuple(sorted([src_cluster, tgt_cluster]))
            pair_counts[pair] = pair_counts.get(pair, 0) + 1

            current = pair_strongest.get(pair)
            if current is None or edge.weight > current[3]:
                pair_strongest[pair] = (edge.source, edge.target, edge.relation, edge.weight)

    links = []
    for pair, count in sorted(pair_counts.items(), key=lambda x: x[1], reverse=True):
        strongest = pair_strongest[pair]
        links.append(CrossClusterLink(
            cluster_a_label=pair[0],
            cluster_b_label=pair[1],
            edge_count=count,
            strongest_edge=(strongest[0], strongest[1], strongest[2]),
        ))

    return links


def build_report(
    graph: BrainiacGraph,
    assignment: dict[str, int],
    min_size: int = DEFAULT_MIN_CLUSTER_SIZE,
) -> ClusterReport:
    """Build a full cluster report from clustering assignment."""
    # Group nodes by cluster
    cluster_groups: dict[int, list[str]] = {}
    orphans = []
    for nid, cid in assignment.items():
        if cid == -1:
            orphans.append(nid)
        else:
            cluster_groups.setdefault(cid, []).append(nid)

    # Build Cluster objects
    clusters = []
    for cid, node_ids in sorted(cluster_groups.items()):
        label, dominant_type, top_kw = label_cluster(graph, node_ids)
        reps = find_representatives(graph, node_ids)
        clusters.append(Cluster(
            id=cid,
            label=label,
            node_ids=node_ids,
            dominant_type=dominant_type,
            top_keywords=top_kw,
            representative_ids=reps,
        ))

    cross_links = compute_cross_cluster_edges(graph, clusters)

    return ClusterReport(
        clusters=clusters,
        cross_links=cross_links,
        orphan_node_ids=orphans,
        timestamp=datetime.now().isoformat(timespec="seconds"),
    )


def generate_report_markdown(graph: BrainiacGraph, report: ClusterReport) -> str:
    """Generate GRAPH_REPORT.md content from a ClusterReport."""
    total_nodes = len(graph.nodes)
    total_edges = len(graph.edges)
    n_clusters = len(report.clusters)

    lines = [
        "# Knowledge Graph Report",
        f"Generated: {report.timestamp} | Nodes: {total_nodes} | "
        f"Edges: {total_edges} | Domains: {n_clusters}",
        "",
    ]

    if report.clusters:
        lines.append("## Domains")
        lines.append("")
        for i, cluster in enumerate(report.clusters, 1):
            lines.append(f"### {i}. {cluster.label} ({len(cluster.node_ids)} nodes)")

            # Type breakdown
            type_counts: Counter = Counter()
            for nid in cluster.node_ids:
                node = graph.get_node(nid)
                if node:
                    type_counts[node.metadata.get("type", "memory")] += 1
            type_str = ", ".join(f"{t} ({c})" for t, c in type_counts.most_common())
            lines.append(f"Types: {type_str}")

            # Keywords
            lines.append(f"Key topics: {', '.join(cluster.top_keywords)}")

            # Representatives
            rep_parts = []
            for rid in cluster.representative_ids:
                node = graph.get_node(rid)
                if node:
                    title = node.content[:50].replace("\n", " ")
                    rep_parts.append(f"{rid} ({title})")
            if rep_parts:
                lines.append(f"Representatives: {'; '.join(rep_parts)}")
            lines.append("")

    if report.cross_links:
        lines.append("## Cross-Domain Connections")
        lines.append("")
        for link in report.cross_links:
            lines.append(f"{link.cluster_a_label} <-> {link.cluster_b_label}: {link.edge_count} edges")
            src, tgt, rel = link.strongest_edge
            if src:
                lines.append(f"  Strongest: {src} -> {tgt} ({rel})")
        lines.append("")

    if report.orphan_node_ids:
        lines.append("## Unclustered Nodes")
        lines.append("")
        for nid in report.orphan_node_ids:
            node = graph.get_node(nid)
            if node:
                preview = node.content[:60].replace("\n", " ")
                lines.append(f"- {nid}: \"{preview}\"")
        lines.append("")

    return "\n".join(lines)


def cmd_clusters(
    graph: BrainiacGraph,
    min_size: int = DEFAULT_MIN_CLUSTER_SIZE,
    threshold: Optional[float] = None,
    report_path: Optional[Path] = None,
):
    """Discover knowledge domains via hierarchical clustering."""
    all_embs = embeddings.load_embeddings(graph.graph_dir)

    if len(all_embs) < 2:
        print("Not enough nodes for clustering (need at least 2 with embeddings).")
        return

    t = threshold if threshold is not None else DEFAULT_DISTANCE_THRESHOLD

    condensed, ids = compute_distance_matrix(all_embs)
    assignment = run_clustering(condensed, ids, threshold=t, min_size=min_size)
    report = build_report(graph, assignment, min_size=min_size)

    # Print summary
    print(f"Discovered {len(report.clusters)} domains from {len(all_embs)} nodes:\n")
    for i, cluster in enumerate(report.clusters, 1):
        print(f"  {i}. {cluster.label} ({len(cluster.node_ids)} nodes, mostly {cluster.dominant_type})")
    if report.orphan_node_ids:
        print(f"\n  Unclustered: {len(report.orphan_node_ids)} nodes")
    if report.cross_links:
        print(f"  Cross-domain connections: {len(report.cross_links)}")

    # Write report
    out = report_path or REPORT_PATH
    out.parent.mkdir(parents=True, exist_ok=True)
    md = generate_report_markdown(graph, report)
    out.write_text(md, encoding="utf-8")
    print(f"\nReport written to: {out}")
