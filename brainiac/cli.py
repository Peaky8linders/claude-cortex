"""CLI entry point for Brainiac knowledge graph operations."""

from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path

from . import KNOWLEDGE_ROOT, GRAPH_DIR
from .graph import BrainiacGraph, MemoryNode, Edge
from . import embeddings
from .linker import link_new_node
from .consolidator import find_merge_candidates, find_abstraction_candidates, find_stale_nodes, node_last_touched
from .retriever import retrieve, detect_intent, record_access
from .renderer import render_views, update_index


# --- Quality score constants ---
# These values define the quality formula. Keep in sync with quality-spec.json
# if/when a shared spec is introduced (eng review issue #2).
QUALITY_BASELINE = 70
QUALITY_DECISION_WEIGHT = 3      # +3 per decision node
QUALITY_DECISION_CAP = 15        # max bonus from decisions
QUALITY_SOLUTION_WEIGHT = 5      # +5 per solution node
QUALITY_SOLUTION_CAP = 10        # max bonus from solutions
QUALITY_EDGE_DENSITY_THRESHOLD = 1.5  # edges/node ratio for bonus
QUALITY_EDGE_DENSITY_BONUS = 5
QUALITY_ORPHAN_PENALTY = 2       # -2 per orphaned node
QUALITY_ORPHAN_CAP = 15          # max penalty from orphans


def cmd_quality(graph: BrainiacGraph, verbose: bool = False):
    """Compute and print quality score (0-100).

    Mirrors cortex/src/graph/knowledge-graph.ts computeQualityScore().
    Used by ralph-loop.sh and /run-tasks for quality gating.
    """
    s = graph.stats()
    total_nodes = s["total_nodes"]
    total_edges = s["total_edges"]
    type_counts = s["nodes_by_type"]

    score = QUALITY_BASELINE

    decision_count = type_counts.get("decision", 0)
    score += min(decision_count * QUALITY_DECISION_WEIGHT, QUALITY_DECISION_CAP)

    solution_count = type_counts.get("solution", 0)
    score += min(solution_count * QUALITY_SOLUTION_WEIGHT, QUALITY_SOLUTION_CAP)

    if total_nodes > 0 and total_edges / total_nodes >= QUALITY_EDGE_DENSITY_THRESHOLD:
        score += QUALITY_EDGE_DENSITY_BONUS

    orphan_count = s["orphan_count"]
    score -= min(orphan_count * QUALITY_ORPHAN_PENALTY, QUALITY_ORPHAN_CAP)

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
    """Expand a lossless pointer -- show full node content and connections.

    Part of the lossless context management system (LCM pattern).
    PostCompact injects compact pointers; this command recovers full context.
    Also searches snapshots for historical versions of the node.
    """
    node = graph.get_node(node_id)
    if not node:
        print(f"Node {node_id} not found in current graph.")
        _search_snapshots(node_id)
        return

    print(f"\n=== {node.id} ===")
    print(f"Type: {node.metadata.get('type', 'unknown')}")
    print(f"Created: {node.timestamp}")
    if node.metadata.get("updated"):
        print(f"Updated: {node.metadata['updated']}")
    if node.metadata.get("last_accessed"):
        print(f"Last accessed: {node.metadata['last_accessed']}")
    print(f"Status: {node.metadata.get('status', 'active')}")
    print(f"Salience: {node.metadata.get('salience', 'active')}")
    print(f"Confidence: {node.metadata.get('confidence', 'unknown')}")
    access_count = node.metadata.get("access_count", 0)
    unique_sessions = node.metadata.get("unique_sessions", 0)
    if access_count > 0:
        print(f"Access: {access_count} times across {unique_sessions} sessions")
    print(f"\nContent:")
    print(f"  {node.content}")
    print(f"\nKeywords: {', '.join(node.keywords)}")
    if node.tags:
        print(f"Tags: {', '.join(node.tags)}")
    if node.metadata.get("projects"):
        print(f"Projects: {', '.join(node.metadata['projects'])}")

    edges = graph.edges_for(node_id)
    if edges:
        print(f"\nConnections ({len(edges)}):")
        for e in edges:
            other = e.target if e.source == node_id else e.source
            other_node = graph.get_node(other)
            other_label = other_node.content[:50] if other_node else "?"
            direction = "\u2192" if e.source == node_id else "\u2190"
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
    print(f"Nodes: {s['total_nodes']}  |  Edges: {s['total_edges']}  |  Orphans: {s['orphan_count']}")
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

    session_id = os.environ.get("CLAUDE_SESSION_ID", "")
    record_access(graph, [r.node.id for r in results], session_id)
    graph.save()

    print(f"\n{'ID':<12} {'Score':>6}  {'Type':<12} {'Title'}")
    print("-" * 70)
    for r in results:
        node_type = r.node.metadata.get("type", "?")
        title = " ".join(r.node.keywords[:4]) if r.node.keywords else r.node.id
        path_info = f" via {' \u2192 '.join(r.relations)}" if r.relations else ""
        print(f"{r.node.id:<12} {r.score:>6.3f}  {node_type:<12} {title}{path_info}")


def cmd_add(graph: BrainiacGraph, node_type: str, content: str, **kwargs):
    """Add a new node with auto-linking."""
    node_id = graph.next_id(node_type)

    words = re.findall(r"\b[A-Z][a-z]+\b|\b\w{5,}\b", content)
    keywords = list(dict.fromkeys(words))[:8]

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
            "salience": "active",
            "source": "cli",
            "access_count": 0,
            "unique_sessions": 0,
        },
    )

    embed_text = f"{content} {' '.join(keywords)} {' '.join(node.tags)}"
    node.embedding = embeddings.embed(embed_text)

    graph.add_node(node)

    all_embs = embeddings.load_embeddings(graph.graph_dir)
    all_embs[node.id] = node.embedding
    link_new_node(graph, node, all_embs)

    embeddings.save_embeddings(all_embs, graph.graph_dir)
    graph.save()

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

    merges = find_merge_candidates(graph, all_embs)
    if merges:
        print(f"MERGE candidates ({len(merges)}):")
        for a, b, score in merges:
            print(f"  {a} + {b} (similarity: {score})")
    else:
        print("No merge candidates.")

    abstractions = find_abstraction_candidates(graph, all_embs)
    if abstractions:
        print(f"\nABSTRACTION candidates ({len(abstractions)} clusters):")
        for cluster in abstractions:
            names = [graph.get_node(nid).id if graph.get_node(nid) else nid for nid in cluster]
            print(f"  Cluster: {', '.join(names)}")
    else:
        print("\nNo abstraction candidates.")

    stale = find_stale_nodes(graph)
    if stale:
        print(f"\nSTALE nodes ({len(stale)}):")
        for node in stale:
            print(f"  {node.id} (last updated: {node.metadata.get('updated', node.timestamp)[:10]})")
    else:
        print("\nNo stale nodes.")


def cmd_demote(graph: BrainiacGraph, stale_days: int = 30, dry_run: bool = True):
    """Demote stale nodes to dormant salience.

    Nodes not accessed in `stale_days` with salience='active' or 'background'
    get demoted to 'dormant'. Dormant nodes are excluded from retrieval but
    still exist in the graph and can be found via `brainiac expand`.
    """
    cutoff = datetime.now() - timedelta(days=stale_days)
    candidates = []

    for node in graph.nodes.values():
        salience = node.metadata.get("salience", "active")
        if salience == "dormant":
            continue

        last_dt = node_last_touched(node)
        if last_dt is None:
            continue

        if last_dt < cutoff:
            candidates.append(node)

    if not candidates:
        print(f"No nodes stale for {stale_days}+ days. Graph is fresh.")
        return

    if dry_run:
        print(f"\nDEMOTION candidates ({len(candidates)} nodes stale for {stale_days}+ days):")
        for node in candidates:
            last = node.metadata.get("last_accessed") or node.metadata.get("updated") or node.timestamp
            sessions = node.metadata.get("unique_sessions", 0)
            print(f"  {node.id} (last: {str(last)[:10]}, sessions: {sessions}): {node.content[:60]}")
        print(f"\nRun with --apply to demote these nodes to dormant.")
    else:
        for node in candidates:
            node.metadata["salience"] = "dormant"
            node.metadata["demoted_at"] = datetime.now().isoformat(timespec="seconds")
        graph.save()
        print(f"\nDemoted {len(candidates)} nodes to dormant salience.")
        print("They won't appear in retrieval but can still be found via `brainiac expand <id>`.")


def cmd_promote(graph: BrainiacGraph, node_id: str, salience: str = "active"):
    """Promote a node back from dormant/background to active salience."""
    if salience not in ("active", "background"):
        print(f"Error: salience must be 'active' or 'background', got '{salience}'")
        return

    node = graph.get_node(node_id)
    if not node:
        print(f"Node {node_id} not found.")
        return

    old_salience = node.metadata.get("salience", "active")
    node.metadata["salience"] = salience
    node.metadata.pop("demoted_at", None)
    graph.save()
    print(f"Promoted {node_id}: {old_salience} \u2192 {salience}")


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

            embed_text = f"{body[:500]} {' '.join(keywords)} {' '.join(node.tags)}"
            node.embedding = embeddings.embed(embed_text)
            all_embs[node.id] = node.embedding

            graph.add_node(node)
            migrated += 1
            print(f"  Migrated: {md_file.name} -> {node.id} ({node_type})")

    print(f"\nAuto-linking {migrated} nodes...")
    for node in graph.nodes.values():
        link_new_node(graph, node, all_embs)

    embeddings.save_embeddings(all_embs, graph.graph_dir)
    graph.save()

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
    print(f"Edge added: {id1} \u2014[{relation}]\u2192 {id2}")


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

        if value.startswith("[") and value.endswith("]"):
            items = [i.strip().strip("'\"") for i in value[1:-1].split(",")]
            meta[key] = [i for i in items if i]
        else:
            meta[key] = value.strip("'\"")

    return meta, body


# --- Command registry ---
# Maps command name -> (handler, args_spec, usage)
# args_spec: "none" | "query" | "node_id" | "type_content" | "link" | "demote" | "promote"

def _dispatch_stats(graph, _args):
    cmd_stats(graph)

def _dispatch_quality(graph, args):
    cmd_quality(graph, verbose="--verbose" in args)

def _dispatch_expand(graph, args):
    if len(args) < 1:
        print("Usage: python -m brainiac expand <node-id>")
        sys.exit(1)
    cmd_expand(graph, args[0])

def _dispatch_search(graph, args):
    if len(args) < 1:
        print("Usage: python -m brainiac search <query>")
        sys.exit(1)
    cmd_search(graph, " ".join(args))

def _dispatch_add(graph, args):
    if len(args) < 2:
        print("Usage: python -m brainiac add <type> <content>")
        sys.exit(1)
    cmd_add(graph, args[0], " ".join(args[1:]))

def _dispatch_link(graph, args):
    if len(args) < 3:
        print("Usage: python -m brainiac link <id1> <id2> <relation>")
        sys.exit(1)
    cmd_link(graph, args[0], args[1], args[2])

def _dispatch_consolidate(graph, _args):
    cmd_consolidate(graph)

def _dispatch_demote(graph, args):
    days = 30
    apply = False
    for arg in args:
        if arg.startswith("--days="):
            days = int(arg.split("=")[1])
        elif arg == "--apply":
            apply = True
    cmd_demote(graph, stale_days=days, dry_run=not apply)

def _dispatch_promote(graph, args):
    if len(args) < 1:
        print("Usage: python -m brainiac promote <node-id> [--salience=active|background]")
        sys.exit(1)
    salience = "active"
    for arg in args[1:]:
        if arg.startswith("--salience="):
            salience = arg.split("=")[1]
    cmd_promote(graph, args[0], salience)

def _dispatch_render(graph, _args):
    cmd_render(graph)

def _dispatch_migrate(graph, _args):
    cmd_migrate(graph)


COMMANDS = {
    "stats": _dispatch_stats,
    "quality": _dispatch_quality,
    "expand": _dispatch_expand,
    "search": _dispatch_search,
    "add": _dispatch_add,
    "link": _dispatch_link,
    "consolidate": _dispatch_consolidate,
    "demote": _dispatch_demote,
    "promote": _dispatch_promote,
    "render": _dispatch_render,
    "migrate": _dispatch_migrate,
}


def main():
    if len(sys.argv) < 2:
        cmds = ", ".join(sorted(COMMANDS.keys()))
        print(f"Usage: python -m brainiac <command> [args]")
        print(f"Commands: {cmds}")
        sys.exit(1)

    command = sys.argv[1]
    handler = COMMANDS.get(command)
    if handler is None:
        print(f"Unknown command: {command}")
        sys.exit(1)

    graph = BrainiacGraph()
    handler(graph, sys.argv[2:])


if __name__ == "__main__":
    main()
