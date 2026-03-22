"""Core graph engine: nodes, edges, CRUD, queries."""

from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from . import GRAPH_DIR


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


class BrainiacGraph:
    """JSON-backed knowledge graph with typed edges."""

    def __init__(self, graph_dir: Optional[Path] = None):
        self.graph_dir = graph_dir or GRAPH_DIR
        self.graph_dir.mkdir(parents=True, exist_ok=True)
        self.nodes: dict[str, MemoryNode] = {}
        self.edges: list[Edge] = []
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

    def save(self):
        self._nodes_path().write_text(
            json.dumps([n.to_dict() for n in self.nodes.values()], indent=2),
            encoding="utf-8",
        )
        self._edges_path().write_text(
            json.dumps([e.to_dict() for e in self.edges], indent=2),
            encoding="utf-8",
        )

    # --- Node CRUD ---

    def add_node(self, node: MemoryNode) -> MemoryNode:
        if node.id in self.nodes:
            raise ValueError(f"Node {node.id} already exists")
        self.nodes[node.id] = node
        return node

    def update_node(self, node_id: str, **kwargs) -> MemoryNode:
        if node_id not in self.nodes:
            raise KeyError(f"Node {node_id} not found")
        node = self.nodes[node_id]
        for k, v in kwargs.items():
            if hasattr(node, k):
                setattr(node, k, v)
        return node

    def delete_node(self, node_id: str):
        self.nodes.pop(node_id, None)
        self.edges = [e for e in self.edges if e.source != node_id and e.target != node_id]
        # Remove from link lists
        for n in self.nodes.values():
            if node_id in n.links:
                n.links.remove(node_id)

    def get_node(self, node_id: str) -> Optional[MemoryNode]:
        return self.nodes.get(node_id)

    # --- Edge CRUD ---

    def add_edge(self, edge: Edge) -> Edge:
        # Deduplicate
        for e in self.edges:
            if e.source == edge.source and e.target == edge.target and e.relation == edge.relation:
                e.weight = max(e.weight, edge.weight)
                e.metadata.update(edge.metadata)
                return e
        self.edges.append(edge)
        # Update link lists
        if edge.source in self.nodes and edge.target not in self.nodes[edge.source].links:
            self.nodes[edge.source].links.append(edge.target)
        if edge.target in self.nodes and edge.source not in self.nodes[edge.target].links:
            self.nodes[edge.target].links.append(edge.source)
        return edge

    def remove_edge(self, source: str, target: str, relation: Optional[str] = None):
        self.edges = [
            e for e in self.edges
            if not (e.source == source and e.target == target and (relation is None or e.relation == relation))
        ]

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
        for e in self.edges:
            if e.source == node_id and (relation is None or e.relation == relation):
                connected_ids.add(e.target)
            if e.target == node_id and (relation is None or e.relation == relation):
                connected_ids.add(e.source)
        return [self.nodes[nid] for nid in connected_ids if nid in self.nodes]

    def edges_for(self, node_id: str, relation: Optional[str] = None) -> list[Edge]:
        return [
            e for e in self.edges
            if (e.source == node_id or e.target == node_id)
            and (relation is None or e.relation == relation)
        ]

    # --- Stats ---

    def stats(self) -> dict:
        from collections import Counter
        type_counts = Counter(n.metadata.get("type", "unknown") for n in self.nodes.values())
        edge_counts = Counter(e.relation for e in self.edges)
        # Most connected nodes
        connection_counts = Counter()
        for e in self.edges:
            connection_counts[e.source] += 1
            connection_counts[e.target] += 1
        top_connected = connection_counts.most_common(5)

        return {
            "total_nodes": len(self.nodes),
            "total_edges": len(self.edges),
            "nodes_by_type": dict(type_counts),
            "edges_by_relation": dict(edge_counts),
            "most_connected": [
                {"id": nid, "connections": count}
                for nid, count in top_connected
            ],
        }

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
