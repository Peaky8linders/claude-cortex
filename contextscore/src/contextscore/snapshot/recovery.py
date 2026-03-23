"""
Context Recovery — generates structured recovery context to inject after compaction.

Reads the latest snapshot and produces a focused recovery prompt.
Ported from contextscore-cc/src/snapshot/recovery.ts.
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from contextscore.models import ContextSnapshot
from contextscore.snapshot.store import SnapshotStore


class ContextRecovery:
    """Generates structured recovery context to inject after compaction."""

    def __init__(self, project_root: str | Path | None = None) -> None:
        self._store = SnapshotStore(project_root)

    def recover(self, session_id: Optional[str] = None) -> Optional[str]:
        """
        Generate recovery text to inject after compaction.

        Args:
            session_id: Optional session ID to filter snapshots.

        Returns:
            Formatted recovery text, or None if no snapshot is available.
        """
        snapshot = self._store.load_latest(session_id)
        if snapshot is None:
            return None
        return self._format_recovery(snapshot)

    def _format_recovery(self, snap: ContextSnapshot) -> str:
        lines: list[str] = [
            "═══ CONTEXT RECOVERY (post-compaction) ═══",
            "",
            f"Session: {snap.session_id}",
            f"Snapshot taken: {snap.timestamp}",
            f"Quality score at snapshot: {snap.quality_score}/100",
            f"Tokens at snapshot: {snap.token_count:,}",
            "",
        ]

        # Current task
        if snap.current_task:
            lines.append("## Current Task")
            lines.append(snap.current_task)
            lines.append("")

        # Active files
        if snap.active_files:
            lines.append("## Active Files")
            for f in snap.active_files[:15]:
                lines.append(f"  - {f}")
            lines.append("")

        # Decisions (most critical for continuity)
        if snap.decisions:
            lines.append("## Key Decisions Made (DO NOT reverse these)")
            for d in snap.decisions[:10]:
                lines.append(f"  - {d.description}")
                if d.affected_files:
                    lines.append(f"    Files: {', '.join(d.affected_files)}")
            lines.append("")

        # Entities
        code_entities = [e for e in snap.entities if e.type in ("class", "config")]
        if code_entities:
            lines.append("## Key Code Entities")
            for e in code_entities[:15]:
                lines.append(f"  - {e.name} ({e.type})")
            lines.append("")

        # Patterns
        if snap.patterns:
            lines.append("## Established Patterns & Conventions")
            for p in snap.patterns[:8]:
                lines.append(f"  - {p}")
            lines.append("")

        # Error resolutions
        if snap.error_resolutions:
            lines.append("## Resolved Errors (DO NOT re-introduce)")
            for e in snap.error_resolutions[:5]:
                lines.append(f"  - {e}")
            lines.append("")

        lines.append("═══ END CONTEXT RECOVERY ═══")
        return "\n".join(lines)
