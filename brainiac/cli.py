"""CLI entry point for Brainiac knowledge graph operations."""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime
from pathlib import Path

from . import KNOWLEDGE_ROOT, GRAPH_DIR
from .graph import BrainiacGraph, MemoryNode, Edge
from . import embeddings
from .linker import link_new_node
from .consolidator import find_merge_candidates, find_abstraction_candidates, find_stale_nodes
from .retriever import retrieve, detect_intent
from .renderer import render_views, update_index


def cmd_quality(graph: BrainiacGraph, verbose: bool = False):
    """Compute and print quality score (0-100).

    Mirrors cortex/src/graph/knowledge-graph.ts computeQualityScore().
    Used by ralph-loop.sh and /run-tasks for quality gating.
    """
    s = graph.stats()
    total_nodes = s["total_nodes"]
    total_edges = s["total_edges"]
    type_counts = s["nodes_by_type"]

    # Baseline
    score = 70

    # +3 per decision node (max +15)
    decision_count = type_counts.get("decision", 0)
    score += min(decision_count * 3, 15)

    # +5 per solution node (max +10)
    solution_count = type_counts.get("solution", 0)
    score += min(solution_count * 5, 10)

    # +5 for good edge density (>= 1.5 edges per node)
    if total_nodes > 0 and total_edges / total_nodes >= 1.5:
        score += 5

    # -2 per orphaned node (max -15) — nodes with 0 edges
    # Use most_connected from stats() to find connected nodes
    orphan_count = 0
    if total_nodes > 0:
        connected = {item["id"] for item in s["most_connected"]}
        # most_connected only has top 5; scan edges for full set
        for e in graph.edges:
            connected.add(e.source)
            connected.add(e.target)
        orphan_count = sum(1 for n in graph.nodes if n not in connected)
        score -= min(orphan_count * 2, 15)

    # Clamp to 0-100
    score = max(0, min(100, score))

    if verbose:
        print(f"Quality: {score}/100")
        print(f"  Nodes: {total_nodes}, Edges: {total_edges}")
        print(f"  Decisions: {decision_count}, Solutions: {solution_count}")
        if total_nodes > 0:
            print(f"  Edge density: {total_edges / total_nodes:.2f}")
            print(f"  Orphans: {orphan_count}")
    else:
        print(score)


def cmd_expand(graph: BrainiacGraph, node_id: str):
    """Expand a lossless pointer — show full node content and connections.

    Part of the lossless context management system (LCM pattern).
    PostCompact injects compact pointers; this command recovers full context.
    Also searches snapshots for historical versions of the node.
    """
    node = graph.get_node(node_id)
    if not node:
        print(f"Node {node_id} not found in current graph.")
        # Search snapshots
        _search_snapshots(node_id)
        return

    print(f"\n=== {node.id} ===")
    print(f"Type: {node.metadata.get('type', 'unknown')}")
    print(f"Created: {node.timestamp}")
    if node.metadata.get("updated"):
        print(f"Updated: {node.metadata['updated']}")
    print(f"Status: {node.metadata.get('status', 'active')}")
    print(f"Confidence: {node.metadata.get('confidence', 'unknown')}")
    print(f"\nContent:")
    print(f"  {node.content}")
    print(f"\nKeywords: {', '.join(node.keywords)}")
    if node.tags:
        print(f"Tags: {', '.join(node.tags)}")
    if node.metadata.get("projects"):
        print(f"Projects: {', '.join(node.metadata['projects'])}")

    # Show connections
    edges = graph.edges_for(node_id)
    if edges:
        print(f"\nConnections ({len(edges)}):")
        for e in edges:
            other = e.target if e.source == node_id else e.source
            other_node = graph.get_node(other)
            other_label = other_node.content[:50] if other_node else "?"
            direction = "→" if e.source == node_id else "←"
            print(f"  {direction} [{e.relation}] {other}: {other_label}")


def _search_snapshots(node_id: str):
    """Search snapshot files for a node ID."""
    snapshots_dir = Path.home() / ".claude" / "knowledge" / "snapshots"
    if not snapshots_dir.exists():
        print("No snapshots available.")
        return

    snapshot_files = sorted(snapshots_dir.glob("nodes_*.json"), reverse=True)
    for snap_path in snapshot_files[:5]:
        try:
            with open(snap_path) as f:
                nodes = json.load(f)
            for n in nodes:
                if n.get("id") == node_id:
                    print(f"\nFound in snapshot {snap_path.name}:")
                    print(f"  Type: {n.get('metadata', {}).get('type', '?')}")
                    print(f"  Content: {n.get('content', '?')[:200]}")
                    return
        except Exception:
            continue
    print("Node not found in recent snapshots.")


def cmd_stats(graph: BrainiacGraph):
    """Show graph overview."""
    s = graph.stats()
    print(f"\n=== Brainiac Knowledge Graph ===")
    print(f"Nodes: {s['total_nodes']}  |  Edges: {s['total_edges']}")
    print(f"\nNodes by type:")
    for t, c in sorted(s["nodes_by_type"].items()):
        print(f"  {t}: {c}")
    print(f"\nEdges by relation:")
    for r, c in sorted(s["edges_by_relation"].items()):
        print(f"  {r}: {c}")
    if s["most_connected"]:
        print(f"\nMost connected:")
        for item in s["most_connected"]:
            print(f"  {item['id']}: {item['connections']} connections")


def cmd_search(graph: BrainiacGraph, query: str):
    """Semantic search via embeddings + graph traversal."""
    intent = detect_intent(query)
    print(f"\nSearching: \"{query}\" (intent: {intent})")

    results = retrieve(graph, query, top_k=10)

    if not results:
        print("No results found.")
        return

    print(f"\n{'ID':<12} {'Score':>6}  {'Type':<12} {'Title'}")
    print("-" * 70)
    for r in results:
        node_type = r.node.metadata.get("type", "?")
        title = " ".join(r.node.keywords[:4]) if r.node.keywords else r.node.id
        path_info = f" via {' → '.join(r.relations)}" if r.relations else ""
        print(f"{r.node.id:<12} {r.score:>6.3f}  {node_type:<12} {title}{path_info}")


def cmd_add(graph: BrainiacGraph, node_type: str, content: str, **kwargs):
    """Add a new node with auto-linking."""
    node_id = graph.next_id(node_type)

    # Extract keywords (simple: take capitalized/important words)
    words = re.findall(r"\b[A-Z][a-z]+\b|\b\w{5,}\b", content)
    keywords = list(dict.fromkeys(words))[:8]

    # Build node
    node = MemoryNode(
        id=node_id,
        content=content,
        timestamp=datetime.now().isoformat(timespec="seconds"),
        keywords=keywords,
        tags=kwargs.get("tags", []),
        context=content[:200],
        metadata={
            "type": node_type,
            "projects": kwargs.get("projects", []),
            "confidence": kwargs.get("confidence", "medium"),
            "status": "active",
            "source": "cli",
        },
    )

    # Compute embedding
    embed_text = f"{content} {' '.join(keywords)} {' '.join(node.tags)}"
    node.embedding = embeddings.embed(embed_text)

    # Add to graph
    graph.add_node(node)

    # Auto-link
    all_embs = embeddings.load_embeddings(graph.graph_dir)
    all_embs[node.id] = node.embedding
    link_new_node(graph, node, all_embs)

    # Save everything
    embeddings.save_embeddings(all_embs, graph.graph_dir)
    graph.save()

    # Render views
    render_views(graph)
    update_index(graph)

    print(f"\nAdded node: {node.id}")
    print(f"  Type: {node_type}")
    print(f"  Keywords: {', '.join(keywords)}")
    print(f"  Links: {len(node.links)} auto-created")
    return node


def cmd_consolidate(graph: BrainiacGraph):
    """Find merge, abstraction, and prune candidates."""
    all_embs = embeddings.load_embeddings(graph.graph_dir)

    print("\n=== Consolidation Report ===\n")

    # Merge candidates
    merges = find_merge_candidates(graph, all_embs)
    if merges:
        print(f"MERGE candidates ({len(merges)}):")
        for a, b, score in merges:
            print(f"  {a} + {b} (similarity: {score})")
    else:
        print("No merge candidates.")

    # Abstraction candidates
    abstractions = find_abstraction_candidates(graph, all_embs)
    if abstractions:
        print(f"\nABSTRACTION candidates ({len(abstractions)} clusters):")
        for cluster in abstractions:
            names = [graph.get_node(nid).id if graph.get_node(nid) else nid for nid in cluster]
            print(f"  Cluster: {', '.join(names)}")
    else:
        print("\nNo abstraction candidates.")

    # Stale nodes
    stale = find_stale_nodes(graph)
    if stale:
        print(f"\nSTALE nodes ({len(stale)}):")
        for node in stale:
            print(f"  {node.id} (last updated: {node.metadata.get('updated', node.timestamp)[:10]})")
    else:
        print("\nNo stale nodes.")


def cmd_render(graph: BrainiacGraph):
    """Regenerate markdown views from graph."""
    render_views(graph)
    update_index(graph)
    print(f"\nViews regenerated in {KNOWLEDGE_ROOT / 'views'}")
    print(f"INDEX.md updated with graph stats.")


def cmd_migrate(graph: BrainiacGraph):
    """Migrate existing markdown knowledge files into graph nodes."""
    dirs_to_scan = {
        "pattern": KNOWLEDGE_ROOT / "patterns",
        "antipattern": KNOWLEDGE_ROOT / "antipatterns",
        "workflow": KNOWLEDGE_ROOT / "workflows",
        "hypothesis": KNOWLEDGE_ROOT / "hypotheses",
        "solution": KNOWLEDGE_ROOT / "solutions",
        "decision": KNOWLEDGE_ROOT / "decisions",
    }

    migrated = 0
    all_embs = embeddings.load_embeddings(graph.graph_dir)

    for node_type, dir_path in dirs_to_scan.items():
        if not dir_path.exists():
            continue
        for md_file in dir_path.glob("*.md"):
            if md_file.name == "INDEX.md":
                continue

            content = md_file.read_text(encoding="utf-8")
            meta, body = _parse_frontmatter(content)

            if not body.strip():
                continue

            node_id = graph.next_id(node_type)

            # Extract keywords from frontmatter tags + content
            keywords = meta.get("tags", [])
            if not keywords:
                words = re.findall(r"\b[A-Z][a-z]+\b|\b\w{5,}\b", body)
                keywords = list(dict.fromkeys(words))[:8]

            node = MemoryNode(
                id=node_id,
                content=body.strip(),
                timestamp=meta.get("created", datetime.now().isoformat(timespec="seconds")),
                keywords=keywords[:8],
                tags=meta.get("tags", []),
                context=body[:200],
                metadata={
                    "type": node_type,
                    "projects": meta.get("projects", []),
                    "confidence": meta.get("confidence", "medium"),
                    "status": meta.get("status", "active"),
                    "source": f"migrated:{md_file.name}",
                    "updated": meta.get("updated", meta.get("created", "")),
                },
            )

            # Compute embedding
            embed_text = f"{body[:500]} {' '.join(keywords)} {' '.join(node.tags)}"
            node.embedding = embeddings.embed(embed_text)
            all_embs[node.id] = node.embedding

            graph.add_node(node)
            migrated += 1
            print(f"  Migrated: {md_file.name} -> {node.id} ({node_type})")

    # Auto-link all migrated nodes
    print(f"\nAuto-linking {migrated} nodes...")
    for node in graph.nodes.values():
        link_new_node(graph, node, all_embs)

    # Save
    embeddings.save_embeddings(all_embs, graph.graph_dir)
    graph.save()

    # Render views
    render_views(graph)
    update_index(graph)

    print(f"\nMigration complete: {migrated} nodes, {len(graph.edges)} edges")
    print(f"Views generated in {KNOWLEDGE_ROOT / 'views'}")


def cmd_link(graph: BrainiacGraph, id1: str, id2: str, relation: str):
    """Manually add an edge between two nodes."""
    if not graph.get_node(id1):
        print(f"Error: node {id1} not found")
        return
    if not graph.get_node(id2):
        print(f"Error: node {id2} not found")
        return
    if relation not in ("semantic", "temporal", "causal", "entity"):
        print(f"Error: invalid relation '{relation}'. Use: semantic, temporal, causal, entity")
        return

    edge = graph.add_edge(Edge(
        source=id1, target=id2, relation=relation, weight=1.0,
        metadata={"auto": False, "created": datetime.now().isoformat(timespec="seconds")},
    ))
    graph.save()
    print(f"Edge added: {id1} —[{relation}]→ {id2}")


def _parse_frontmatter(content: str) -> tuple[dict, str]:
    """Parse YAML-like frontmatter from markdown."""
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n(.*)", content, re.DOTALL)
    if not match:
        return {}, content

    frontmatter_text = match.group(1)
    body = match.group(2)
    meta = {}

    for line in frontmatter_text.split("\n"):
        line = line.strip()
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        key = key.strip()
        value = value.strip()

        # Parse lists: [a, b, c]
        if value.startswith("[") and value.endswith("]"):
            items = [i.strip().strip("'\"") for i in value[1:-1].split(",")]
            meta[key] = [i for i in items if i]
        else:
            meta[key] = value.strip("'\"")

    return meta, body


def main():
    if len(sys.argv) < 2:
        print("Usage: python -m brainiac.cli <command> [args]")
        print("Commands: stats, quality, search, expand, add, link, consolidate, render, migrate")
        sys.exit(1)

    graph = BrainiacGraph()
    command = sys.argv[1]

    if command == "stats":
        cmd_stats(graph)
    elif command == "quality":
        cmd_quality(graph, verbose="--verbose" in sys.argv)
    elif command == "expand":
        if len(sys.argv) < 3:
            print("Usage: python -m brainiac expand <node-id>")
            sys.exit(1)
        cmd_expand(graph, sys.argv[2])
    elif command == "search":
        if len(sys.argv) < 3:
            print("Usage: python -m brainiac.cli search <query>")
            sys.exit(1)
        cmd_search(graph, " ".join(sys.argv[2:]))
    elif command == "add":
        if len(sys.argv) < 4:
            print("Usage: python -m brainiac.cli add <type> <content>")
            sys.exit(1)
        cmd_add(graph, sys.argv[2], " ".join(sys.argv[3:]))
    elif command == "link":
        if len(sys.argv) < 5:
            print("Usage: python -m brainiac.cli link <id1> <id2> <relation>")
            sys.exit(1)
        cmd_link(graph, sys.argv[2], sys.argv[3], sys.argv[4])
    elif command == "consolidate":
        cmd_consolidate(graph)
    elif command == "render":
        cmd_render(graph)
    elif command == "migrate":
        cmd_migrate(graph)
    else:
        print(f"Unknown command: {command}")
        sys.exit(1)


if __name__ == "__main__":
    main()
