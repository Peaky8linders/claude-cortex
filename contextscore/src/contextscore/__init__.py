"""
ContextScore — Context Quality Scoring Platform for LLM Applications

Measures, diagnoses, and optimizes the semantic quality of LLM context windows.
"""

__version__ = "0.1.0"

from contextscore.scorer import ContextScorer
from contextscore.middleware import ContextQualityGate, ContextQualityError, GateResult
from contextscore.models import (
    ScoreResult,
    ContextIssue,
    TokenEconomics,
    ContextSegment,
    Severity,
    IssueCause,
)

__all__ = [
    "ContextScorer",
    "ContextQualityGate",
    "ContextQualityError",
    "GateResult",
    "ScoreResult",
    "ContextIssue",
    "TokenEconomics",
    "ContextSegment",
    "Severity",
    "IssueCause",
]
