import { ContextSnapshot, SnapshotDecision, SnapshotEntity } from "../core/models.js";
import { ContextScorer } from "../core/scorer.js";
import { wordTokenize, estimateTokens } from "../core/utils.js";

/**
 * Extracts critical context elements that should survive compaction.
 * Analyzes session content for: decisions, entities, file paths, patterns, errors.
 */
export class SnapshotExtractor {
  private scorer = new ContextScorer();

  extract(
    segments: string[],
    query: string,
    sessionId: string,
  ): ContextSnapshot {
    const result = this.scorer.score(segments.join("\n\n"), query, segments);

    return {
      sessionId,
      timestamp: new Date().toISOString(),
      turnCount: segments.length,
      tokenCount: segments.reduce((a, s) => a + estimateTokens(s), 0),
      qualityScore: result.score,
      decisions: this.extractDecisions(segments),
      entities: this.extractEntities(segments),
      activeFiles: this.extractFilePaths(segments),
      patterns: this.extractPatterns(segments),
      errorResolutions: this.extractErrorResolutions(segments),
      currentTask: this.inferCurrentTask(segments),
      compactInstructions: this.generateCompactInstructions(result, segments),
    };
  }

  private extractDecisions(segments: string[]): SnapshotDecision[] {
    const decisions: SnapshotDecision[] = [];
    const decisionPatterns = [
      /(?:decided|choosing|going with|will use|using|switched to|chose|selected|opted for)\s+(.{10,80})/gi,
      /(?:because|reason|rationale|since|due to)\s+(.{10,80})/gi,
      /(?:instead of|rather than|not using)\s+(.{10,60})/gi,
      /(?:the approach|the strategy|the plan|architecture)\s+(?:is|will be)\s+(.{10,80})/gi,
    ];

    for (let i = 0; i < segments.length; i++) {
      for (const pattern of decisionPatterns) {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(segments[i])) !== null) {
          const desc = match[0].trim();
          if (desc.length > 15) {
            decisions.push({
              description: desc.slice(0, 200),
              reasoning: "",
              affectedFiles: this.extractFilePaths([segments[i]]),
              timestamp: new Date().toISOString(),
            });
          }
        }
      }
    }

    // Deduplicate by first 50 chars
    const seen = new Set<string>();
    return decisions.filter(d => {
      const key = d.description.slice(0, 50).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 20); // Cap at 20 decisions
  }

  private extractEntities(segments: string[]): SnapshotEntity[] {
    const entities: SnapshotEntity[] = [];
    const full = segments.join("\n");

    // File/module names
    const filePattern = /(?:[\w-]+\.(?:ts|js|py|tsx|jsx|css|html|json|yaml|yml|toml|md|rs|go|java|rb|swift|kt))/g;
    const files = full.match(filePattern) ?? [];
    for (const f of [...new Set(files)].slice(0, 30)) {
      entities.push({ name: f, type: "file", context: "", lastMentionedTurn: -1 });
    }

    // Function/class names (camelCase or PascalCase)
    const codePattern = /\b([A-Z][a-zA-Z0-9]{2,30}(?:Service|Controller|Manager|Handler|Router|Provider|Factory|Repository|Component|Module|Middleware|Client|Store))\b/g;
    const codeNames = full.match(codePattern) ?? [];
    for (const name of [...new Set(codeNames)].slice(0, 20)) {
      entities.push({ name, type: "class", context: "", lastMentionedTurn: -1 });
    }

    // Variable/config names (UPPER_SNAKE or specific patterns)
    const configPattern = /\b([A-Z][A-Z0-9_]{3,30})\b/g;
    const configs = full.match(configPattern) ?? [];
    for (const c of [...new Set(configs)].filter(c => c.length > 4).slice(0, 15)) {
      entities.push({ name: c, type: "config", context: "", lastMentionedTurn: -1 });
    }

    return entities;
  }

  private extractFilePaths(segments: string[]): string[] {
    const full = segments.join("\n");
    const pathPattern = /(?:\.\/|\/|~\/|src\/|lib\/|app\/|packages\/)[\w./-]+/g;
    const matches = full.match(pathPattern) ?? [];
    return [...new Set(matches)].slice(0, 30);
  }

  private extractPatterns(segments: string[]): string[] {
    const patterns: string[] = [];
    const full = segments.join("\n");

    const patternIndicators = [
      /(?:pattern|convention|standard|approach|style|rule):\s*(.{10,100})/gi,
      /(?:always|never|must|should)\s+(.{10,80})/gi,
      /(?:naming convention|file structure|directory layout)\s+(.{10,80})/gi,
    ];

    for (const re of patternIndicators) {
      re.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = re.exec(full)) !== null) {
        patterns.push(match[0].trim().slice(0, 150));
      }
    }

    return [...new Set(patterns)].slice(0, 15);
  }

  private extractErrorResolutions(segments: string[]): string[] {
    const resolutions: string[] = [];
    const errorPatterns = [
      /(?:fixed|resolved|solution|fix was|the issue was|root cause)\s+(.{10,100})/gi,
      /(?:error|bug|issue).*?(?:fixed by|resolved by|solved by)\s+(.{10,80})/gi,
    ];

    const full = segments.join("\n");
    for (const re of errorPatterns) {
      re.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = re.exec(full)) !== null) {
        resolutions.push(match[0].trim().slice(0, 150));
      }
    }

    return [...new Set(resolutions)].slice(0, 10);
  }

  private inferCurrentTask(segments: string[]): string {
    if (segments.length === 0) return "Unknown";
    // The last user-facing segment likely describes the current task
    const last = segments[segments.length - 1];
    const firstSentence = last.split(/[.!?\n]/).find(s => s.trim().length > 10);
    return firstSentence?.trim().slice(0, 200) ?? "Continuing previous work";
  }

  generateCompactInstructions(
    result: { score: number; issues: Array<{ cause: string; category: string; severity: string }> },
    segments: string[],
  ): string {
    const lines: string[] = [
      "COMPACTION PRIORITY INSTRUCTIONS:",
      "",
      "MUST PRESERVE (critical for session continuity):",
    ];

    const files = this.extractFilePaths(segments);
    if (files.length) {
      lines.push(`- Active files: ${files.slice(0, 10).join(", ")}`);
    }

    const decisions = this.extractDecisions(segments);
    if (decisions.length) {
      lines.push("- Key decisions made:");
      for (const d of decisions.slice(0, 5)) {
        lines.push(`  * ${d.description}`);
      }
    }

    const errors = this.extractErrorResolutions(segments);
    if (errors.length) {
      lines.push("- Error resolutions (DO NOT re-introduce these bugs):");
      for (const e of errors.slice(0, 5)) {
        lines.push(`  * ${e}`);
      }
    }

    lines.push("");
    lines.push("CAN DISCARD (low value):");

    const criticalIssues = result.issues.filter(
      i => i.severity === "high" || i.severity === "critical"
    );
    if (criticalIssues.length) {
      lines.push(`- ${criticalIssues.length} low-quality segments identified by ContextScore`);
    }

    lines.push("- Verbose tool output already processed");
    lines.push("- Redundant file reads (keep only most recent version)");
    lines.push("- Exploratory paths that were abandoned");

    return lines.join("\n");
  }
}
