# ContextScore

**The Context Quality Scoring Platform for LLM Applications**

> "A 10-million-token window with poorly organized context is a very expensive way to introduce noise."

ContextScore measures, diagnoses, and optimizes the semantic quality of LLM context windows — turning opaque token spend into measurable, improvable coherence.

---

## Why This Exists

Enterprises spend $100K–$1M+/month on AI tokens with zero visibility into whether those tokens produce coherent reasoning. Research shows:

- **Context rot**: Performance degrades as input grows, even on simple tasks (Chroma 2025)
- **Distractor penalty**: A single irrelevant passage measurably reduces accuracy
- **300x gaps** between marketed and effective context windows
- **No quality standard** — tokens are a credence good whose quality cannot be verified

ContextScore provides the missing measurement layer.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   ContextScorer                      │
│                                                      │
│  7 Analyzers → Composite Score → Diagnostics → Fixes │
│                                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │  Semantic    │  │  Redundancy │  │ Distractors │ │
│  │  Relevance   │  │             │  │             │ │
│  └─────────────┘  └─────────────┘  └─────────────┘ │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │  Density    │  │ Fragment.   │  │  Structure  │ │
│  └─────────────┘  └─────────────┘  └─────────────┘ │
│  ┌─────────────┐                                    │
│  │  Economics  │   + Middleware  + JSON API          │
│  └─────────────┘                                    │
└─────────────────────────────────────────────────────┘
```

## Quick Start

```python
from contextscore import ContextScorer

scorer = ContextScorer()
result = scorer.score(
    context="Your system prompt + retrieved docs + history...",
    query="The user's current query"
)

print(f"Score: {result.score}/100 ({result.grade})")
print(f"Token waste: {result.economics.waste_percentage:.0f}%")

for issue in result.issues:
    print(f"  [{issue.severity.value}] {issue.cause.value}")
    print(f"    Problem: {issue.description}")
    print(f"    Fix:     {issue.fix}")
```

## Pipeline Middleware

```python
from contextscore import ContextQualityGate, ContextQualityError

gate = ContextQualityGate(min_score=60, warn_score=75)

# As a gate
result = gate.evaluate(context=ctx, query=q)
if result.passed:
    response = llm.invoke(ctx)

# As a decorator
@gate.guard
def call_llm(context, query):
    return llm.invoke(context)
```

## JSON API Server

```bash
python -m contextscore.api.server --port 8080

# POST /score
curl -X POST http://localhost:8080/score \
  -H "Content-Type: application/json" \
  -d '{"context": "Your context...", "query": "Your query..."}'
```

## What It Detects (28 Issue Types)

| Category | Issues Detected |
|---|---|
| **Semantic Relevance** | Irrelevant segments, low query alignment, topic drift, semantic mismatch |
| **Redundancy** | Exact duplicates, near-duplicates, paraphrased repetition, boilerplate |
| **Distractors** | Topical distractors, misleading terms, contradictions, stale information |
| **Density** | Verbose padding, low signal ratio, excessive formatting, filler content |
| **Fragmentation** | Broken references, incomplete context, orphaned entities, missing relationships |
| **Structure** | No section boundaries, mixed content types, poor ordering, missing metadata |
| **Economics** | Oversized context, attention budget exceeded, high cost/low signal, cacheable content |

Every issue includes a **cause**, **description**, **severity**, **recommended fix**, and **estimated token savings**.

## Install & Test

```bash
pip install -e ".[dev]"
pytest tests/ -v          # 71 tests
python examples/demo.py   # Full diagnostic demo
```

## Multi-Phase Roadmap

| Phase | Scope | Status |
|---|---|---|
| **Phase 1** | 7 analyzers, 28 causes, scoring, diagnostics, fixes, SDK, middleware, API, 71 tests, dashboard | ✅ Complete |
| **Phase 2** | LangChain/LlamaIndex integration, streaming monitoring, webhook alerts | Planned |
| **Phase 3** | Multi-model benchmarking, context rot thresholds, A/B testing | Planned |
| **Phase 4** | Enterprise: compliance, RBAC, custom profiles, SLAs | Planned |

## License

MIT
