import { DimensionScore, ContextIssue, IssueCause, Severity, createIssue } from "../models.js";
import {
  cosineSimilarityBow, estimateTokens, wordTokenize, contentHash,
  jaccardSimilarity, informationDensity, detectFormattingOverhead,
  detectFillerPhrases, detectReferences, extractEntities,
} from "../utils.js";

// ── Base ──
export interface Analyzer {
  name: string;
  weight: number;
  analyze(segments: string[], query: string): DimensionScore;
}

// ── 1. Semantic Relevance ──
export class SemanticRelevanceAnalyzer implements Analyzer {
  name = "semantic_relevance";
  weight = 0.25;

  analyze(segments: string[], query: string): DimensionScore {
    const issues: ContextIssue[] = [];
    if (!segments.length || !query) return { name: this.name, score: 50, weight: this.weight, issues };

    const sims = segments.map((seg, i) => ({ i, sim: cosineSimilarityBow(seg, query) }));
    for (const { i, sim } of sims) {
      if (sim < 0.02) {
        issues.push(createIssue(IssueCause.IRRELEVANT_SEGMENT, Severity.HIGH, {
          affectedSegments: [i], estimatedImprovement: 5, estimatedTokenSavings: estimateTokens(segments[i]),
          evidence: `Segment ${i}: similarity ${sim.toFixed(3)} (threshold: 0.02)`,
        }));
      } else if (sim < 0.10) {
        issues.push(createIssue(IssueCause.LOW_QUERY_ALIGNMENT, Severity.MEDIUM, {
          affectedSegments: [i], estimatedImprovement: 3, estimatedTokenSavings: Math.floor(estimateTokens(segments[i]) / 2),
          evidence: `Segment ${i}: similarity ${sim.toFixed(3)} (threshold: 0.10)`,
        }));
      }
    }

    if (sims.length >= 6) {
      const third = Math.floor(sims.length / 3);
      const early = sims.slice(0, third).reduce((a, s) => a + s.sim, 0) / third;
      const late = sims.slice(-third).reduce((a, s) => a + s.sim, 0) / third;
      if (early > 0.01 && (early - late) / Math.max(early, 0.01) > 0.4) {
        issues.push(createIssue(IssueCause.TOPIC_DRIFT, Severity.MEDIUM, {
          estimatedImprovement: 4, evidence: `Relevance dropped from ${early.toFixed(3)} to ${late.toFixed(3)}`,
        }));
      }
    }

    const avg = sims.reduce((a, s) => a + s.sim, 0) / sims.length;
    const penalty = issues.filter(i => i.severity === Severity.HIGH).length * 2
      + issues.filter(i => i.severity === Severity.MEDIUM).length;
    const score = Math.max(0, Math.min(100, avg * 200 - penalty));
    return { name: this.name, score, weight: this.weight, issues };
  }
}

// ── 2. Redundancy ──
export class RedundancyAnalyzer implements Analyzer {
  name = "redundancy";
  weight = 0.15;

  analyze(segments: string[], query: string): DimensionScore {
    const issues: ContextIssue[] = [];
    if (segments.length < 2) return { name: this.name, score: 100, weight: this.weight, issues };

    const capped = segments.slice(0, 100);
    const hashes: Record<string, number[]> = {};
    const dupSet = new Set<number>();

    for (let i = 0; i < capped.length; i++) {
      const h = contentHash(capped[i]);
      (hashes[h] ??= []).push(i);
    }
    for (const indices of Object.values(hashes)) {
      if (indices.length > 1) {
        indices.slice(1).forEach(i => dupSet.add(i));
        issues.push(createIssue(IssueCause.DUPLICATE_CONTENT, Severity.HIGH, {
          affectedSegments: indices.slice(1), estimatedImprovement: 5,
          estimatedTokenSavings: indices.slice(1).reduce((a, i) => a + estimateTokens(capped[i]), 0),
          evidence: `Segments ${indices.join(",")} are exact duplicates`,
        }));
      }
    }

    const wordSets = capped.map(s => new Set(wordTokenize(s)));
    for (let i = 0; i < capped.length; i++) {
      if (dupSet.has(i)) continue;
      for (let j = i + 1; j < capped.length; j++) {
        if (dupSet.has(j)) continue;
        if (contentHash(capped[i]) === contentHash(capped[j])) continue;
        const jacc = jaccardSimilarity(wordSets[i], wordSets[j]);
        if (jacc >= 0.85) {
          issues.push(createIssue(IssueCause.NEAR_DUPLICATE, Severity.HIGH, {
            affectedSegments: [j], estimatedImprovement: 4, estimatedTokenSavings: estimateTokens(capped[j]),
            evidence: `Segments ${i},${j}: Jaccard ${jacc.toFixed(2)}`,
          }));
        } else if (jacc < 0.70) {
          const cos = cosineSimilarityBow(capped[i], capped[j]);
          if (cos >= 0.70) {
            issues.push(createIssue(IssueCause.PARAPHRASED_REPETITION, Severity.MEDIUM, {
              affectedSegments: [j], estimatedImprovement: 3, estimatedTokenSavings: Math.floor(estimateTokens(capped[j]) / 2),
              evidence: `Segments ${i},${j}: Jaccard ${jacc.toFixed(2)}, Cosine ${cos.toFixed(2)}`,
            }));
          }
        }
      }
    }

    const total = capped.reduce((a, s) => a + estimateTokens(s), 0);
    const wasted = issues.reduce((a, i) => a + i.estimatedTokenSavings, 0);
    const score = Math.max(0, Math.min(100, 100 * (1 - (wasted / Math.max(total, 1)) * 2)));
    return { name: this.name, score, weight: this.weight, issues };
  }
}

// ── 3. Distractors ──
export class DistractorAnalyzer implements Analyzer {
  name = "distractors";
  weight = 0.20;

  analyze(segments: string[], query: string): DimensionScore {
    const issues: ContextIssue[] = [];
    if (!segments.length || !query) return { name: this.name, score: 80, weight: this.weight, issues };

    let distractorCount = 0;
    for (let i = 0; i < segments.length; i++) {
      const sim = cosineSimilarityBow(segments[i], query);
      if (sim > 0.05 && sim < 0.18) {
        const qWords = new Set(wordTokenize(query).filter(w => w.length > 4));
        const sWords = new Set(wordTokenize(segments[i]).filter(w => w.length > 4));
        const overlap = [...qWords].filter(w => sWords.has(w)).length;
        if (qWords.size === 0 || overlap / qWords.size <= 0.3) {
          distractorCount++;
          issues.push(createIssue(IssueCause.TOPICAL_DISTRACTOR, Severity.HIGH, {
            affectedSegments: [i], estimatedImprovement: 5, estimatedTokenSavings: estimateTokens(segments[i]),
            evidence: `Segment ${i}: topically related (sim=${sim.toFixed(3)}) but unlikely answer`,
          }));
        }
      }
    }

    // Contradiction detection
    const negPairs: [RegExp, RegExp][] = [
      [/\bis not\b/i, /\bis\b/i], [/\bcannot\b/i, /\bcan\b/i],
      [/\bnever\b/i, /\balways\b/i], [/\bdecreased\b/i, /\bincreased\b/i],
    ];
    for (let i = 0; i < segments.length; i++) {
      for (let j = i + 1; j < segments.length; j++) {
        if (cosineSimilarityBow(segments[i], segments[j]) < 0.3) continue;
        for (const [neg, pos] of negPairs) {
          if ((neg.test(segments[i]) && pos.test(segments[j])) || (neg.test(segments[j]) && pos.test(segments[i]))) {
            issues.push(createIssue(IssueCause.CONTRADICTORY_INFORMATION, Severity.CRITICAL, {
              affectedSegments: [i, j], estimatedImprovement: 8,
              evidence: `Segments ${i},${j}: contradictory claims detected`,
            }));
            break;
          }
        }
      }
    }

    // Stale content
    const staleRe = /\b(?:as of|updated?|current as of)\s+(?:20[0-1]\d|2020|2021|2022)\b/i;
    for (let i = 0; i < segments.length; i++) {
      if (staleRe.test(segments[i])) {
        issues.push(createIssue(IssueCause.STALE_INFORMATION, Severity.MEDIUM, {
          affectedSegments: [i], estimatedImprovement: 2,
          evidence: `Segment ${i}: contains temporal markers suggesting outdated info`,
        }));
      }
    }

    const ratio = distractorCount / Math.max(segments.length, 1);
    let score = Math.max(0, 100 - ratio * 150);
    score -= issues.filter(i => i.cause === IssueCause.CONTRADICTORY_INFORMATION).length * 10;
    return { name: this.name, score: Math.max(0, Math.min(100, score)), weight: this.weight, issues };
  }
}

// ── 4. Density ──
export class DensityAnalyzer implements Analyzer {
  name = "density";
  weight = 0.15;

  analyze(segments: string[], query: string): DimensionScore {
    const issues: ContextIssue[] = [];
    if (!segments.length) return { name: this.name, score: 50, weight: this.weight, issues };

    const densities: number[] = [];
    let totalFiller = 0;
    let totalFmt = 0;

    for (let i = 0; i < segments.length; i++) {
      const d = informationDensity(segments[i]);
      densities.push(d);
      if (d < 0.08) {
        issues.push(createIssue(IssueCause.LOW_SIGNAL_RATIO, Severity.HIGH, {
          affectedSegments: [i], estimatedImprovement: 4,
          estimatedTokenSavings: Math.floor(estimateTokens(segments[i]) * 0.6),
          evidence: `Segment ${i}: density ${d.toFixed(3)}`,
        }));
      } else if (d < 0.15) {
        issues.push(createIssue(IssueCause.VERBOSE_PADDING, Severity.MEDIUM, {
          affectedSegments: [i], estimatedImprovement: 2,
          estimatedTokenSavings: Math.floor(estimateTokens(segments[i]) * 0.3),
          evidence: `Segment ${i}: density ${d.toFixed(3)}`,
        }));
      }
      const fmt = detectFormattingOverhead(segments[i]);
      totalFmt += fmt;
      if (fmt > 0.20) {
        issues.push(createIssue(IssueCause.EXCESSIVE_FORMATTING, Severity.LOW, {
          affectedSegments: [i], estimatedImprovement: 1,
          estimatedTokenSavings: Math.floor(estimateTokens(segments[i]) * fmt),
        }));
      }
      totalFiller += detectFillerPhrases(segments[i]).length;
    }

    if (totalFiller >= 3) {
      issues.push(createIssue(IssueCause.FILLER_CONTENT, Severity.MEDIUM, {
        estimatedImprovement: 2, estimatedTokenSavings: totalFiller * 8,
        evidence: `${totalFiller} filler phrases found`,
      }));
    }

    const avg = densities.reduce((a, b) => a + b, 0) / densities.length;
    const avgFmt = totalFmt / segments.length;
    const score = Math.max(0, Math.min(100, avg * 250 * (1 - avgFmt * 0.5)));
    return { name: this.name, score, weight: this.weight, issues };
  }
}

// ── 5. Fragmentation ──
export class FragmentationAnalyzer implements Analyzer {
  name = "fragmentation";
  weight = 0.10;

  analyze(segments: string[], query: string): DimensionScore {
    const issues: ContextIssue[] = [];
    if (!segments.length) return { name: this.name, score: 50, weight: this.weight, issues };

    const full = segments.join("\n\n");
    const refs = detectReferences(full);
    if (refs.length) {
      issues.push(createIssue(IssueCause.BROKEN_REFERENCES, Severity.MEDIUM, {
        estimatedImprovement: 3, evidence: `${refs.length} dangling references found`,
      }));
    }

    const entities = extractEntities(full);
    const words = wordTokenize(full);
    const freq: Record<string, number> = {};
    for (const w of words) freq[w] = (freq[w] ?? 0) + 1;

    const orphaned = entities.filter(e => {
      const ew = wordTokenize(e);
      return ew.length > 0 && Math.min(...ew.map(w => freq[w] ?? 0)) < 2;
    });
    if (orphaned.length) {
      issues.push(createIssue(IssueCause.ORPHANED_ENTITIES, Severity.LOW, {
        estimatedImprovement: 2, evidence: `${orphaned.length} entities without sufficient context`,
      }));
    }

    for (let i = 0; i < segments.length; i++) {
      const se = extractEntities(segments[i]);
      if (se.length && estimateTokens(segments[i]) < 30) {
        issues.push(createIssue(IssueCause.INCOMPLETE_CONTEXT, Severity.MEDIUM, {
          affectedSegments: [i], estimatedImprovement: 2,
          evidence: `Segment ${i}: ${se.length} entities in only ${estimateTokens(segments[i])} tokens`,
        }));
      }
    }

    if (entities.length > 5) {
      const relWords = new Set(["between","relates","connected","associated","linked","caused","depends","requires","affects","belongs","contains","includes"]);
      const relCount = words.filter(w => relWords.has(w)).length;
      if (relCount / entities.length < 0.2) {
        issues.push(createIssue(IssueCause.MISSING_RELATIONSHIP_CONTEXT, Severity.MEDIUM, {
          estimatedImprovement: 4, evidence: `${entities.length} entities, only ${relCount} relationship indicators`,
        }));
      }
    }

    let score = 100;
    for (const issue of issues) {
      if (issue.severity === Severity.CRITICAL) score -= 20;
      else if (issue.severity === Severity.HIGH) score -= 12;
      else if (issue.severity === Severity.MEDIUM) score -= 7;
      else if (issue.severity === Severity.LOW) score -= 3;
    }
    return { name: this.name, score: Math.max(0, Math.min(100, score)), weight: this.weight, issues };
  }
}

// ── 6. Structure ──
export class StructureAnalyzer implements Analyzer {
  name = "structure";
  weight = 0.05;

  analyze(segments: string[], query: string): DimensionScore {
    const issues: ContextIssue[] = [];
    if (!segments.length) return { name: this.name, score: 50, weight: this.weight, issues };

    const full = segments.join("\n\n");
    const sectionMarkers = [/#{1,6}\s/, /\[(?:SYSTEM|CONTEXT|HISTORY|RETRIEVED|USER|TOOL)\]/i, /---+/, /<\/?(?:system|user|assistant)/i];
    const hasStructure = sectionMarkers.some(p => p.test(full));

    if (!hasStructure && segments.length > 3) {
      issues.push(createIssue(IssueCause.NO_SECTION_BOUNDARIES, Severity.MEDIUM, { estimatedImprovement: 3 }));
    }

    const metadataPatterns = [/(?:source|from|via):\s*\S+/i, /(?:date|timestamp|updated):\s*\S+/i, /(?:confidence|score):\s*[\d.]+/i];
    if (!metadataPatterns.some(p => p.test(full)) && segments.length > 2) {
      issues.push(createIssue(IssueCause.MISSING_METADATA, Severity.LOW, { estimatedImprovement: 1 }));
    }

    if (query && segments.length >= 5) {
      const sims = segments.map(s => cosineSimilarityBow(s, query));
      const n = sims.length;
      const third = Math.floor(n / 3);
      if (third > 0) {
        const startAvg = sims.slice(0, third).reduce((a, b) => a + b, 0) / third;
        const midAvg = sims.slice(third, 2 * third).reduce((a, b) => a + b, 0) / third;
        const endAvg = sims.slice(2 * third).reduce((a, b) => a + b, 0) / (n - 2 * third);
        if (midAvg > Math.max(startAvg, endAvg) * 1.3) {
          issues.push(createIssue(IssueCause.POOR_ORDERING, Severity.MEDIUM, {
            estimatedImprovement: 3,
            evidence: `start=${startAvg.toFixed(2)}, mid=${midAvg.toFixed(2)}, end=${endAvg.toFixed(2)}`,
          }));
        }
      }
    }

    let score = 100;
    for (const issue of issues) {
      score -= issue.severity === Severity.MEDIUM ? 12 : 5;
    }
    return { name: this.name, score: Math.max(0, Math.min(100, score)), weight: this.weight, issues };
  }
}

// ── 7. Economics ──
export class EconomicsAnalyzer implements Analyzer {
  name = "economics";
  weight = 0.10;

  analyze(segments: string[], query: string): DimensionScore {
    const issues: ContextIssue[] = [];
    if (!segments.length) return { name: this.name, score: 50, weight: this.weight, issues };

    const total = segments.reduce((a, s) => a + estimateTokens(s), 0);

    if (total > 100_000) {
      issues.push(createIssue(IssueCause.OVERSIZED_CONTEXT, Severity.CRITICAL, {
        estimatedImprovement: 10, estimatedTokenSavings: total - 32_000,
        evidence: `${total.toLocaleString()} tokens — well above effective attention threshold`,
      }));
    } else if (total > 32_000) {
      issues.push(createIssue(IssueCause.ATTENTION_BUDGET_EXCEEDED, Severity.HIGH, {
        estimatedImprovement: 6, estimatedTokenSavings: total - 32_000,
        evidence: `${total.toLocaleString()} tokens — approaching attention budget limits`,
      }));
    }

    for (let i = 0; i < segments.length; i++) {
      const t = estimateTokens(segments[i]);
      const d = informationDensity(segments[i]);
      if (d < 0.10 && t > 200) {
        issues.push(createIssue(IssueCause.HIGH_COST_LOW_SIGNAL, Severity.HIGH, {
          affectedSegments: [i], estimatedImprovement: 3, estimatedTokenSavings: Math.floor(t * 0.7),
          evidence: `Segment ${i}: ${t} tokens at ${d.toFixed(2)} density`,
        }));
      }
    }

    const staticKw = ["you are","system prompt","instructions:","rules:","always","never","your role","you must"];
    const staticSegs: number[] = [];
    for (let i = 0; i < segments.length; i++) {
      const lower = segments[i].toLowerCase();
      if (staticKw.some(kw => lower.includes(kw))) staticSegs.push(i);
    }
    if (staticSegs.length) {
      const staticTokens = staticSegs.reduce((a, i) => a + estimateTokens(segments[i]), 0);
      if (staticTokens > 200) {
        issues.push(createIssue(IssueCause.CACHEABLE_CONTENT_NOT_CACHED, Severity.MEDIUM, {
          affectedSegments: staticSegs, estimatedImprovement: 2,
          estimatedTokenSavings: Math.floor(staticTokens * 0.9),
          evidence: `${staticSegs.length} segments (${staticTokens} tokens) appear static and cacheable`,
        }));
      }
    }

    let score = 100;
    for (const issue of issues) {
      if (issue.severity === Severity.CRITICAL) score -= 25;
      else if (issue.severity === Severity.HIGH) score -= 12;
      else if (issue.severity === Severity.MEDIUM) score -= 6;
    }
    return { name: this.name, score: Math.max(0, Math.min(100, score)), weight: this.weight, issues };
  }
}

export const ALL_ANALYZERS: Analyzer[] = [
  new SemanticRelevanceAnalyzer(),
  new RedundancyAnalyzer(),
  new DistractorAnalyzer(),
  new DensityAnalyzer(),
  new FragmentationAnalyzer(),
  new StructureAnalyzer(),
  new EconomicsAnalyzer(),
];
