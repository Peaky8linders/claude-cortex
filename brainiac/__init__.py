"""Claude Brainiac — Graph-based self-learning memory system."""

__version__ = "0.1.0"

from pathlib import Path

KNOWLEDGE_ROOT = Path.home() / ".claude" / "knowledge"
GRAPH_DIR = KNOWLEDGE_ROOT / "graph"
VIEWS_DIR = KNOWLEDGE_ROOT / "views"
BRAINIAC_DIR = KNOWLEDGE_ROOT / "brainiac"
