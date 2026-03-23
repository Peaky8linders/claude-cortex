"""
Snapshot Store — JSON-file-based persistence for context snapshots.

Stores snapshots in .claude/context-snapshots/ relative to project root.
Ported from contextscore-cc/src/snapshot/store.ts.
"""

from __future__ import annotations

import json
import time
from dataclasses import asdict
from pathlib import Path
from typing import Optional

from contextscore.models import (
    ContextSnapshot,
    SnapshotDecision,
    SnapshotEntity,
)

SNAPSHOT_DIR = ".claude/context-snapshots"


class SnapshotStore:
    """Persists and retrieves context snapshots as JSON files."""

    def __init__(self, project_root: str | Path | None = None) -> None:
        if project_root is None:
            project_root = Path.cwd()
        self._dir = Path(project_root) / SNAPSHOT_DIR

    def save(self, snapshot: ContextSnapshot) -> str:
        """
        Save a snapshot to disk.

        Returns:
            The file path of the saved snapshot.
        """
        self._dir.mkdir(parents=True, exist_ok=True)

        filename = f"{snapshot.session_id}-{int(time.time() * 1000)}.json"
        filepath = self._dir / filename

        data = asdict(snapshot)
        filepath.write_text(json.dumps(data, indent=2), encoding="utf-8")
        return str(filepath)

    def load_latest(self, session_id: Optional[str] = None) -> Optional[ContextSnapshot]:
        """
        Load the most recent snapshot, optionally filtered by session_id.

        Returns:
            The latest ContextSnapshot, or None if no snapshots exist.
        """
        if not self._dir.exists():
            return None

        files = sorted(
            (
                f for f in self._dir.iterdir()
                if f.suffix == ".json"
                and (session_id is None or f.name.startswith(session_id))
            ),
            key=lambda f: f.name,
            reverse=True,
        )

        if not files:
            return None

        raw = files[0].read_text(encoding="utf-8")
        return self._deserialize(json.loads(raw))

    def list_snapshots(self) -> list[dict]:
        """
        List all snapshots with summary metadata.

        Returns:
            List of dicts with keys: file, session_id, timestamp, score.
        """
        if not self._dir.exists():
            return []

        results: list[dict] = []
        for f in sorted(self._dir.iterdir(), key=lambda f: f.name, reverse=True):
            if f.suffix != ".json":
                continue
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                results.append({
                    "file": f.name,
                    "session_id": data.get("session_id", ""),
                    "timestamp": data.get("timestamp", ""),
                    "score": data.get("quality_score", 0),
                })
            except (json.JSONDecodeError, OSError):
                continue

        # Sort by timestamp descending
        results.sort(key=lambda x: x["timestamp"], reverse=True)
        return results

    @staticmethod
    def _deserialize(data: dict) -> ContextSnapshot:
        """Reconstruct a ContextSnapshot from a raw dict."""
        decisions = [
            SnapshotDecision(**d) for d in data.get("decisions", [])
        ]
        entities = [
            SnapshotEntity(**e) for e in data.get("entities", [])
        ]
        return ContextSnapshot(
            session_id=data["session_id"],
            timestamp=data["timestamp"],
            turn_count=data["turn_count"],
            token_count=data["token_count"],
            quality_score=data["quality_score"],
            decisions=decisions,
            entities=entities,
            active_files=data.get("active_files", []),
            patterns=data.get("patterns", []),
            error_resolutions=data.get("error_resolutions", []),
            current_task=data.get("current_task", ""),
            compact_instructions=data.get("compact_instructions", ""),
        )
