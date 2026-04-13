"""Knowledge inbox: batch-process markdown files into graph nodes."""

from __future__ import annotations

import re
import shutil
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

from . import KNOWLEDGE_ROOT
from .graph import BrainiacGraph, MemoryNode
from . import embeddings
from .linker import link_new_node
from .renderer import render_views, update_index


INBOX_DIR = KNOWLEDGE_ROOT / "inbox"
PROCESSED_DIR = INBOX_DIR / "processed"
ENRICHMENT_THRESHOLD = 0.85
MAX_CONTENT_LENGTH = 10_000

VALID_TYPES = {"pattern", "antipattern", "workflow", "hypothesis", "solution", "decision", "memory"}


@dataclass
class IngestItem:
    """A parsed inbox file ready for processing."""
    path: Path
    content: str
    node_type: str = "memory"
    tags: list[str] = field(default_factory=list)
    projects: list[str] = field(default_factory=list)
    confidence: str = "medium"


def scan_inbox(inbox_dir: Optional[Path] = None) -> list[Path]:
    """Find all .md files in the inbox directory."""
    d = inbox_dir or INBOX_DIR
    if not d.exists():
        return []
    return sorted(d.glob("*.md"))


def parse_frontmatter(content: str) -> tuple[dict, str]:
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


def parse_inbox_file(path: Path) -> Optional[IngestItem]:
    """Parse an inbox markdown file into an IngestItem."""
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None

    meta, body = parse_frontmatter(text)
    body = body.strip()
    if not body:
        return None

    node_type = meta.get("type", "memory")
    if node_type not in VALID_TYPES:
        node_type = "memory"

    tags = meta.get("tags", [])
    if isinstance(tags, str):
        tags = [tags]

    projects = meta.get("projects", [])
    if isinstance(projects, str):
        projects = [projects]

    return IngestItem(
        path=path,
        content=body,
        node_type=node_type,
        tags=tags,
        projects=projects,
        confidence=meta.get("confidence", "medium"),
    )


def find_enrichment_target(
    all_embs: dict[str, list[float]],
    content_embedding: list[float],
    threshold: float = ENRICHMENT_THRESHOLD,
) -> Optional[tuple[str, float]]:
    """Find the best existing node to enrich, if similarity >= threshold."""
    if not all_embs:
        return None
    matches = embeddings.find_similar(content_embedding, all_embs, top_k=1)
    if matches and matches[0][1] >= threshold:
        return matches[0]
    return None


def enrich_node(
    graph: BrainiacGraph,
    node_id: str,
    new_content: str,
    new_tags: list[str],
    new_keywords: list[str],
    new_projects: list[str],
    all_embs: dict[str, list[float]],
) -> MemoryNode:
    """Enrich an existing node with new content, merging tags/keywords."""
    node = graph.get_node(node_id)
    if node is None:
        raise KeyError(f"Node {node_id} not found")

    # Merge content with separator, cap length
    merged = node.content + "\n\n---\n\n" + new_content
    if len(merged) > MAX_CONTENT_LENGTH:
        merged = merged[:MAX_CONTENT_LENGTH]

    # Deduplicate tags and keywords
    merged_tags = list(dict.fromkeys(node.tags + new_tags))
    merged_keywords = list(dict.fromkeys(node.keywords + new_keywords))[:12]

    # Merge projects
    existing_projects = node.metadata.get("projects", [])
    merged_projects = list(dict.fromkeys(existing_projects + new_projects))

    # Update node
    graph.update_node(
        node_id,
        content=merged,
        tags=merged_tags,
        keywords=merged_keywords,
        context=merged[:200],
    )
    node.metadata["projects"] = merged_projects
    node.metadata["updated"] = datetime.now().isoformat(timespec="seconds")

    # Recompute embedding for merged content
    embed_text = f"{merged} {' '.join(merged_keywords)} {' '.join(merged_tags)}"
    node.embedding = embeddings.embed(embed_text)
    all_embs[node_id] = node.embedding

    return node


def create_node(
    graph: BrainiacGraph,
    item: IngestItem,
    all_embs: dict[str, list[float]],
) -> MemoryNode:
    """Create a new graph node from an inbox item (mirrors cmd_add flow)."""
    node_id = graph.next_id(item.node_type)

    words = re.findall(r"\b[A-Z][a-z]+\b|\b\w{5,}\b", item.content)
    keywords = list(dict.fromkeys(words))[:8]

    node = MemoryNode(
        id=node_id,
        content=item.content,
        timestamp=datetime.now().isoformat(timespec="seconds"),
        keywords=keywords,
        tags=item.tags,
        context=item.content[:200],
        metadata={
            "type": item.node_type,
            "projects": item.projects,
            "confidence": item.confidence,
            "status": "active",
            "salience": "active",
            "source": f"ingest:{item.path.name}",
            "access_count": 0,
            "unique_sessions": 0,
        },
    )

    embed_text = f"{item.content} {' '.join(keywords)} {' '.join(item.tags)}"
    node.embedding = embeddings.embed(embed_text)

    graph.add_node(node)
    all_embs[node.id] = node.embedding
    link_new_node(graph, node, all_embs)

    return node


def move_to_processed(source: Path, processed_dir: Optional[Path] = None) -> Path:
    """Move a processed file to the processed directory with timestamp prefix."""
    dest_dir = processed_dir or PROCESSED_DIR
    dest_dir.mkdir(parents=True, exist_ok=True)

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    dest = dest_dir / f"{stamp}_{source.name}"

    # Handle conflicts
    if dest.exists():
        i = 1
        while dest.exists():
            dest = dest_dir / f"{stamp}_{i}_{source.name}"
            i += 1

    shutil.move(str(source), str(dest))
    return dest


def cmd_ingest(graph: BrainiacGraph, dry_run: bool = False, inbox_dir: Optional[Path] = None):
    """Process all markdown files in the inbox directory."""
    files = scan_inbox(inbox_dir)
    if not files:
        print("No files to process in inbox.")
        return

    all_embs = embeddings.load_embeddings(graph.graph_dir)

    created = 0
    enriched = 0
    skipped = 0

    for path in files:
        item = parse_inbox_file(path)
        if item is None:
            print(f"  SKIP: {path.name} (empty or unreadable)")
            skipped += 1
            continue

        content_embedding = embeddings.embed(item.content)
        target = find_enrichment_target(all_embs, content_embedding)

        if target:
            target_id, score = target
            target_node = graph.get_node(target_id)
            label = target_node.content[:60] if target_node else target_id
            if dry_run:
                print(f"  ENRICH: {path.name} -> {target_id} (sim={score:.3f}) \"{label}\"")
            else:
                words = re.findall(r"\b[A-Z][a-z]+\b|\b\w{5,}\b", item.content)
                new_keywords = list(dict.fromkeys(words))[:8]
                enrich_node(graph, target_id, item.content, item.tags, new_keywords, item.projects, all_embs)
                move_to_processed(path, (inbox_dir / "processed") if inbox_dir else None)
                print(f"  ENRICHED: {path.name} -> {target_id} (sim={score:.3f})")
            enriched += 1
        else:
            if dry_run:
                print(f"  CREATE: {path.name} -> new {item.node_type} node")
            else:
                node = create_node(graph, item, all_embs)
                move_to_processed(path, (inbox_dir / "processed") if inbox_dir else None)
                print(f"  CREATED: {path.name} -> {node.id}")
            created += 1

    if not dry_run and (created > 0 or enriched > 0):
        embeddings.save_embeddings(all_embs, graph.graph_dir)
        graph.save()
        render_views(graph)
        update_index(graph)

    print(f"\nIngest {'(dry run) ' if dry_run else ''}complete: "
          f"{created} created, {enriched} enriched, {skipped} skipped")
