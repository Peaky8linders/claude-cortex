"""Base analyzer interface."""

from __future__ import annotations

from abc import ABC, abstractmethod
from contextscore.models import DimensionScore


class BaseAnalyzer(ABC):
    """Abstract base class for all context quality analyzers."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Dimension name."""
        ...

    @property
    @abstractmethod
    def weight(self) -> float:
        """Weight in composite score (all weights should sum to 1.0)."""
        ...

    @abstractmethod
    def analyze(self, segments: list[str], query: str) -> DimensionScore:
        """
        Analyze context segments against a query.

        Args:
            segments: List of context text segments.
            query: The user's current query/task.

        Returns:
            DimensionScore with score, weight, and diagnosed issues.
        """
        ...
