import type { ContextSnapshot } from "../core/models.js";
import { SnapshotStore } from "./store.js";

/**
 * Generates structured recovery context to inject after compaction.
 * Reads the latest snapshot and produces a focused recovery prompt.
 */
export class ContextRecovery {
  private store: SnapshotStore;

  constructor(projectRoot?: string) {
    this.store = new SnapshotStore(projectRoot);
  }

  /**
   * Generate recovery text to inject after compaction.
   * Returns null if no snapshot is available.
   */
  recover(sessionId?: string): string | null {
    const snapshot = this.store.loadLatest(sessionId);
    if (!snapshot) return null;
    return this.formatRecovery(snapshot);
  }

  private formatRecovery(snap: ContextSnapshot): string {
    const lines: string[] = [
      "═══ CONTEXT RECOVERY (post-compaction) ═══",
      "",
      `Session: ${snap.sessionId}`,
      `Snapshot taken: ${snap.timestamp}`,
      `Quality score at snapshot: ${snap.qualityScore}/100`,
      `Tokens at snapshot: ${snap.tokenCount.toLocaleString()}`,
      "",
    ];

    // Current task
    if (snap.currentTask) {
      lines.push("## Current Task");
      lines.push(snap.currentTask);
      lines.push("");
    }

    // Active files
    if (snap.activeFiles.length) {
      lines.push("## Active Files");
      for (const f of snap.activeFiles.slice(0, 15)) {
        lines.push(`  - ${f}`);
      }
      lines.push("");
    }

    // Decisions (most critical for continuity)
    if (snap.decisions.length) {
      lines.push("## Key Decisions Made (DO NOT reverse these)");
      for (const d of snap.decisions.slice(0, 10)) {
        lines.push(`  - ${d.description}`);
        if (d.affectedFiles.length) {
          lines.push(`    Files: ${d.affectedFiles.join(", ")}`);
        }
      }
      lines.push("");
    }

    // Entities
    const fileEntities = snap.entities.filter(e => e.type === "file");
    const codeEntities = snap.entities.filter(e => e.type === "class" || e.type === "config");
    if (codeEntities.length) {
      lines.push("## Key Code Entities");
      for (const e of codeEntities.slice(0, 15)) {
        lines.push(`  - ${e.name} (${e.type})`);
      }
      lines.push("");
    }

    // Patterns
    if (snap.patterns.length) {
      lines.push("## Established Patterns & Conventions");
      for (const p of snap.patterns.slice(0, 8)) {
        lines.push(`  - ${p}`);
      }
      lines.push("");
    }

    // Error resolutions
    if (snap.errorResolutions.length) {
      lines.push("## Resolved Errors (DO NOT re-introduce)");
      for (const e of snap.errorResolutions.slice(0, 5)) {
        lines.push(`  - ${e}`);
      }
      lines.push("");
    }

    lines.push("═══ END CONTEXT RECOVERY ═══");
    return lines.join("\n");
  }
}
