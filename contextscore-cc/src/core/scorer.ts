import { ScoreResult, DimensionScore, ContextIssue, TokenEconomics, Severity } from "./models.js";
import { ALL_ANALYZERS, type Analyzer } from "./analyzers/index.js";
import { estimateTokens, splitSegments } from "./utils.js";

const GRADES: [number, string][] = [
  [95, "A+"], [90, "A"], [85, "A-"], [80, "B+"], [75, "B"], [70, "B-"],
  [65, "C+"], [60, "C"], [55, "C-"], [50, "D+"], [45, "D"], [40, "D-"], [0, "F"],
];

export class ContextScorer {
  private analyzers: Analyzer[];
  private costPerMillion: number;
  private maxSegments: number;

  constructor(opts: { costPerMillion?: number; maxSegments?: number } = {}) {
    this.analyzers = ALL_ANALYZERS;
    this.costPerMillion = opts.costPerMillion ?? 5.0;
    this.maxSegments = opts.maxSegments ?? 200;
  }

  score(context: string, query: string, segments?: string[]): ScoreResult {
    let segs = segments ?? splitSegments(context);
    if (!segs.length && context) segs = [context];
    if (segs.length > this.maxSegments) segs = segs.slice(0, this.maxSegments);

    const dimensions: Record<string, DimensionScore> = {};
    const allIssues: ContextIssue[] = [];

    for (const analyzer of this.analyzers) {
      const dim = analyzer.analyze(segs, query);
      dimensions[dim.name] = dim;
      allIssues.push(...dim.issues);
    }

    const totalWeight = Object.values(dimensions).reduce((a, d) => a + d.weight, 0);
    const composite = totalWeight > 0
      ? Object.values(dimensions).reduce((a, d) => a + d.score * d.weight, 0) / totalWeight
      : 0;

    const sevOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    allIssues.sort((a, b) => (sevOrder[a.severity] ?? 4) - (sevOrder[b.severity] ?? 4) || b.estimatedImprovement - a.estimatedImprovement);

    const totalTokens = segs.reduce((a, s) => a + estimateTokens(s), 0);
    const wastedTokens = Math.min(totalTokens, allIssues.reduce((a, i) => a + i.estimatedTokenSavings, 0));
    const economics: TokenEconomics = {
      totalTokens,
      usefulTokens: totalTokens - wastedTokens,
      wastedTokens,
      wastePercentage: totalTokens > 0 ? (wastedTokens / totalTokens) * 100 : 0,
      estimatedCost: (totalTokens / 1_000_000) * this.costPerMillion,
      wastedCost: (wastedTokens / 1_000_000) * this.costPerMillion,
    };

    const grade = GRADES.find(([t]) => composite >= t)?.[1] ?? "F";

    const critical = allIssues.filter(i => i.severity === Severity.CRITICAL).length;
    const high = allIssues.filter(i => i.severity === Severity.HIGH).length;
    const weakest = Object.values(dimensions).reduce((a, b) => a.score < b.score ? a : b);
    const strongest = Object.values(dimensions).reduce((a, b) => a.score > b.score ? a : b);
    const savingsStr = wastedTokens > 0 ? ` Fixing all issues saves ~${wastedTokens.toLocaleString()} tokens.` : "";

    const summary = `CCS: ${Math.round(composite)}/100 (${grade}).`
      + (critical ? ` ${critical} critical.` : "")
      + (high ? ` ${high} high.` : "")
      + ` Weakest: ${weakest.name} (${Math.round(weakest.score)}). Strongest: ${strongest.name} (${Math.round(strongest.score)}).`
      + savingsStr;

    return {
      score: Math.round(composite * 10) / 10,
      grade,
      dimensions,
      issues: allIssues,
      economics,
      contextLength: estimateTokens(context),
      segmentCount: segs.length,
      summary,
    };
  }
}
