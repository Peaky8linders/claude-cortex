"""Graph → markdown view generation."""

from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path

from .graph import BrainiacGraph, MemoryNode
from . import VIEWS_DIR, KNOWLEDGE_ROOT


def render_views(graph: BrainiacGraph, views_dir: Path | None = None):
    """Generate all markdown views from graph nodes."""
    vdir = views_dir or VIEWS_DIR
    vdir.mkdir(parents=True, exist_ok=True)

    type_map = {
        "pattern": "patterns",
        "antipattern": "antipatterns",
        "workflow": "workflows",
        "hypothesis": "hypotheses",
        "solution": "solutions",
        "decision": "decisions",
    }

    for node_type, filename in type_map.items():
        nodes = graph.by_type(node_type)
        nodes.sort(key=lambda n: n.timestamp, reverse=True)
        md = _render_type_view(node_type, nodes, graph)
        (vdir / f"{filename}.md").write_text(md, encoding="utf-8")

    # Connections map
    md = _render_connections(graph)
    (vdir / "connections.md").write_text(md, encoding="utf-8")


def _render_type_view(node_type: str, nodes: list[MemoryNode], graph: BrainiacGraph) -> str:
    """Render a single type view."""
    title = node_type.replace("_", " ").title() + "s"
    lines = [f"# {title}", "", f"*Auto-generated from Brainiac graph. {len(nodes)} entries.*", ""]

    if not nodes:
        lines.append("No entries yet.")
        return "\n".join(lines)

    for node in nodes:
        lines.append(f"## [{node.id}] {_title_from_node(node)}")
        lines.append("")

        # Metadata line
        meta_parts = []
        if node.metadata.get("projects"):
            meta_parts.append(f"Projects: {', '.join(node.metadata['projects'])}")
        if node.metadata.get("confidence"):
            meta_parts.append(f"Confidence: {node.metadata['confidence']}")
        if node.metadata.get("status"):
            meta_parts.append(f"Status: {node.metadata['status']}")
        meta_parts.append(f"Created: {node.timestamp[:10]}")
        lines.append(f"*{' | '.join(meta_parts)}*")
        lines.append("")

        # Content (truncated for view)
        content_lines = node.content.strip().split("\n")
        if len(content_lines) > 10:
            lines.extend(content_lines[:10])
            lines.append(f"*...({len(content_lines) - 10} more lines)*")
        else:
            lines.extend(content_lines)
        lines.append("")

        # Tags
        if node.keywords or node.tags:
            all_tags = list(set(node.keywords + node.tags))
            lines.append(f"**Tags**: {', '.join(all_tags)}")
            lines.append("")

        # Related nodes
        neighbors = graph.neighbors(node.id)
        if neighbors:
            related = [f"`{n.id}` ({_title_from_node(n)})" for n in neighbors[:5]]
            lines.append(f"**Related**: {', '.join(related)}")
            if len(neighbors) > 5:
                lines.append(f"*...and {len(neighbors) - 5} more*")
            lines.append("")

        lines.append("---")
        lines.append("")

    return "\n".join(lines)


def _render_connections(graph: BrainiacGraph) -> str:
    """Render a cross-cutting relationship map."""
    lines = [
        "# Connection Map",
        "",
        "*Auto-generated from Brainiac graph. Shows cross-type relationships.*",
        "",
    ]

    stats = graph.stats()
    lines.append(f"**Total nodes**: {stats['total_nodes']} | "
                 f"**Total edges**: {stats['total_edges']}")
    lines.append("")

    # Edges by type
    lines.append("## Edge Distribution")
    for relation, count in sorted(stats["edges_by_relation"].items()):
        lines.append(f"- **{relation}**: {count}")
    lines.append("")

    # Most connected nodes
    if stats["most_connected"]:
        lines.append("## Most Connected Nodes")
        for item in stats["most_connected"]:
            node = graph.get_node(item["id"])
            name = _title_from_node(node) if node else item["id"]
            lines.append(f"- **{item['id']}** ({name}): {item['connections']} connections")
        lines.append("")

    # Cross-type edges (most interesting)
    lines.append("## Cross-Type Relationships")
    cross_edges = []
    for edge in graph.edges:
        src = graph.get_node(edge.source)
        tgt = graph.get_node(edge.target)
        if src and tgt:
            src_type = src.metadata.get("type", "?")
            tgt_type = tgt.metadata.get("type", "?")
            if src_type != tgt_type:
                cross_edges.append((src, tgt, edge))

    if cross_edges:
        for src, tgt, edge in cross_edges[:20]:
            lines.append(
                f"- `{src.id}` ({src.metadata.get('type', '?')}) "
                f"—[{edge.relation}]→ "
                f"`{tgt.id}` ({tgt.metadata.get('type', '?')})"
            )
    else:
        lines.append("No cross-type edges yet.")

    return "\n".join(lines)


def update_index(graph: BrainiacGraph, knowledge_root: Path | None = None):
    """Update INDEX.md stats from graph."""
    root = knowledge_root or KNOWLEDGE_ROOT
    index_path = root / "INDEX.md"
    if not index_path.exists():
        return

    stats = graph.stats()
    content = index_path.read_text(encoding="utf-8")

    # Replace stats section
    stats_pattern = r"## Stats\n.*?(?=\n##|\Z)"
    stats_block = (
        f"## Stats\n"
        f"- **Patterns**: {stats['nodes_by_type'].get('pattern', 0)}\n"
        f"- **Anti-patterns**: {stats['nodes_by_type'].get('antipattern', 0)}\n"
        f"- **Workflows**: {stats['nodes_by_type'].get('workflow', 0)}\n"
        f"- **Hypotheses**: {stats['nodes_by_type'].get('hypothesis', 0)}\n"
        f"- **Solutions**: {stats['nodes_by_type'].get('solution', 0)}\n"
        f"- **Decisions**: {stats['nodes_by_type'].get('decision', 0)}\n"
        f"- **Total edges**: {stats['total_edges']}\n"
        f"- **Last updated**: {datetime.now().strftime('%Y-%m-%d')}\n"
        f"- **Engine**: Brainiac v0.1.0 (graph-based)"
    )

    new_content = re.sub(stats_pattern, stats_block, content, flags=re.DOTALL)
    index_path.write_text(new_content, encoding="utf-8")


def _title_from_node(node: MemoryNode) -> str:
    """Extract a short title from node content or ID."""
    if node.keywords:
        return " ".join(node.keywords[:3]).title()
    first_line = node.content.strip().split("\n")[0]
    return first_line[:60] if first_line else node.id
