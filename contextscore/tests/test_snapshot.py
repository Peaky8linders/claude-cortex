"""
Tests for the snapshot/recovery module.

Covers: extractor, store, recovery, and edge cases.
"""

from __future__ import annotations

import json

import pytest

from contextscore.models import (
    ContextSnapshot,
    SnapshotDecision,
    SnapshotEntity,
)
from contextscore.snapshot.extractor import SnapshotExtractor
from contextscore.snapshot.store import SnapshotStore
from contextscore.snapshot.recovery import ContextRecovery


# ── Extractor Tests ──


class TestSnapshotExtractor:
    def setup_method(self) -> None:
        self.extractor = SnapshotExtractor()

    def test_extract_decisions(self) -> None:
        segments = [
            "We decided to use PostgreSQL for the database because it supports JSON columns well.",
            "Going with a microservices architecture instead of a monolith for scalability reasons.",
        ]
        snapshot = self.extractor.extract(segments, "design database", "sess-1")
        assert len(snapshot.decisions) > 0
        descriptions = [d.description.lower() for d in snapshot.decisions]
        assert any("decided to use postgresql" in d for d in descriptions)

    def test_extract_file_paths(self) -> None:
        segments = [
            "Modified ./src/main.py and lib/utils.ts to fix the import issue.",
            "The config lives at src/config/settings.json in the repo.",
        ]
        snapshot = self.extractor.extract(segments, "fix imports", "sess-2")
        assert len(snapshot.active_files) > 0
        paths = snapshot.active_files
        assert any("src/main.py" in p for p in paths)
        assert any("lib/utils.ts" in p for p in paths)

    def test_extract_error_resolutions(self) -> None:
        segments = [
            "The error was caused by a missing import. Fixed by adding 'import os' at the top.",
            "Root cause was a race condition in the connection pool initialization.",
        ]
        snapshot = self.extractor.extract(segments, "debug errors", "sess-3")
        assert len(snapshot.error_resolutions) > 0
        resolutions = [r.lower() for r in snapshot.error_resolutions]
        assert any("fixed by" in r or "root cause" in r for r in resolutions)

    def test_deduplication(self) -> None:
        segments = [
            "We decided to use Redis for caching in the production environment for performance.",
            "We decided to use Redis for caching in the production environment for reliability.",
        ]
        snapshot = self.extractor.extract(segments, "caching", "sess-4")
        # Both start with "decided to use Redis for caching in the production"
        # so first 50 chars match and one should be deduplicated
        redis_decisions = [
            d for d in snapshot.decisions
            if "decided to use redis" in d.description.lower()
        ]
        assert len(redis_decisions) == 1

    def test_extract_entities_files(self) -> None:
        segments = [
            "We updated scorer.py and models.ts with the new interface.",
            "The AuthService and UserController handle authentication.",
        ]
        snapshot = self.extractor.extract(segments, "update auth", "sess-5")
        entity_names = [e.name for e in snapshot.entities]
        assert "scorer.py" in entity_names
        assert "models.ts" in entity_names
        assert any(e.type == "class" for e in snapshot.entities if "Service" in e.name or "Controller" in e.name)

    def test_extract_patterns(self) -> None:
        segments = [
            "Convention: all API routes must be prefixed with /api/v1.",
            "We should always validate input before database writes.",
        ]
        snapshot = self.extractor.extract(segments, "conventions", "sess-6")
        assert len(snapshot.patterns) > 0

    def test_infer_current_task(self) -> None:
        segments = [
            "First we set up the project structure.",
            "Now implementing the snapshot recovery module for context persistence.",
        ]
        snapshot = self.extractor.extract(segments, "snapshot", "sess-7")
        assert len(snapshot.current_task) > 10

    def test_empty_segments(self) -> None:
        snapshot = self.extractor.extract([], "nothing", "sess-empty")
        assert snapshot.turn_count == 0
        assert snapshot.token_count == 0
        assert snapshot.decisions == []
        assert snapshot.entities == []
        assert snapshot.active_files == []
        assert snapshot.current_task == "Unknown"

    def test_snapshot_metadata(self) -> None:
        segments = ["Some context about the project."]
        snapshot = self.extractor.extract(segments, "test", "sess-meta")
        assert snapshot.session_id == "sess-meta"
        assert snapshot.turn_count == 1
        assert snapshot.token_count > 0
        assert snapshot.timestamp != ""
        assert isinstance(snapshot.quality_score, float)


# ── Store Tests ──


class TestSnapshotStore:
    def test_save_and_load_roundtrip(self, tmp_path) -> None:
        store = SnapshotStore(project_root=tmp_path)
        snapshot = ContextSnapshot(
            session_id="test-sess",
            timestamp="2026-03-23T12:00:00Z",
            turn_count=5,
            token_count=1200,
            quality_score=72.5,
            decisions=[
                SnapshotDecision(
                    description="decided to use SQLite",
                    reasoning="lightweight",
                    affected_files=["./db.py"],
                    timestamp="2026-03-23T12:00:00Z",
                ),
            ],
            entities=[
                SnapshotEntity(name="db.py", type="file"),
                SnapshotEntity(name="DatabaseManager", type="class"),
            ],
            active_files=["./db.py", "./models.py"],
            patterns=["always use parameterized queries"],
            error_resolutions=["fixed by adding missing index"],
            current_task="Implementing database layer",
            compact_instructions="COMPACTION PRIORITY INSTRUCTIONS:\n...",
        )

        filepath = store.save(snapshot)
        assert filepath.endswith(".json")

        loaded = store.load_latest("test-sess")
        assert loaded is not None
        assert loaded.session_id == "test-sess"
        assert loaded.quality_score == 72.5
        assert loaded.turn_count == 5
        assert loaded.token_count == 1200
        assert len(loaded.decisions) == 1
        assert loaded.decisions[0].description == "decided to use SQLite"
        assert len(loaded.entities) == 2
        assert loaded.active_files == ["./db.py", "./models.py"]
        assert loaded.current_task == "Implementing database layer"

    def test_load_latest_no_snapshots(self, tmp_path) -> None:
        store = SnapshotStore(project_root=tmp_path)
        result = store.load_latest()
        assert result is None

    def test_load_latest_filters_by_session(self, tmp_path) -> None:
        store = SnapshotStore(project_root=tmp_path)
        snap_a = ContextSnapshot(
            session_id="sess-a",
            timestamp="2026-03-23T12:00:00Z",
            turn_count=1,
            token_count=100,
            quality_score=50.0,
        )
        snap_b = ContextSnapshot(
            session_id="sess-b",
            timestamp="2026-03-23T13:00:00Z",
            turn_count=2,
            token_count=200,
            quality_score=80.0,
        )
        store.save(snap_a)
        store.save(snap_b)

        loaded = store.load_latest("sess-a")
        assert loaded is not None
        assert loaded.session_id == "sess-a"

    def test_list_snapshots(self, tmp_path) -> None:
        store = SnapshotStore(project_root=tmp_path)
        snap = ContextSnapshot(
            session_id="list-test",
            timestamp="2026-03-23T14:00:00Z",
            turn_count=3,
            token_count=500,
            quality_score=65.0,
        )
        store.save(snap)

        listing = store.list_snapshots()
        assert len(listing) == 1
        assert listing[0]["session_id"] == "list-test"
        assert listing[0]["score"] == 65.0

    def test_list_snapshots_empty(self, tmp_path) -> None:
        store = SnapshotStore(project_root=tmp_path)
        assert store.list_snapshots() == []


# ── Recovery Tests ──


class TestContextRecovery:
    def test_recovery_formatting(self, tmp_path) -> None:
        store = SnapshotStore(project_root=tmp_path)
        snap = ContextSnapshot(
            session_id="recover-test",
            timestamp="2026-03-23T15:00:00Z",
            turn_count=10,
            token_count=3000,
            quality_score=78.0,
            decisions=[
                SnapshotDecision(description="decided to use async/await pattern"),
            ],
            entities=[
                SnapshotEntity(name="main.py", type="file"),
                SnapshotEntity(name="TaskManager", type="class"),
            ],
            active_files=["./src/main.py", "./src/tasks.py"],
            patterns=["always handle exceptions explicitly"],
            error_resolutions=["fixed by adding timeout to HTTP client"],
            current_task="Implementing task scheduler",
        )
        store.save(snap)

        recovery = ContextRecovery(project_root=tmp_path)
        text = recovery.recover("recover-test")

        assert text is not None
        assert "CONTEXT RECOVERY" in text
        assert "recover-test" in text
        assert "78.0/100" in text
        assert "## Current Task" in text
        assert "Implementing task scheduler" in text
        assert "## Active Files" in text
        assert "./src/main.py" in text
        assert "## Key Decisions Made" in text
        assert "decided to use async/await pattern" in text
        assert "## Key Code Entities" in text
        assert "TaskManager (class)" in text
        assert "## Established Patterns" in text
        assert "## Resolved Errors" in text
        assert "END CONTEXT RECOVERY" in text

    def test_recovery_no_snapshot(self, tmp_path) -> None:
        recovery = ContextRecovery(project_root=tmp_path)
        result = recovery.recover("nonexistent")
        assert result is None

    def test_recovery_minimal_snapshot(self, tmp_path) -> None:
        store = SnapshotStore(project_root=tmp_path)
        snap = ContextSnapshot(
            session_id="minimal",
            timestamp="2026-03-23T16:00:00Z",
            turn_count=1,
            token_count=50,
            quality_score=90.0,
        )
        store.save(snap)

        recovery = ContextRecovery(project_root=tmp_path)
        text = recovery.recover("minimal")
        assert text is not None
        assert "CONTEXT RECOVERY" in text
        assert "90.0/100" in text
        # No decisions/entities/patterns sections since they're empty
        assert "## Key Decisions" not in text
        assert "## Key Code Entities" not in text
