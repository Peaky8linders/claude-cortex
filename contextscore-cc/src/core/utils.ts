import { createHash } from "crypto";

const STOP_WORDS = new Set([
  "the","a","an","is","are","was","were","be","been","being","have","has","had",
  "do","does","did","will","would","could","should","may","might","shall","can",
  "need","to","of","in","for","on","with","at","by","from","as","into","through",
  "during","before","after","above","below","between","out","off","over","under",
  "again","further","then","once","here","there","when","where","why","how","all",
  "both","each","few","more","most","other","some","such","no","nor","not","only",
  "own","same","so","than","too","very","just","because","but","and","or","if",
  "while","that","this","these","those","it","its","i","me","my","we","our","you",
  "your","he","him","his","she","her","they","them","their","what","which","who",
  "whom","important","note","something","things","many","particular","aware","fact",
  "carefully","decisions","next","situation","consider","think","really","quite",
]);

export function estimateTokens(text: string): number {
  return Math.max(1, Math.floor(text.length / 4));
}

export function wordTokenize(text: string): string[] {
  return (text.toLowerCase().match(/\b\w+\b/g) ?? []);
}

export function splitSegments(text: string, delimiter?: string): string[] {
  const parts = delimiter ? text.split(delimiter) : text.split(/\n\n+/);
  return parts.map(p => p.trim()).filter(Boolean);
}

export function contentHash(text: string): string {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("md5").update(normalized).digest("hex");
}

export function cosineSimilarityBow(textA: string, textB: string): number {
  const wordsA: Record<string, number> = {};
  const wordsB: Record<string, number> = {};
  for (const w of wordTokenize(textA)) wordsA[w] = (wordsA[w] ?? 0) + 1;
  for (const w of wordTokenize(textB)) wordsB[w] = (wordsB[w] ?? 0) + 1;

  const allWords = new Set([...Object.keys(wordsA), ...Object.keys(wordsB)]);
  if (allWords.size === 0) return 0;

  let dot = 0, magA = 0, magB = 0;
  for (const w of allWords) {
    const a = wordsA[w] ?? 0;
    const b = wordsB[w] ?? 0;
    dot += a * b;
    magA += a * a;
    magB += b * b;
  }
  magA = Math.sqrt(magA);
  magB = Math.sqrt(magB);
  return magA === 0 || magB === 0 ? 0 : dot / (magA * magB);
}

export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  const intersection = new Set([...a].filter(x => b.has(x)));
  const union = new Set([...a, ...b]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

export function informationDensity(text: string): number {
  const words = wordTokenize(text);
  if (words.length === 0) return 0;
  const content = words.filter(w => !STOP_WORDS.has(w) && w.length > 2);
  if (content.length === 0) return 0;
  const unique = new Set(content);
  return (content.length / words.length) * (unique.size / content.length);
}

export function detectFormattingOverhead(text: string): number {
  if (text.length === 0) return 0;
  const patterns = [
    /#{1,6}\s/g, /\*{1,3}[^*]+\*{1,3}/g, /```[^`]*```/gs,
    /<[^>]+>/g, /\|[^|]+\|/g, /[-=]{3,}/g, /^\s*[-*+]\s/gm, /^\s*\d+\.\s/gm,
  ];
  let fmtChars = 0;
  for (const p of patterns) {
    const matches = text.match(p);
    if (matches) fmtChars += matches.reduce((s, m) => s + m.length, 0);
  }
  return Math.min(1, fmtChars / text.length);
}

export function detectFillerPhrases(text: string): string[] {
  const patterns = [
    /\bas mentioned (?:above|earlier|before|previously)\b/gi,
    /\bit is (?:important|worth) (?:to note|noting|mentioning) that\b/gi,
    /\bin (?:this|the) (?:context|regard|respect)\b/gi,
    /\bas we (?:can see|know|discussed)\b/gi,
    /\bin order to\b/gi,
    /\bdue to the fact that\b/gi,
    /\bit should be noted that\b/gi,
    /\bat the end of the day\b/gi,
    /\bneedless to say\b/gi,
    /\bat this point in time\b/gi,
    /\bin terms of\b/gi,
  ];
  const found: string[] = [];
  for (const p of patterns) {
    const matches = text.match(p);
    if (matches) found.push(...matches);
  }
  return found;
}

export function detectReferences(text: string): string[] {
  const patterns = [
    /\bsee (?:above|below|section|figure|table|appendix)\b/gi,
    /\bas (?:described|shown|mentioned|noted) (?:above|below|earlier|in section)\b/gi,
    /\brefer to (?:the|section|figure|table)\b/gi,
    /\b(?:figure|table|appendix|exhibit|chart) \d+\b/gi,
    /\bthe (?:aforementioned|above-mentioned|previously described)\b/gi,
  ];
  const found: string[] = [];
  for (const p of patterns) {
    const matches = text.match(p);
    if (matches) found.push(...matches);
  }
  return found;
}

export function extractEntities(text: string): string[] {
  const pattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g;
  const matches = text.match(pattern) ?? [];
  return [...new Set(matches)];
}
