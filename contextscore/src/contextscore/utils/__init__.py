"""
Text analysis utilities for ContextScore.

Provides tokenization estimation, text statistics, and NLP helpers
without requiring heavy external dependencies.
"""

from __future__ import annotations

import re
import math
import hashlib
from collections import Counter
from typing import Sequence


def estimate_tokens(text: str) -> int:
    """
    Estimate token count using the ~4 chars per token heuristic.
    Accurate within ~10% for English text across major tokenizers.
    """
    return max(1, len(text) // 4)


def split_sentences(text: str) -> list[str]:
    """Split text into sentences using regex heuristics."""
    sentences = re.split(r'(?<=[.!?])\s+(?=[A-Z])', text)
    return [s.strip() for s in sentences if s.strip()]


def split_segments(text: str, delimiter: str | None = None) -> list[str]:
    """
    Split context into segments. Uses double-newline by default,
    or a custom delimiter.
    """
    if delimiter:
        parts = text.split(delimiter)
    else:
        parts = re.split(r'\n\n+', text)
    return [p.strip() for p in parts if p.strip()]


def word_tokenize(text: str) -> list[str]:
    """Simple word tokenization."""
    return re.findall(r'\b\w+\b', text.lower())


def ngrams(tokens: list[str], n: int) -> list[tuple[str, ...]]:
    """Generate n-grams from a token list."""
    return [tuple(tokens[i:i + n]) for i in range(len(tokens) - n + 1)]


def jaccard_similarity(set_a: set, set_b: set) -> float:
    """Compute Jaccard similarity between two sets."""
    if not set_a and not set_b:
        return 1.0
    intersection = set_a & set_b
    union = set_a | set_b
    return len(intersection) / len(union) if union else 0.0


def cosine_similarity_bow(text_a: str, text_b: str) -> float:
    """
    Bag-of-words cosine similarity between two texts.
    Lightweight alternative to embedding-based similarity.
    """
    words_a = Counter(word_tokenize(text_a))
    words_b = Counter(word_tokenize(text_b))

    all_words = set(words_a.keys()) | set(words_b.keys())
    if not all_words:
        return 0.0

    dot = sum(words_a.get(w, 0) * words_b.get(w, 0) for w in all_words)
    mag_a = math.sqrt(sum(v ** 2 for v in words_a.values()))
    mag_b = math.sqrt(sum(v ** 2 for v in words_b.values()))

    if mag_a == 0 or mag_b == 0:
        return 0.0
    return dot / (mag_a * mag_b)


def content_hash(text: str) -> str:
    """Create a normalized content hash for deduplication."""
    normalized = re.sub(r'\s+', ' ', text.lower().strip())
    return hashlib.md5(normalized.encode()).hexdigest()


def information_density(text: str) -> float:
    """
    Estimate information density combining:
    1. Content word ratio (content words / total words)
    2. Uniqueness ratio (unique content words / total content words)

    Returns 0.0 (pure noise) to ~1.0 (maximally dense, all unique signal).
    """
    words = word_tokenize(text)
    if not words:
        return 0.0

    # Filter out common stop words
    stop_words = {
        'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
        'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
        'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
        'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
        'as', 'into', 'through', 'during', 'before', 'after', 'above',
        'below', 'between', 'out', 'off', 'over', 'under', 'again',
        'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why',
        'how', 'all', 'both', 'each', 'few', 'more', 'most', 'other',
        'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so',
        'than', 'too', 'very', 'just', 'because', 'but', 'and', 'or', 'if',
        'while', 'that', 'this', 'these', 'those', 'it', 'its', 'i', 'me',
        'my', 'we', 'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her',
        'they', 'them', 'their', 'what', 'which', 'who', 'whom',
        'important', 'note', 'something', 'things', 'many', 'particular',
        'aware', 'fact', 'carefully', 'decisions', 'next', 'situation',
        'consider', 'think', 'really', 'quite', 'rather', 'much',
    }

    content_words = [w for w in words if w not in stop_words and len(w) > 2]
    if not content_words:
        return 0.0

    # Combine: what fraction of words carry meaning × how unique is that meaning
    content_ratio = len(content_words) / len(words)
    unique_ratio = len(set(content_words)) / len(content_words) if content_words else 0
    return content_ratio * unique_ratio


def detect_formatting_overhead(text: str) -> float:
    """
    Estimate the proportion of tokens spent on formatting vs content.
    Returns ratio 0.0 (no overhead) to 1.0 (all formatting).
    """
    total_chars = len(text)
    if total_chars == 0:
        return 0.0

    # Count formatting characters
    formatting_patterns = [
        r'#{1,6}\s',         # Markdown headers
        r'\*{1,3}[^*]+\*{1,3}',  # Bold/italic
        r'```[^`]*```',      # Code blocks
        r'<[^>]+>',          # HTML tags
        r'\|[^|]+\|',        # Table pipes
        r'[-=]{3,}',         # Horizontal rules
        r'^\s*[-*+]\s',      # List markers
        r'^\s*\d+\.\s',      # Numbered lists
    ]

    formatting_chars = 0
    for pattern in formatting_patterns:
        matches = re.findall(pattern, text, re.MULTILINE)
        formatting_chars += sum(len(m) for m in matches)

    return min(1.0, formatting_chars / total_chars)


def detect_filler_phrases(text: str) -> list[str]:
    """Detect common filler phrases that waste tokens."""
    filler_patterns = [
        r'\bas mentioned (?:above|earlier|before|previously)\b',
        r'\bit is (?:important|worth) (?:to note|noting|mentioning) that\b',
        r'\bin (?:this|the) (?:context|regard|respect)\b',
        r'\bas we (?:can see|know|discussed)\b',
        r'\bplease (?:note|be aware) that\b',
        r'\bfor (?:the purposes|the sake) of\b',
        r'\bin order to\b',
        r'\bdue to the fact that\b',
        r'\bit should be noted that\b',
        r'\bat the end of the day\b',
        r'\bneedless to say\b',
        r'\bgoing forward\b',
        r'\bat this point in time\b',
        r'\bin terms of\b',
        r'\bwith respect to\b',
    ]
    found = []
    for pattern in filler_patterns:
        matches = re.findall(pattern, text, re.IGNORECASE)
        found.extend(matches)
    return found


def detect_references(text: str) -> list[str]:
    """Detect dangling references that may point outside the context window."""
    reference_patterns = [
        r'\bsee (?:above|below|section|figure|table|appendix)\b',
        r'\bas (?:described|shown|mentioned|noted) (?:above|below|earlier|in section)\b',
        r'\brefer to (?:the|section|figure|table)\b',
        r'\b(?:figure|table|appendix|exhibit|chart) \d+\b',
        r'\bthe (?:aforementioned|above-mentioned|previously described)\b',
        r'\bcf\.\s',
        r'\bibid\b',
    ]
    found = []
    for pattern in reference_patterns:
        matches = re.findall(pattern, text, re.IGNORECASE)
        found.extend(matches)
    return found


def extract_entities(text: str) -> list[str]:
    """
    Simple named entity extraction using capitalization patterns.
    Not as good as spaCy NER but zero dependency.
    """
    # Match sequences of capitalized words (likely proper nouns)
    pattern = r'\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b'
    candidates = re.findall(pattern, text)

    # Filter out sentence starters (heuristic: preceded by period or start of text)
    sentences = split_sentences(text)
    sentence_starters = set()
    for sent in sentences:
        words = sent.split()
        if words:
            sentence_starters.add(words[0])

    entities = [c for c in candidates if c.split()[0] not in sentence_starters or len(c.split()) > 1]
    return list(set(entities))
