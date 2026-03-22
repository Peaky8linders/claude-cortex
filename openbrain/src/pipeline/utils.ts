import { randomBytes } from "crypto";

export function generateId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.floor(text.length / 4));
}

export function extractPatterns(text: string): string[] {
  const patterns: string[] = [];
  const re = [
    /(?:pattern|convention|standard|approach|rule|always|never|must):\s*(.{10,100})/gi,
    /(?:using the|following the|adopted the)\s+(.{5,60})\s+(?:pattern|approach|convention)/gi,
  ];
  for (const r of re) {
    r.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = r.exec(text)) !== null) {
      patterns.push(m[0].trim().slice(0, 150));
    }
  }
  return [...new Set(patterns)].slice(0, 10);
}
