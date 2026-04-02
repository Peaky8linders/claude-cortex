"""Core graph engine: nodes, edges, CRUD, queries."""

from __future__ import annotations

import json
import shutil
import tempfile
from collections import Counter, defaultdict
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from . import GRAPH_DIR


# --- Controlled vocabulary ---
VALID_RELATIONS = frozenset({"semantic", "temporal", "causal", "entity"})

VALID_NODE_TYPES = frozenset({
    "pattern", "antipattern", "workflow", "hypothesis",
    "solution", "decision", "memory",
})


@dataclass
class MemoryNode:
    """A-MEM inspired atomic memory unit with 7 core fields."""

    id: str                              # "pat-001", "hyp-003"
    content: str                         # Core knowledge text
    timestamp: str                       # ISO 8601
    keywords: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    context: str = ""                    # Semantic description for linking
    embedding: list[float] = field(default_factory=list)
    links: list[str] = field(default_factory=list)
    metadata: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        d = asdict(self)
        # Don't persist embeddings in nodes.json (stored in .npz)
        d.pop("embedding", None)
        return d

    @classmethod
    def from_dict(cls, d: dict) -> MemoryNode:
        d.setdefault("embedding", [])
        return cls(**{k: v for k, v in d.items() if k in cls.__dataclass_fields__})


@dataclass
class Edge:
    """MAGMA-inspired typed relationship."""

    source: str
    target: str
    relation: str          # semantic | temporal | causal | entity
    weight: float = 1.0
    metadata: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> Edge:
        return cls(**{k: v for k, v in d.items() if k in cls.__dataclass_fields__})


@dataclass
class IntegrityReport:
    """Result of a graph integrity check."""

    orphan_nodes: list[str] = field(default_factory=list)
    invalid_edges: list[str] = field(default_factory=list)
    invalid_relations: list[str] = field(default_factory=list)
    invalid_node_types: list[str] = field(default_factory=list)
    dangling_links: list[str] = field(default_factory=list)

    @property
    def is_healthy(self) -> bool:
        return not any([
            self.orphan_nodes, self.invalid_edges, self.invalid_relations,
            self.invalid_node_types, self.dangling_links,
        ])

    def summary(self) -> str:
        if self.is_healthy:
            return "Graph integrity: HEALTHY"
        lines = ["Graph integrity: ISSUES FOUND"]
        if self.orphan_nodes:
            lines.append(f"  Orphan nodes ({len(self.orphan_nodes)}): {', '.join(self.orphan_nodes[:5])}")
        if self.invalid_edges:
            lines.append(f"  Invalid edges ({len(self.invalid_edges)}): {', '.join(self.invalid_edges[:5])}")
        if self.invalid_relations:
            lines.append(f"  Invalid relations ({len(self.invalid_relations)}): {', '.join(self.invalid_relations[:5])}")
        if self.invalid_node_types:
            lines.append(f"  Invalid node types ({len(self.invalid_node_types)}): {', '.join(self.invalid_node_types[:5])}")
        if self.dangling_links:
            lines.append(f"  Dangling links ({len(self.dangling_links)}): {', '.join(self.dangling_links[:5])}")
        return "\n".join(lines)


class BrainiacGraph:
    """JSON-backed knowledge graph with typed edges and adjacency index."""

    def __init__(self, graph_dir: Optional[Path] = None):
        self.graph_dir = graph_dir or GRAPH_DIR
        self.graph_dir.mkdir(parents=True, exist_ok=True)
        self.nodes: dict[str, MemoryNode] = {}
        self.edges: list[Edge] = []
        self._adj: dict[str, list[Edge]] = defaultdict(list)  # adjacency index
        self._audit_log: list[dict] = []
        self._load()

    # --- Persistence ---

    def _nodes_path(self) -> Path:
        return self.graph_dir / "nodes.json"

    def _edges_path(self) -> Path:
        return self.graph_dir / "edges.json"

    def _load(self):
        if self._nodes_path().exists():
            try:
                data = json.loads(self._nodes_path().read_text(encoding="utf-8"))
                self.nodes = {n["id"]: MemoryNode.from_dict(n) for n in data}
            except (json.JSONDecodeError, KeyError) as e:
                print(f"Warning: corrupted nodes.json, starting fresh: {e}")
                self.nodes = {}
        if self._edges_path().exists():
            try:
                data = json.loads(self._edges_path().read_text(encoding="utf-8"))
                self.edges = [Edge.from_dict(e) for e in data]
            except json.JSONDecodeError as e:
                print(f"Warning: corrupted edges.json, starting fresh: {e}")
                self.edges = []
        # Rebuild adjacency index from loaded edges
        self._rebuild_adj()

    def _rebuild_adj(self):
        """Rebuild the adjacency index from the edge list."""
        self._adj = defaultdict(list)
        for e in self.edges:
            self._adj[e.source].append(e)
            self._adj[e.target].append(e)

    def save(self):
        """Persist graph to JSON with directory-level atomic writes.

        Writes both nodes.json and edges.json to a temp directory, then
        replaces them together. This prevents inconsistency if the process
        is killed between writing the two files.
        Also persists any pending audit log entries.
        """
        nodes_json = json.dumps([n.to_dict() for n in self.nodes.values()], indent=2)
        edges_json = json.dumps([e.to_dict() for e in self.edges], indent=2)

        # Write both files to a temp directory, then move them atomically
        tmp_dir = Path(tempfile.mkdtemp(dir=self.graph_dir, prefix=".save-"))
        try:
            (tmp_dir / "nodes.json").write_text(nodes_json, encoding="utf-8")
            (tmp_dir / "edges.json").write_text(edges_json, encoding="utf-8")
            # Atomic replacement of each file
            (tmp_dir / "nodes.json").replace(self._nodes_path())
            (tmp_dir / "edges.json").replace(self._edges_path())
        except Exception:
            # Clean up temp files on failure — don't leave orphans
            shutil.rmtree(tmp_dir, ignore_errors=True)
            raise
        finally:
            # Clean up the (now empty) temp directory
            shutil.rmtree(tmp_dir, ignore_errors=True)

        # Persist audit log
        audit_entries = self.flush_audit_log()
        self._persist_audit(audit_entries)

    # --- Audit Trail ---

    def _audit(self, action: str, target: str, details: Optional[dict] = None):
        """Record a graph mutation for audit trail."""
        entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "action": action,
            "target": target,
        }
        if details:
            entry["details"] = details
        self._audit_log.append(entry)

    def flush_audit_log(self) -> list[dict]:
        """Return and clear the audit log. Called by save() to persist."""
        log = self._audit_log
        self._audit_log = []
        return log

    _AUDIT_MAX_LINES = 5000

    def _persist_audit(self, entries: list[dict]):
        """Append audit entries to the audit log file, rotating if too large."""
        if not entries:
            return
        audit_path = self.graph_dir / "audit.jsonl"

        # Rotate if file exceeds max lines
        if audit_path.exists():
            try:
                existing = audit_path.read_text(encoding="utf-8").splitlines()
                if len(existing) > self._AUDIT_MAX_LINES:
                    # Keep the most recent half
                    keep = existing[len(existing) // 2:]
                    audit_path.write_text("\n".join(keep) + "\n", encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                pass

        with open(audit_path, "a", encoding="utf-8") as f:
            for entry in entries:
                f.write(json.dumps(entry) + "\n")

    # --- Node CRUD ---

    def add_node(self, node: MemoryNode) -> MemoryNode:
        if node.id in self.nodes:
            raise ValueError(f"Node {node.id} already exists")
        self.nodes[node.id] = node
        self._audit("add_node", node.id, {"type": node.metadata.get("type", "unknown")})
        return node

    def update_node(self, node_id: str, **kwargs) -> MemoryNode:
        if node_id not in self.nodes:
            raise KeyError(f"Node {node_id} not found")
        node = self.nodes[node_id]
        changed = {k: v for k, v in kwargs.items() if hasattr(node, k)}
        for k, v in changed.items():
            setattr(node, k, v)
        self._audit("update_node", node_id, {"fields": list(changed.keys())})
        return node

    def delete_node(self, node_id: str):
        self._audit("delete_node", node_id)
        self.nodes.pop(node_id, None)
        self.edges = [e for e in self.edges if e.source != node_id and e.target != node_id]
        self._rebuild_adj()
        # Remove from link lists
        for n in self.nodes.values():
            if node_id in n.links:
                n.links.remove(node_id)

    def get_node(self, node_id: str) -> Optional[MemoryNode]:
        return self.nodes.get(node_id)

    # --- Edge CRUD ---

    def add_edge(self, edge: Edge) -> Edge:
        # Validate relation type
        if edge.relation not in VALID_RELATIONS:
            raise ValueError(
                f"Invalid relation '{edge.relation}'. "
                f"Must be one of: {', '.join(sorted(VALID_RELATIONS))}"
            )
        # Validate endpoint nodes exist
        if edge.source not in self.nodes:
            raise ValueError(f"Source node '{edge.source}' not found in graph")
        if edge.target not in self.nodes:
            raise ValueError(f"Target node '{edge.target}' not found in graph")
        # Deduplicate
        for e in self.edges:
            if e.source == edge.source and e.target == edge.target and e.relation == edge.relation:
                e.weight = max(e.weight, edge.weight)
                e.metadata.update(edge.metadata)
                return e
        self.edges.append(edge)
        self._audit("add_edge", f"{edge.source}->{edge.target}", {"relation": edge.relation})
        # Update adjacency index
        self._adj[edge.source].append(edge)
        self._adj[edge.target].append(edge)
        # Update link lists
        if edge.source in self.nodes and edge.target not in self.nodes[edge.source].links:
            self.nodes[edge.source].links.append(edge.target)
        if edge.target in self.nodes and edge.source not in self.nodes[edge.target].links:
            self.nodes[edge.target].links.append(edge.source)
        return edge

    def remove_edge(self, source: str, target: str, relation: Optional[str] = None):
        self._audit("remove_edge", f"{source}->{target}", {"relation": relation or "all"})
        self.edges = [
            e for e in self.edges
            if not (e.source == source and e.target == target and (relation is None or e.relation == relation))
        ]
        self._rebuild_adj()

    # --- Queries ---

    def by_type(self, node_type: str) -> list[MemoryNode]:
        return [n for n in self.nodes.values() if n.metadata.get("type") == node_type]

    def by_tag(self, tag: str) -> list[MemoryNode]:
        return [n for n in self.nodes.values() if tag in n.tags]

    def by_project(self, project: str) -> list[MemoryNode]:
        return [
            n for n in self.nodes.values()
            if project in n.metadata.get("projects", [])
        ]

    def neighbors(self, node_id: str, relation: Optional[str] = None) -> list[MemoryNode]:
        connected_ids = set()
        for e in self._adj.get(node_id, []):
            if relation is not None and e.relation != relation:
                continue
            other = e.target if e.source == node_id else e.source
            connected_ids.add(other)
        return [self.nodes[nid] for nid in connected_ids if nid in self.nodes]

    def edges_for(self, node_id: str, relation: Optional[str] = None) -> list[Edge]:
        """O(1) edge lookup via adjacency index."""
        edges = self._adj.get(node_id, [])
        if relation is not None:
            return [e for e in edges if e.relation == relation]
        return list(edges)

    # --- Stats ---

    def stats(self) -> dict:
        type_counts = Counter(n.metadata.get("type", "unknown") for n in self.nodes.values())
        edge_counts = Counter(e.relation for e in self.edges)
        # Most connected nodes
        connection_counts = Counter()
        for e in self.edges:
            connection_counts[e.source] += 1
            connection_counts[e.target] += 1
        top_connected = connection_counts.most_common(5)

        # Orphan count: nodes with zero edges
        connected_nodes = set(connection_counts.keys())
        orphan_count = sum(1 for nid in self.nodes if nid not in connected_nodes)

        return {
            "total_nodes": len(self.nodes),
            "total_edges": len(self.edges),
            "nodes_by_type": dict(type_counts),
            "edges_by_relation": dict(edge_counts),
            "orphan_count": orphan_count,
            "most_connected": [
                {"id": nid, "connections": count}
                for nid, count in top_connected
            ],
        }

    # --- Integrity Validation ---

    def validate(self) -> IntegrityReport:
        """Check graph integrity and return a report."""
        report = IntegrityReport()

        # Find orphan nodes (no edges at all)
        connected_nodes: set[str] = set()
        for e in self.edges:
            connected_nodes.add(e.source)
            connected_nodes.add(e.target)
        for nid in self.nodes:
            if nid not in connected_nodes:
                report.orphan_nodes.append(nid)

        # Find edges referencing non-existent nodes
        for e in self.edges:
            if e.source not in self.nodes:
                report.invalid_edges.append(f"{e.source}->{e.target} (missing source)")
            if e.target not in self.nodes:
                report.invalid_edges.append(f"{e.source}->{e.target} (missing target)")

        # Find invalid relation types
        for e in self.edges:
            if e.relation not in VALID_RELATIONS:
                report.invalid_relations.append(f"{e.source}->{e.target}: '{e.relation}'")

        # Find invalid node types
        for n in self.nodes.values():
            node_type = n.metadata.get("type", "")
            if node_type and node_type not in VALID_NODE_TYPES:
                report.invalid_node_types.append(f"{n.id}: '{node_type}'")

        # Find dangling links (node.links referencing non-existent nodes)
        for n in self.nodes.values():
            for link_id in n.links:
                if link_id not in self.nodes:
                    report.dangling_links.append(f"{n.id} -> {link_id}")

        return report

    def repair(self) -> IntegrityReport:
        """Fix integrity issues: remove dangling edges/links, remap invalid relations.

        Returns the report of issues that were found and fixed.
        """
        report = self.validate()

        # Remove edges with missing nodes
        if report.invalid_edges:
            self.edges = [
                e for e in self.edges
                if e.source in self.nodes and e.target in self.nodes
            ]
            self._audit("repair", "removed_dangling_edges", {"count": len(report.invalid_edges)})

        # Remap invalid relation types to "semantic" (safest default)
        if report.invalid_relations:
            for e in self.edges:
                if e.relation not in VALID_RELATIONS:
                    e.relation = "semantic"
            self._audit("repair", "remapped_invalid_relations", {"count": len(report.invalid_relations)})

        # Remove dangling links
        if report.dangling_links:
            for n in self.nodes.values():
                n.links = [lid for lid in n.links if lid in self.nodes]
            self._audit("repair", "removed_dangling_links", {"count": len(report.dangling_links)})

        self._rebuild_adj()
        return report

    # --- ID Generation ---

    def next_id(self, node_type: str) -> str:
        prefix_map = {
            "pattern": "pat", "antipattern": "anti", "workflow": "wf",
            "hypothesis": "hyp", "solution": "sol", "decision": "dec",
        }
        prefix = prefix_map.get(node_type, "mem")
        existing = [n.id for n in self.nodes.values() if n.id.startswith(prefix + "-")]
        if not existing:
            return f"{prefix}-001"
        max_num = max(int(nid.split("-")[-1]) for nid in existing)
        width = max(3, len(str(max_num + 1)))
        return f"{prefix}-{max_num + 1:0{width}d}"
