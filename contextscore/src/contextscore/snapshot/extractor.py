"""
Snapshot Extractor — extracts critical context elements that should survive compaction.

Analyzes session content for: decisions, entities, file paths, patterns, errors.
Ported from contextscore-cc/src/snapshot/extractor.ts.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

from contextscore.models import (
    ContextSnapshot,
    SnapshotDecision,
    SnapshotEntity,
)
from contextscore.scorer import ContextScorer
from contextscore.utils import estimate_tokens


class SnapshotExtractor:
    """Extracts critical context elements that should survive compaction."""

    def __init__(self) -> None:
        self._scorer = ContextScorer()

    def extract(
        self,
        segments: list[str],
        query: str,
        session_id: str,
    ) -> ContextSnapshot:
        """
        Extract a complete snapshot from session segments.

        Args:
            segments: List of context segments (e.g. conversation turns).
            query: The current user query/task.
            session_id: Identifier for the current session.

        Returns:
            A ContextSnapshot with all extracted context elements.
        """
        result = self._scorer.score(
            context="\n\n".join(segments),
            query=query,
            segments=segments,
        )

        return ContextSnapshot(
            session_id=session_id,
            timestamp=datetime.now(timezone.utc).isoformat(),
            turn_count=len(segments),
            token_count=sum(estimate_tokens(s) for s in segments),
            quality_score=result.score,
            decisions=self._extract_decisions(segments),
            entities=self._extract_entities(segments),
            active_files=self._extract_file_paths(segments),
            patterns=self._extract_patterns(segments),
            error_resolutions=self._extract_error_resolutions(segments),
            current_task=self._infer_current_task(segments),
            compact_instructions=self._generate_compact_instructions(result, segments),
        )

    # ── Private helpers ──

    def _extract_decisions(self, segments: list[str]) -> list[SnapshotDecision]:
        decisions: list[SnapshotDecision] = []
        decision_patterns = [
            re.compile(
                r"(?:decided|choosing|going with|will use|using|switched to|chose|selected|opted for)\s+(.{10,80})",
                re.IGNORECASE,
            ),
            re.compile(
                r"(?:because|reason|rationale|since|due to)\s+(.{10,80})",
                re.IGNORECASE,
            ),
            re.compile(
                r"(?:instead of|rather than|not using)\s+(.{10,60})",
                re.IGNORECASE,
            ),
            re.compile(
                r"(?:the approach|the strategy|the plan|architecture)\s+(?:is|will be)\s+(.{10,80})",
                re.IGNORECASE,
            ),
        ]

        now = datetime.now(timezone.utc).isoformat()

        for segment in segments:
            for pattern in decision_patterns:
                for match in pattern.finditer(segment):
                    desc = match.group(0).strip()
                    if len(desc) > 15:
                        decisions.append(
                            SnapshotDecision(
                                description=desc[:200],
                                reasoning="",
                                affected_files=self._extract_file_paths([segment]),
                                timestamp=now,
                            )
                        )

        # Deduplicate by first 50 chars
        seen: set[str] = set()
        unique: list[SnapshotDecision] = []
        for d in decisions:
            key = d.description[:50].lower()
            if key not in seen:
                seen.add(key)
                unique.append(d)

        return unique[:20]  # Cap at 20 decisions

    def _extract_entities(self, segments: list[str]) -> list[SnapshotEntity]:
        entities: list[SnapshotEntity] = []
        full = "\n".join(segments)

        # File/module names
        file_pattern = re.compile(
            r"(?:[\w-]+\.(?:ts|js|py|tsx|jsx|css|html|json|yaml|yml|toml|md|rs|go|java|rb|swift|kt))"
        )
        files = file_pattern.findall(full)
        for f in list(dict.fromkeys(files))[:30]:
            entities.append(SnapshotEntity(name=f, type="file", context="", last_mentioned_turn=-1))

        # Function/class names (PascalCase with known suffixes)
        code_pattern = re.compile(
            r"\b([A-Z][a-zA-Z0-9]{2,30}"
            r"(?:Service|Controller|Manager|Handler|Router|Provider|Factory|Repository|Component|Module|Middleware|Client|Store))\b"
        )
        code_names = code_pattern.findall(full)
        for name in list(dict.fromkeys(code_names))[:20]:
            entities.append(SnapshotEntity(name=name, type="class", context="", last_mentioned_turn=-1))

        # Variable/config names (UPPER_SNAKE)
        config_pattern = re.compile(r"\b([A-Z][A-Z0-9_]{3,30})\b")
        configs = config_pattern.findall(full)
        for c in list(dict.fromkeys(c for c in configs if len(c) > 4))[:15]:
            entities.append(SnapshotEntity(name=c, type="config", context="", last_mentioned_turn=-1))

        return entities

    def _extract_file_paths(self, segments: list[str]) -> list[str]:
        full = "\n".join(segments)
        path_pattern = re.compile(r"(?:\./|/|~/|src/|lib/|app/|packages/)[\w./-]+")
        matches = path_pattern.findall(full)
        return list(dict.fromkeys(matches))[:30]

    def _extract_patterns(self, segments: list[str]) -> list[str]:
        patterns: list[str] = []
        full = "\n".join(segments)

        pattern_indicators = [
            re.compile(r"(?:pattern|convention|standard|approach|style|rule):\s*(.{10,100})", re.IGNORECASE),
            re.compile(r"(?:always|never|must|should)\s+(.{10,80})", re.IGNORECASE),
            re.compile(r"(?:naming convention|file structure|directory layout)\s+(.{10,80})", re.IGNORECASE),
        ]

        for indicator in pattern_indicators:
            for match in indicator.finditer(full):
                patterns.append(match.group(0).strip()[:150])

        return list(dict.fromkeys(patterns))[:15]

    def _extract_error_resolutions(self, segments: list[str]) -> list[str]:
        resolutions: list[str] = []
        error_patterns = [
            re.compile(r"(?:fixed|resolved|solution|fix was|the issue was|root cause)\s+(.{10,100})", re.IGNORECASE),
            re.compile(r"(?:error|bug|issue).*?(?:fixed by|resolved by|solved by)\s+(.{10,80})", re.IGNORECASE),
        ]

        full = "\n".join(segments)
        for pattern in error_patterns:
            for match in pattern.finditer(full):
                resolutions.append(match.group(0).strip()[:150])

        return list(dict.fromkeys(resolutions))[:10]

    def _infer_current_task(self, segments: list[str]) -> str:
        if not segments:
            return "Unknown"
        last = segments[-1]
        for sentence in re.split(r"[.!?\n]", last):
            if len(sentence.strip()) > 10:
                return sentence.strip()[:200]
        return "Continuing previous work"

    def _generate_compact_instructions(
        self,
        result: object,
        segments: list[str],
    ) -> str:
        lines: list[str] = [
            "COMPACTION PRIORITY INSTRUCTIONS:",
            "",
            "MUST PRESERVE (critical for session continuity):",
        ]

        files = self._extract_file_paths(segments)
        if files:
            lines.append(f"- Active files: {', '.join(files[:10])}")

        decisions = self._extract_decisions(segments)
        if decisions:
            lines.append("- Key decisions made:")
            for d in decisions[:5]:
                lines.append(f"  * {d.description}")

        errors = self._extract_error_resolutions(segments)
        if errors:
            lines.append("- Error resolutions (DO NOT re-introduce these bugs):")
            for e in errors[:5]:
                lines.append(f"  * {e}")

        lines.append("")
        lines.append("CAN DISCARD (low value):")

        # Access issues from the ScoreResult
        critical_issues = [
            i for i in getattr(result, "issues", [])
            if getattr(i, "severity", None) in ("high", "critical")
            or (hasattr(i, "severity") and hasattr(i.severity, "value") and i.severity.value in ("high", "critical"))
        ]
        if critical_issues:
            lines.append(f"- {len(critical_issues)} low-quality segments identified by ContextScore")

        lines.append("- Verbose tool output already processed")
        lines.append("- Redundant file reads (keep only most recent version)")
        lines.append("- Exploratory paths that were abandoned")

        return "\n".join(lines)
