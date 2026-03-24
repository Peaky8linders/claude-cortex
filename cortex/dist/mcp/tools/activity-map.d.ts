/**
 * Activity Map Tool — Gantt-like skill/hook/tool activation timeline
 */
export interface Activation {
    start: string;
    end: string;
    duration_ms: number;
}
export interface ActivityTrack {
    name: string;
    type: "hook" | "skill" | "tool";
    activations: Activation[];
    total_count: number;
    total_duration_ms: number;
}
export interface ActivityMapResult {
    session_start: string;
    session_end: string;
    duration_minutes: number;
    tracks: ActivityTrack[];
    concurrency_peak: number;
    busiest_period: string;
    tools_summary: Record<string, number>;
    skills_used: string[];
}
export declare function computeActivityMap(sessionId?: string, includeHooks?: boolean, includeSkills?: boolean, knowledgeDir?: string): ActivityMapResult;
