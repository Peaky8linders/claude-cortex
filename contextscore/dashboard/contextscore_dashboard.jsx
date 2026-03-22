import { useState, useCallback, useMemo } from "react";

// ── Scoring Engine (client-side port of the Python analyzers) ──

function estimateTokens(text) {
  return Math.max(1, Math.floor(text.length / 4));
}

function wordTokenize(text) {
  return (text.toLowerCase().match(/\b\w+\b/g) || []);
}

const STOP_WORDS = new Set([
  'the','a','an','is','are','was','were','be','been','being','have','has','had',
  'do','does','did','will','would','could','should','may','might','shall','can',
  'need','to','of','in','for','on','with','at','by','from','as','into','through',
  'during','before','after','above','below','between','out','off','over','under',
  'again','further','then','once','here','there','when','where','why','how','all',
  'both','each','few','more','most','other','some','such','no','nor','not','only',
  'own','same','so','than','too','very','just','because','but','and','or','if',
  'while','that','this','these','those','it','its','i','me','my','we','our','you',
  'your','he','him','his','she','her','they','them','their','what','which','who',
]);

function cosineSimilarityBow(textA, textB) {
  const wordsA = {};
  const wordsB = {};
  wordTokenize(textA).forEach(w => { wordsA[w] = (wordsA[w] || 0) + 1; });
  wordTokenize(textB).forEach(w => { wordsB[w] = (wordsB[w] || 0) + 1; });
  const allWords = new Set([...Object.keys(wordsA), ...Object.keys(wordsB)]);
  if (allWords.size === 0) return 0;
  let dot = 0, magA = 0, magB = 0;
  allWords.forEach(w => {
    const a = wordsA[w] || 0, b = wordsB[w] || 0;
    dot += a * b; magA += a * a; magB += b * b;
  });
  magA = Math.sqrt(magA); magB = Math.sqrt(magB);
  if (magA === 0 || magB === 0) return 0;
  return dot / (magA * magB);
}

function informationDensity(text) {
  const words = wordTokenize(text);
  if (!words.length) return 0;
  const content = words.filter(w => !STOP_WORDS.has(w) && w.length > 2);
  if (!content.length) return 0;
  const unique = new Set(content);
  return (content.length / words.length) * (unique.size / content.length);
}

// ── Issue Catalog ──
const CAUSE_CATALOG = {
  irrelevant_segment: {
    label: "Irrelevant Segment",
    description: "No semantic connection to the query or task.",
    fix: "Remove segments with low relevance scores. Use query-aware retrieval to filter before injection.",
    category: "Semantic Relevance", icon: "🎯",
  },
  low_query_alignment: {
    label: "Low Query Alignment",
    description: "Weak alignment with the current query — model must work harder to find signal.",
    fix: "Re-rank retrieved documents by query similarity. Use a cross-encoder reranker.",
    category: "Semantic Relevance", icon: "🎯",
  },
  duplicate_content: {
    label: "Duplicate Content",
    description: "Identical text appears multiple times, wasting tokens.",
    fix: "Deduplicate at retrieval time using content hashing.",
    category: "Redundancy", icon: "📋",
  },
  near_duplicate: {
    label: "Near-Duplicate",
    description: "Multiple passages convey the same information with minor wording differences.",
    fix: "Use MinHash for fuzzy deduplication. Keep the highest-quality version.",
    category: "Redundancy", icon: "📋",
  },
  topical_distractor: {
    label: "Topical Distractor",
    description: "Content is topically related but doesn't answer the query — the #1 cause of context rot.",
    fix: "Use answer-aware retrieval: score by likelihood of containing the answer, not just topic similarity.",
    category: "Distractors", icon: "🎭",
  },
  contradictory_information: {
    label: "Contradictory Info",
    description: "Segments contain conflicting facts, forcing stochastic resolution.",
    fix: "Implement contradiction detection. Flag conflicts with timestamps and source authority.",
    category: "Distractors", icon: "🎭",
  },
  stale_information: {
    label: "Stale Information",
    description: "Outdated content may conflict with current data.",
    fix: "Add timestamp metadata. Implement recency-weighted retrieval.",
    category: "Distractors", icon: "🎭",
  },
  verbose_padding: {
    label: "Verbose Padding",
    description: "Excessive qualifiers and hedging consume tokens without adding meaning.",
    fix: "Apply extractive compression before injection.",
    category: "Density", icon: "📏",
  },
  low_signal_ratio: {
    label: "Low Signal Ratio",
    description: "Too much noise, too little information per token.",
    fix: "Score sentences by information density and remove those below threshold.",
    category: "Density", icon: "📏",
  },
  filler_content: {
    label: "Filler Content",
    description: "Transitional phrases and meta-commentary waste context budget.",
    fix: "Build a filler-phrase blocklist and strip matches.",
    category: "Density", icon: "📏",
  },
  broken_references: {
    label: "Broken References",
    description: "References point to content not in the context window.",
    fix: "Detect references and either resolve them or remove referring passages.",
    category: "Fragmentation", icon: "🔗",
  },
  no_section_boundaries: {
    label: "No Section Boundaries",
    description: "One undifferentiated text block with no structural markers.",
    fix: "Add section delimiters: [SYSTEM], [RETRIEVED], [HISTORY], [TOOLS].",
    category: "Structure", icon: "🏗️",
  },
  poor_ordering: {
    label: "Poor Ordering",
    description: "Most relevant content is buried in the middle (lost-in-the-middle effect).",
    fix: "Place most relevant info at start and end of context window.",
    category: "Structure", icon: "🏗️",
  },
  oversized_context: {
    label: "Oversized Context",
    description: "Total tokens exceed effective attention capacity, triggering context rot.",
    fix: "Reduce to 30-50% of marketed capacity. Use progressive summarization.",
    category: "Economics", icon: "💰",
  },
  high_cost_low_signal: {
    label: "High Cost, Low Signal",
    description: "Poor cost-to-quality ratio — tokens far exceed information carried.",
    fix: "Apply graph-based retrieval (80% token reduction). Use structured over raw text.",
    category: "Economics", icon: "💰",
  },
  cacheable_not_cached: {
    label: "Cacheable Content",
    description: "Static content re-sent every request instead of using prompt caching.",
    fix: "Enable prompt caching for static components (90% cost savings).",
    category: "Economics", icon: "💰",
  },
};

// ── Analyzer Functions ──
function analyzeContext(context, query) {
  const segments = context.split(/\n\n+/).filter(s => s.trim());
  if (!segments.length) return null;

  const issues = [];
  const dimScores = {};
  let totalTokens = estimateTokens(context);

  // 1. Semantic Relevance
  let relevanceScore = 50;
  if (query) {
    const sims = segments.map((seg, i) => ({ i, sim: cosineSimilarityBow(seg, query) }));
    const avg = sims.reduce((a, s) => a + s.sim, 0) / sims.length;
    relevanceScore = Math.min(100, avg * 200);
    sims.forEach(({ i, sim }) => {
      if (sim < 0.02) {
        issues.push({ cause: "irrelevant_segment", severity: "high", segment: i, tokens: estimateTokens(segments[i]), improvement: 5 });
      } else if (sim < 0.10) {
        issues.push({ cause: "low_query_alignment", severity: "medium", segment: i, tokens: estimateTokens(segments[i]) / 2, improvement: 3 });
      }
    });
  }
  dimScores.semantic_relevance = { score: Math.max(0, relevanceScore), weight: 0.25, label: "Semantic Relevance" };

  // 2. Redundancy
  const hashes = {};
  segments.forEach((seg, i) => {
    const h = seg.trim().toLowerCase().replace(/\s+/g, " ");
    (hashes[h] = hashes[h] || []).push(i);
  });
  let redundantTokens = 0;
  Object.values(hashes).forEach(indices => {
    if (indices.length > 1) {
      indices.slice(1).forEach(i => {
        issues.push({ cause: "duplicate_content", severity: "high", segment: i, tokens: estimateTokens(segments[i]), improvement: 5 });
        redundantTokens += estimateTokens(segments[i]);
      });
    }
  });
  const redundancyScore = Math.max(0, 100 * (1 - (redundantTokens / Math.max(totalTokens, 1)) * 2));
  dimScores.redundancy = { score: Math.min(100, redundancyScore), weight: 0.15, label: "Redundancy" };

  // 3. Distractors
  let distractorCount = 0;
  if (query) {
    segments.forEach((seg, i) => {
      const sim = cosineSimilarityBow(seg, query);
      if (sim > 0.05 && sim < 0.18) {
        distractorCount++;
        issues.push({ cause: "topical_distractor", severity: "high", segment: i, tokens: estimateTokens(seg), improvement: 5 });
      }
    });
  }
  const distractorScore = Math.max(0, 100 - (distractorCount / Math.max(segments.length, 1)) * 150);
  dimScores.distractors = { score: Math.min(100, distractorScore), weight: 0.20, label: "Distractors" };

  // 4. Density
  const densities = segments.map(s => informationDensity(s));
  const avgDensity = densities.reduce((a, b) => a + b, 0) / densities.length;
  segments.forEach((seg, i) => {
    if (densities[i] < 0.08) {
      issues.push({ cause: "low_signal_ratio", severity: "high", segment: i, tokens: Math.floor(estimateTokens(seg) * 0.6), improvement: 4 });
    } else if (densities[i] < 0.15) {
      issues.push({ cause: "verbose_padding", severity: "medium", segment: i, tokens: Math.floor(estimateTokens(seg) * 0.3), improvement: 2 });
    }
  });
  dimScores.density = { score: Math.min(100, avgDensity * 250), weight: 0.15, label: "Density" };

  // 5. Fragmentation
  const refPatterns = [/see (?:above|below|section|table)/i, /as (?:described|mentioned) (?:above|earlier)/i, /refer to/i, /(?:table|figure|appendix) \d+/i];
  let refCount = 0;
  refPatterns.forEach(p => { if (p.test(context)) refCount++; });
  if (refCount > 0) issues.push({ cause: "broken_references", severity: "medium", tokens: 0, improvement: 3, segment: -1 });
  dimScores.fragmentation = { score: Math.max(0, 100 - refCount * 12), weight: 0.10, label: "Fragmentation" };

  // 6. Structure
  const hasStructure = /\[(?:SYSTEM|CONTEXT|HISTORY|RETRIEVED)\]|#{1,3}\s|---/i.test(context);
  let structScore = hasStructure ? 95 : 65;
  if (!hasStructure && segments.length > 3) {
    issues.push({ cause: "no_section_boundaries", severity: "medium", tokens: 0, improvement: 3, segment: -1 });
  }
  dimScores.structure = { score: structScore, weight: 0.05, label: "Structure" };

  // 7. Economics
  let econScore = 100;
  if (totalTokens > 100000) {
    issues.push({ cause: "oversized_context", severity: "critical", tokens: totalTokens - 32000, improvement: 10, segment: -1 });
    econScore -= 25;
  } else if (totalTokens > 32000) {
    issues.push({ cause: "oversized_context", severity: "high", tokens: totalTokens - 32000, improvement: 6, segment: -1 });
    econScore -= 12;
  }
  dimScores.economics = { score: Math.max(0, econScore), weight: 0.10, label: "Economics" };

  // Composite
  const totalWeight = Object.values(dimScores).reduce((a, d) => a + d.weight, 0);
  const composite = Object.values(dimScores).reduce((a, d) => a + d.score * d.weight, 0) / totalWeight;

  const wastedTokens = Math.min(totalTokens, issues.reduce((a, i) => a + (i.tokens || 0), 0));

  const grade = composite >= 95 ? "A+" : composite >= 90 ? "A" : composite >= 85 ? "A-" :
    composite >= 80 ? "B+" : composite >= 75 ? "B" : composite >= 70 ? "B-" :
    composite >= 65 ? "C+" : composite >= 60 ? "C" : composite >= 55 ? "C-" :
    composite >= 50 ? "D+" : composite >= 45 ? "D" : composite >= 40 ? "D-" : "F";

  return {
    score: Math.round(composite * 10) / 10,
    grade,
    dimensions: dimScores,
    issues: issues.sort((a, b) => {
      const sev = { critical: 0, high: 1, medium: 2, low: 3 };
      return (sev[a.severity] || 4) - (sev[b.severity] || 4);
    }),
    economics: {
      totalTokens,
      usefulTokens: totalTokens - wastedTokens,
      wastedTokens,
      wastePct: totalTokens > 0 ? Math.round(wastedTokens / totalTokens * 1000) / 10 : 0,
      cost: Math.round(totalTokens / 1000000 * 5 * 10000) / 10000,
      wastedCost: Math.round(wastedTokens / 1000000 * 5 * 10000) / 10000,
    },
    segmentCount: segments.length,
  };
}

// ── Components ──

function ScoreGauge({ score, grade }) {
  const circumference = 2 * Math.PI * 56;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 80 ? "#22c55e" : score >= 60 ? "#eab308" : score >= 40 ? "#f97316" : "#ef4444";

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <svg width="140" height="140" viewBox="0 0 140 140">
        <circle cx="70" cy="70" r="56" fill="none" stroke="#1e293b" strokeWidth="10" />
        <circle cx="70" cy="70" r="56" fill="none" stroke={color} strokeWidth="10"
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" transform="rotate(-90 70 70)"
          style={{ transition: "stroke-dashoffset 0.8s ease" }} />
        <text x="70" y="64" textAnchor="middle" fill="#f1f5f9" fontFamily="JetBrains Mono, monospace" fontSize="28" fontWeight="bold">
          {Math.round(score)}
        </text>
        <text x="70" y="86" textAnchor="middle" fill={color} fontFamily="JetBrains Mono, monospace" fontSize="16" fontWeight="bold">
          {grade}
        </text>
      </svg>
    </div>
  );
}

function DimensionBar({ name, score, weight, issueCount }) {
  const pct = Math.round(score);
  const color = score >= 80 ? "#22c55e" : score >= 60 ? "#eab308" : score >= 40 ? "#f97316" : "#ef4444";
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3, fontSize: 12, fontFamily: "JetBrains Mono, monospace" }}>
        <span style={{ color: "#94a3b8" }}>{name}</span>
        <span style={{ color }}>{pct} <span style={{ color: "#64748b", fontSize: 10 }}>({issueCount})</span></span>
      </div>
      <div style={{ background: "#1e293b", borderRadius: 4, height: 8, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 4, transition: "width 0.6s ease" }} />
      </div>
    </div>
  );
}

function IssueCard({ issue }) {
  const catalog = CAUSE_CATALOG[issue.cause] || { label: issue.cause, description: "", fix: "", category: "Unknown", icon: "❓" };
  const sevColor = { critical: "#ef4444", high: "#f97316", medium: "#eab308", low: "#3b82f6" };
  const sevBg = { critical: "rgba(239,68,68,0.1)", high: "rgba(249,115,22,0.1)", medium: "rgba(234,179,8,0.08)", low: "rgba(59,130,246,0.08)" };

  return (
    <div style={{
      background: sevBg[issue.severity] || "rgba(100,116,139,0.08)",
      border: `1px solid ${sevColor[issue.severity] || "#475569"}33`,
      borderLeft: `3px solid ${sevColor[issue.severity] || "#475569"}`,
      borderRadius: 8, padding: "14px 16px", marginBottom: 10,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16 }}>{catalog.icon}</span>
          <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>
            {catalog.label}
          </span>
        </div>
        <span style={{
          fontSize: 10, fontFamily: "JetBrains Mono, monospace", fontWeight: 700,
          color: sevColor[issue.severity], textTransform: "uppercase", letterSpacing: 1,
          background: `${sevColor[issue.severity]}15`, padding: "2px 8px", borderRadius: 4,
        }}>
          {issue.severity}
        </span>
      </div>
      <p style={{ fontSize: 12, color: "#94a3b8", margin: "0 0 8px", lineHeight: 1.5 }}>{catalog.description}</p>
      <div style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.15)", borderRadius: 6, padding: "8px 12px" }}>
        <div style={{ fontSize: 10, color: "#22c55e", fontWeight: 700, marginBottom: 3, letterSpacing: 0.5, fontFamily: "JetBrains Mono, monospace" }}>
          RECOMMENDED FIX
        </div>
        <p style={{ fontSize: 12, color: "#a7f3d0", margin: 0, lineHeight: 1.5 }}>{catalog.fix}</p>
      </div>
      {issue.tokens > 0 && (
        <div style={{ marginTop: 8, fontSize: 11, color: "#64748b", fontFamily: "JetBrains Mono, monospace" }}>
          💾 ~{issue.tokens.toLocaleString()} tokens saveable &nbsp;|&nbsp; 📈 +{issue.improvement} pts potential
        </div>
      )}
    </div>
  );
}

// ── Example Contexts ──
const EXAMPLES = {
  poor: {
    label: "Poor Context (Many Issues)",
    context: `The weather today is sunny with a high of 75 degrees.

Machine learning models use gradient descent to optimize loss functions.
The learning rate controls the step size during optimization.

Yesterday I had a great sandwich for lunch at the deli.

The stock market closed up 2% on Tuesday.

Machine learning models use gradient descent to optimize loss functions.
The learning rate controls the step size during optimization.

It is important to note that in this particular context, we should be aware of the fact that there are many things that we need to consider and think about carefully before making any decisions about what to do next in this situation.

As of 2019, the recommended approach was the legacy method. The system is not using the latest techniques.`,
    query: "How does gradient descent optimize neural network training?",
  },
  good: {
    label: "Good Context (Well-Structured)",
    context: `[SYSTEM]
You are a machine learning expert assistant. Answer based on the retrieved context.

[RETRIEVED_CONTEXT]
Source: ML Fundamentals Textbook | Date: 2024 | Confidence: 0.95
Gradient descent is an iterative optimization algorithm that minimizes a loss function by computing its gradient with respect to model parameters. The gradient indicates the direction of steepest ascent; parameters are updated by stepping in the opposite direction, scaled by the learning rate.

Source: Neural Network Training Guide | Date: 2024 | Confidence: 0.92
The learning rate is a critical hyperparameter in gradient descent. Too large a value causes divergence; too small causes slow convergence. Adaptive methods like Adam adjust learning rates per-parameter based on gradient history.

Source: Deep Learning Review | Date: 2025 | Confidence: 0.90
Stochastic gradient descent (SGD) uses random mini-batches rather than the full dataset, reducing computation per step while maintaining convergence guarantees in expectation. Batch size affects the noise level in gradient estimates.`,
    query: "How does gradient descent optimize neural network training?",
  },
  mixed: {
    label: "Mixed Context (Moderate Issues)",
    context: `You are an AI assistant. You must always provide accurate information.

AWS EC2 instances can be launched in multiple availability zones.
Auto Scaling adjusts capacity based on demand patterns.

As mentioned above in Section 3, the pricing model varies by region.
See Table 5 for the complete breakdown of pricing.

AWS Lambda functions execute code without provisioning servers.
Lambda scales automatically from a few requests to thousands per second.

The annual company picnic was held last Saturday at the park.
Everyone enjoyed the barbecue and games.`,
    query: "What AWS compute services should I use for auto-scaling?",
  },
};

// ── Main App ──
export default function ContextScoreApp() {
  const [context, setContext] = useState(EXAMPLES.poor.context);
  const [query, setQuery] = useState(EXAMPLES.poor.query);
  const [result, setResult] = useState(null);
  const [activeTab, setActiveTab] = useState("issues");

  const runAnalysis = useCallback(() => {
    const r = analyzeContext(context, query);
    setResult(r);
  }, [context, query]);

  const loadExample = (key) => {
    setContext(EXAMPLES[key].context);
    setQuery(EXAMPLES[key].query);
    setResult(null);
  };

  const severityCounts = useMemo(() => {
    if (!result) return {};
    const counts = {};
    result.issues.forEach(i => { counts[i.severity] = (counts[i.severity] || 0) + 1; });
    return counts;
  }, [result]);

  return (
    <div style={{
      minHeight: "100vh", background: "#0a0f1a",
      fontFamily: "'Outfit', 'Segoe UI', system-ui, sans-serif",
      color: "#e2e8f0",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        textarea:focus, input:focus { outline: none; border-color: #6366f1 !important; }
        ::selection { background: #6366f1; color: white; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: #0f172a; }
        ::-webkit-scrollbar-thumb { background: #334155; border-radius: 3px; }
      `}</style>

      {/* Header */}
      <header style={{
        padding: "20px 32px", borderBottom: "1px solid #1e293b",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "linear-gradient(180deg, #0f172a 0%, #0a0f1a 100%)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18, fontWeight: 700, color: "white",
          }}>C</div>
          <div>
            <div style={{ fontFamily: "JetBrains Mono, monospace", fontWeight: 700, fontSize: 16, letterSpacing: -0.5 }}>
              ContextScore
            </div>
            <div style={{ fontSize: 11, color: "#64748b", letterSpacing: 0.5 }}>
              Context Quality Scoring Engine
            </div>
          </div>
        </div>
        <div style={{ fontSize: 11, color: "#475569", fontFamily: "JetBrains Mono, monospace" }}>
          v0.1.0 MVP
        </div>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, minHeight: "calc(100vh - 77px)" }}>
        {/* Left: Input Panel */}
        <div style={{ padding: 24, borderRight: "1px solid #1e293b", overflow: "auto" }}>
          {/* Examples */}
          <div style={{ marginBottom: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {Object.entries(EXAMPLES).map(([key, ex]) => (
              <button key={key} onClick={() => loadExample(key)} style={{
                background: "#1e293b", border: "1px solid #334155", borderRadius: 6,
                color: "#94a3b8", padding: "5px 12px", fontSize: 11, cursor: "pointer",
                fontFamily: "JetBrains Mono, monospace", transition: "all 0.2s",
              }}
              onMouseOver={e => { e.target.style.borderColor = "#6366f1"; e.target.style.color = "#c7d2fe"; }}
              onMouseOut={e => { e.target.style.borderColor = "#334155"; e.target.style.color = "#94a3b8"; }}
              >
                {ex.label}
              </button>
            ))}
          </div>

          <label style={{ fontSize: 11, color: "#64748b", fontWeight: 600, letterSpacing: 1, fontFamily: "JetBrains Mono, monospace", display: "block", marginBottom: 6 }}>
            QUERY / TASK
          </label>
          <input
            value={query} onChange={e => setQuery(e.target.value)}
            placeholder="What is the user asking?"
            style={{
              width: "100%", padding: "10px 14px", background: "#0f172a",
              border: "1px solid #1e293b", borderRadius: 8, color: "#e2e8f0",
              fontSize: 13, fontFamily: "JetBrains Mono, monospace", marginBottom: 16,
            }}
          />

          <label style={{ fontSize: 11, color: "#64748b", fontWeight: 600, letterSpacing: 1, fontFamily: "JetBrains Mono, monospace", display: "block", marginBottom: 6 }}>
            CONTEXT WINDOW
          </label>
          <textarea
            value={context} onChange={e => setContext(e.target.value)}
            placeholder="Paste your full context window here..."
            style={{
              width: "100%", height: "calc(100vh - 340px)", padding: 14,
              background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8,
              color: "#cbd5e1", fontSize: 12, fontFamily: "JetBrains Mono, monospace",
              lineHeight: 1.6, resize: "vertical",
            }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
            <span style={{ fontSize: 11, color: "#475569", fontFamily: "JetBrains Mono, monospace" }}>
              ~{estimateTokens(context).toLocaleString()} tokens &nbsp;|&nbsp; {context.split(/\n\n+/).filter(s => s.trim()).length} segments
            </span>
            <button onClick={runAnalysis} style={{
              background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
              border: "none", borderRadius: 8, color: "white",
              padding: "10px 28px", fontSize: 13, fontWeight: 600,
              cursor: "pointer", fontFamily: "Outfit, sans-serif",
              letterSpacing: 0.3, transition: "transform 0.1s, box-shadow 0.2s",
              boxShadow: "0 4px 15px rgba(99,102,241,0.3)",
            }}
            onMouseDown={e => e.target.style.transform = "scale(0.97)"}
            onMouseUp={e => e.target.style.transform = "scale(1)"}
            >
              Score Context
            </button>
          </div>
        </div>

        {/* Right: Results Panel */}
        <div style={{ padding: 24, overflow: "auto", background: "#0c1220" }}>
          {!result ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "#334155" }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>🔬</div>
              <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 14 }}>Paste context and click "Score Context"</div>
              <div style={{ fontSize: 12, marginTop: 8, color: "#1e293b" }}>or load an example above</div>
            </div>
          ) : (
            <>
              {/* Score Header */}
              <div style={{
                display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 24,
                alignItems: "center", marginBottom: 24, padding: 20,
                background: "#111827", borderRadius: 12, border: "1px solid #1e293b",
              }}>
                <ScoreGauge score={result.score} grade={result.grade} />
                <div>
                  <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: "#64748b", marginBottom: 4, letterSpacing: 1 }}>
                    CONTEXT COHERENCE SCORE
                  </div>
                  <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.5 }}>
                    {result.issues.length} issues found across {result.segmentCount} segments
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    {severityCounts.critical > 0 && <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "rgba(239,68,68,0.15)", color: "#ef4444", fontFamily: "JetBrains Mono, monospace" }}>🔴 {severityCounts.critical} critical</span>}
                    {severityCounts.high > 0 && <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "rgba(249,115,22,0.15)", color: "#f97316", fontFamily: "JetBrains Mono, monospace" }}>🟠 {severityCounts.high} high</span>}
                    {severityCounts.medium > 0 && <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "rgba(234,179,8,0.1)", color: "#eab308", fontFamily: "JetBrains Mono, monospace" }}>🟡 {severityCounts.medium} medium</span>}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: "#64748b", letterSpacing: 1 }}>TOKEN WASTE</div>
                  <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 24, fontWeight: 700, color: result.economics.wastePct > 50 ? "#ef4444" : result.economics.wastePct > 25 ? "#f97316" : "#22c55e" }}>
                    {result.economics.wastePct}%
                  </div>
                  <div style={{ fontSize: 11, color: "#475569", fontFamily: "JetBrains Mono, monospace" }}>
                    {result.economics.wastedTokens.toLocaleString()} / {result.economics.totalTokens.toLocaleString()} tokens
                  </div>
                </div>
              </div>

              {/* Dimension Scores */}
              <div style={{ background: "#111827", borderRadius: 12, border: "1px solid #1e293b", padding: 16, marginBottom: 20 }}>
                <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, letterSpacing: 1, fontFamily: "JetBrains Mono, monospace", marginBottom: 12 }}>
                  QUALITY DIMENSIONS
                </div>
                {Object.entries(result.dimensions).map(([key, dim]) => (
                  <DimensionBar key={key} name={dim.label} score={dim.score} weight={dim.weight}
                    issueCount={result.issues.filter(i => (CAUSE_CATALOG[i.cause]?.category || "").toLowerCase().replace(/\s/g,"_") === key || true && false).length}
                  />
                ))}
              </div>

              {/* Tabs */}
              <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
                {[
                  { key: "issues", label: `Issues (${result.issues.length})` },
                  { key: "economics", label: "Economics" },
                ].map(tab => (
                  <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
                    background: activeTab === tab.key ? "#1e293b" : "transparent",
                    border: `1px solid ${activeTab === tab.key ? "#334155" : "transparent"}`,
                    borderRadius: 6, padding: "6px 16px", fontSize: 12,
                    color: activeTab === tab.key ? "#e2e8f0" : "#64748b",
                    cursor: "pointer", fontFamily: "JetBrains Mono, monospace",
                    fontWeight: activeTab === tab.key ? 600 : 400,
                  }}>
                    {tab.label}
                  </button>
                ))}
              </div>

              {activeTab === "issues" && (
                <div>
                  {result.issues.map((issue, idx) => (
                    <IssueCard key={idx} issue={issue} />
                  ))}
                  {result.issues.length === 0 && (
                    <div style={{ textAlign: "center", padding: 40, color: "#22c55e", fontFamily: "JetBrains Mono, monospace" }}>
                      ✓ No issues detected — context quality is excellent
                    </div>
                  )}
                </div>
              )}

              {activeTab === "economics" && (
                <div style={{ background: "#111827", borderRadius: 12, border: "1px solid #1e293b", padding: 20 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                    {[
                      { label: "Total Tokens", value: result.economics.totalTokens.toLocaleString(), color: "#94a3b8" },
                      { label: "Useful Tokens", value: result.economics.usefulTokens.toLocaleString(), color: "#22c55e" },
                      { label: "Wasted Tokens", value: result.economics.wastedTokens.toLocaleString(), color: "#ef4444" },
                      { label: "Waste %", value: `${result.economics.wastePct}%`, color: result.economics.wastePct > 50 ? "#ef4444" : "#eab308" },
                      { label: "Est. Cost (per req)", value: `$${result.economics.cost}`, color: "#94a3b8" },
                      { label: "Wasted Cost", value: `$${result.economics.wastedCost}`, color: "#ef4444" },
                    ].map((stat, i) => (
                      <div key={i} style={{ background: "#0a0f1a", borderRadius: 8, padding: 14 }}>
                        <div style={{ fontSize: 10, color: "#64748b", fontFamily: "JetBrains Mono, monospace", letterSpacing: 1, marginBottom: 4 }}>
                          {stat.label}
                        </div>
                        <div style={{ fontSize: 20, fontWeight: 700, color: stat.color, fontFamily: "JetBrains Mono, monospace" }}>
                          {stat.value}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 16, padding: 14, background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: "#a5b4fc", fontWeight: 600, fontFamily: "JetBrains Mono, monospace", marginBottom: 6 }}>
                      💡 AT SCALE PROJECTION
                    </div>
                    <div style={{ fontSize: 12, color: "#c7d2fe", lineHeight: 1.6 }}>
                      At 1,000 requests/day with current waste rate: ~<strong>${(result.economics.wastedCost * 1000 * 30).toFixed(2)}/month</strong> in wasted tokens.
                      Fixing all issues could save ~<strong>{(result.economics.wastedTokens * 1000).toLocaleString()} tokens/day</strong>.
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
