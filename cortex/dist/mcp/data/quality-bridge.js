/**
 * Quality Bridge — Shell out to Python contextscore for 7-dimension scoring.
 *
 * The Python contextscore module is the single source of truth for quality analysis.
 * This bridge calls it via subprocess and parses the JSON output.
 */
import { execFile } from "child_process";
import { randomUUID } from "crypto";
import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync, openSync, closeSync, constants } from "fs";
import { join } from "path";
import { homedir, tmpdir } from "os";
import { promisify } from "util";
const execFileAsync = promisify(execFile);
/** Cost per token at $5/1M tokens */
export const COST_PER_TOKEN = 0.000005;
/**
 * Score context using Python contextscore module.
 * Falls back to a lightweight local analysis if Python is unavailable.
 */
export async function scoreContext(context, query = "general session quality") {
    // Pass query via env var to avoid code injection (never interpolate into Python source)
    const pythonScript = `
import json, sys, os
try:
    from contextscore.scorer import ContextScorer
    scorer = ContextScorer()
    text = sys.stdin.read()
    q = os.environ.get("CORTEX_QUERY", "general session quality")
    result = scorer.score(context=text, query=q)
    out = {
        "score": result.score,
        "grade": result.grade,
        "dimensions": {},
        "economics": {
            "total_tokens": result.economics.total_tokens if hasattr(result, 'economics') else max(1, len(text) // 4),
            "wasted_tokens": result.economics.wasted_tokens if hasattr(result, 'economics') else 0,
            "waste_percentage": result.economics.waste_percentage if hasattr(result, 'economics') else 0,
            "estimated_cost": result.economics.estimated_cost if hasattr(result, 'economics') else 0,
        },
        "issues": []
    }
    if hasattr(result, 'dimensions'):
        for name, dim in result.dimensions.items():
            out["dimensions"][name] = {
                "score": dim.score,
                "weight": dim.weight,
                "issue_count": dim.issue_count,
                "top_issue": dim.top_issue if hasattr(dim, 'top_issue') else None,
            }
    if hasattr(result, 'issues'):
        for issue in result.issues[:10]:
            out["issues"].append({
                "cause": str(issue.cause),
                "severity": str(issue.severity),
                "category": str(issue.category) if hasattr(issue, 'category') else "unknown",
                "fix": str(issue.fix) if hasattr(issue, 'fix') else "",
                "estimated_token_savings": issue.estimated_token_savings if hasattr(issue, 'estimated_token_savings') else 0,
            })
    print(json.dumps(out))
except Exception as e:
    print(json.dumps({"error": str(e)}), file=sys.stderr)
    sys.exit(1)
`;
    try {
        // Write script to temp file with unpredictable name (crypto UUID)
        const tmpScript = join(tmpdir(), `cortex-quality-${randomUUID()}.py`);
        // Use exclusive creation to prevent TOCTOU race
        const fd = openSync(tmpScript, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
        writeFileSync(fd, pythonScript, "utf-8");
        closeSync(fd);
        try {
            const { stdout } = await execFileAsync("python3", [tmpScript], {
                encoding: "utf-8",
                timeout: 10_000,
                maxBuffer: 1024 * 1024,
                env: { ...process.env, CORTEX_QUERY: query },
            });
            return JSON.parse(stdout.trim());
        }
        finally {
            try {
                unlinkSync(tmpScript);
            }
            catch { /* cleanup best-effort */ }
        }
    }
    catch (err) {
        // Log warning when Python bridge fails, then fall back to local analysis
        console.error("[cortex] Python contextscore unavailable, using local analysis:", err instanceof Error ? err.message : String(err));
        return analyzeLocally(context);
    }
}
/**
 * Read the latest context snapshot and score it.
 */
export async function scoreLatestSnapshot(query = "general session quality") {
    const snapshotDir = join(homedir(), ".claude", "context-snapshots");
    if (!existsSync(snapshotDir)) {
        return analyzeLocally("");
    }
    try {
        const files = readdirSync(snapshotDir)
            .filter(f => f.endsWith(".json"))
            .sort()
            .reverse();
        if (files.length === 0) {
            return analyzeLocally("");
        }
        const snapshot = JSON.parse(readFileSync(join(snapshotDir, files[0]), "utf-8"));
        // Build context from snapshot fields
        const contextParts = [
            snapshot.current_task ?? "",
            ...(snapshot.decisions ?? []).map((d) => d.description ?? ""),
            ...(snapshot.patterns ?? []),
            ...(snapshot.active_files ?? []),
        ];
        const context = contextParts.join("\n");
        return await scoreContext(context, query);
    }
    catch {
        return analyzeLocally("");
    }
}
/**
 * Local quality analysis — no Python dependency.
 * Performs real text analysis instead of returning synthetic data.
 */
function analyzeLocally(context) {
    const tokens = Math.max(1, Math.floor(context.length / 4));
    const lines = context.split("\n").filter(l => l.trim().length > 0);
    const words = context.split(/\s+/).filter(w => w.length > 0);
    // Real analysis: check for redundancy (duplicate lines)
    const uniqueLines = new Set(lines);
    const redundancyRatio = lines.length > 0 ? uniqueLines.size / lines.length : 1;
    const redundancyScore = Math.round(redundancyRatio * 100);
    // Density: average info per line (words per non-empty line)
    const avgWordsPerLine = lines.length > 0 ? words.length / lines.length : 0;
    const densityScore = Math.min(100, Math.round(avgWordsPerLine * 8));
    // Structure: check for headings, sections, consistent formatting
    const hasHeadings = lines.some(l => /^#+\s/.test(l) || /^[A-Z][A-Z\s]+:/.test(l));
    const hasLists = lines.some(l => /^\s*[-*]\s/.test(l));
    const structureScore = (hasHeadings ? 40 : 0) + (hasLists ? 30 : 0) + (lines.length > 3 ? 30 : 15);
    // Fragmentation: check for incomplete references
    const codeRefs = (context.match(/`[^`]+`/g) ?? []).length;
    const fragmentationScore = Math.min(100, 60 + codeRefs * 2);
    // Economics: estimate waste from low-value content
    const fillerWords = (context.match(/\b(the|a|an|is|are|was|were|be|been|being)\b/gi) ?? []).length;
    const fillerRatio = words.length > 0 ? fillerWords / words.length : 0;
    const economicsScore = Math.round((1 - fillerRatio) * 100);
    // Semantic relevance (basic: presence of technical terms)
    const techTerms = (context.match(/\b(function|class|import|export|const|let|var|return|async|await|interface|type)\b/g) ?? []).length;
    const semanticScore = Math.min(100, 50 + techTerms * 3);
    // Distractors
    const distractorScore = Math.min(100, 70 + Math.round(redundancyRatio * 20));
    const dimensions = {
        semantic_relevance: { score: semanticScore, weight: 0.25, issue_count: semanticScore < 50 ? 1 : 0 },
        redundancy: { score: redundancyScore, weight: 0.15, issue_count: redundancyScore < 70 ? 1 : 0, top_issue: redundancyScore < 70 ? `${lines.length - uniqueLines.size} duplicate lines` : undefined },
        distractors: { score: distractorScore, weight: 0.10, issue_count: 0 },
        density: { score: densityScore, weight: 0.15, issue_count: densityScore < 40 ? 1 : 0, top_issue: densityScore < 40 ? `Low density: ${avgWordsPerLine.toFixed(1)} words/line` : undefined },
        fragmentation: { score: fragmentationScore, weight: 0.10, issue_count: fragmentationScore < 50 ? 1 : 0 },
        structure: { score: structureScore, weight: 0.10, issue_count: structureScore < 50 ? 1 : 0, top_issue: !hasHeadings ? "No section headings found" : undefined },
        economics: { score: economicsScore, weight: 0.15, issue_count: economicsScore < 60 ? 1 : 0 },
    };
    // Weighted composite
    const compositeScore = Math.round(Object.values(dimensions).reduce((sum, d) => sum + d.score * d.weight, 0));
    const grade = compositeScore >= 95 ? "A+" : compositeScore >= 90 ? "A" : compositeScore >= 85 ? "A-" :
        compositeScore >= 80 ? "B+" : compositeScore >= 75 ? "B" : compositeScore >= 70 ? "B-" :
            compositeScore >= 65 ? "C+" : compositeScore >= 60 ? "C" : compositeScore >= 55 ? "C-" :
                compositeScore >= 50 ? "D+" : compositeScore >= 45 ? "D" : "F";
    const wastedTokens = Math.floor(tokens * fillerRatio * 0.5);
    return {
        score: compositeScore,
        grade,
        dimensions,
        economics: {
            total_tokens: tokens,
            wasted_tokens: wastedTokens,
            waste_percentage: tokens > 0 ? Math.round(wastedTokens / tokens * 100) : 0,
            estimated_cost: tokens * COST_PER_TOKEN,
        },
        issues: Object.entries(dimensions)
            .filter(([, d]) => d.top_issue)
            .map(([name, d]) => ({
            cause: name,
            severity: d.score < 40 ? "high" : d.score < 60 ? "medium" : "low",
            category: name,
            fix: d.top_issue,
            estimated_token_savings: Math.floor(tokens * (1 - d.score / 100) * d.weight),
        })),
    };
}
