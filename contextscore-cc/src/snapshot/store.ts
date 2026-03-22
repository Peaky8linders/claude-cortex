import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import type { ContextSnapshot } from "../core/models.js";

const SNAPSHOT_DIR = ".claude/context-snapshots";

export class SnapshotStore {
  private dir: string;

  constructor(projectRoot: string = process.cwd()) {
    this.dir = join(projectRoot, SNAPSHOT_DIR);
  }

  save(snapshot: ContextSnapshot): string {
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true });
    }

    const filename = `${snapshot.sessionId}-${Date.now()}.json`;
    const filepath = join(this.dir, filename);
    writeFileSync(filepath, JSON.stringify(snapshot, null, 2), "utf-8");
    return filepath;
  }

  loadLatest(sessionId?: string): ContextSnapshot | null {
    if (!existsSync(this.dir)) return null;

    const files = readdirSync(this.dir)
      .filter(f => f.endsWith(".json"))
      .filter(f => !sessionId || f.startsWith(sessionId))
      .sort()
      .reverse();

    if (files.length === 0) return null;

    const raw = readFileSync(join(this.dir, files[0]), "utf-8");
    return JSON.parse(raw) as ContextSnapshot;
  }

  listSnapshots(): Array<{ file: string; sessionId: string; timestamp: string; score: number }> {
    if (!existsSync(this.dir)) return [];

    return readdirSync(this.dir)
      .filter(f => f.endsWith(".json"))
      .map(f => {
        try {
          const raw = readFileSync(join(this.dir, f), "utf-8");
          const snap = JSON.parse(raw) as ContextSnapshot;
          return {
            file: f,
            sessionId: snap.sessionId,
            timestamp: snap.timestamp,
            score: snap.qualityScore,
          };
        } catch {
          return null;
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }
}
