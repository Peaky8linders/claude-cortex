"""
Context quality analyzers.

Each analyzer examines one dimension of context quality,
returns a dimension score and a list of diagnosed issues.
"""

from contextscore.analyzers.base import BaseAnalyzer
from contextscore.analyzers.semantic_relevance import SemanticRelevanceAnalyzer
from contextscore.analyzers.redundancy import RedundancyAnalyzer
from contextscore.analyzers.distractors import DistractorAnalyzer
from contextscore.analyzers.density import DensityAnalyzer
from contextscore.analyzers.fragmentation import FragmentationAnalyzer
from contextscore.analyzers.structure import StructureAnalyzer
from contextscore.analyzers.economics import EconomicsAnalyzer

__all__ = [
    "BaseAnalyzer",
    "SemanticRelevanceAnalyzer",
    "RedundancyAnalyzer",
    "DistractorAnalyzer",
    "DensityAnalyzer",
    "FragmentationAnalyzer",
    "StructureAnalyzer",
    "EconomicsAnalyzer",
]
