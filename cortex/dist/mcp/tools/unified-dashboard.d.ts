/**
 * Unified Dashboard — session observability visualization
 *
 * Generates a self-contained HTML page combining:
 *   - KPI tiles (tokens, cost, duration, quality)
 *   - Token timeline (line chart with spike markers)
 *   - Tool usage (horizontal bar chart)
 *   - Quality radar (spider chart, 7 dimensions)
 *   - Cost by model (pie chart)
 *   - Activity gantt (timeline bars)
 *   - Event feed (scrollable table)
 *   - Knowledge graph (force-directed, from graph-explorer)
 *   - Cross-session history (optional)
 *
 * Zero external dependencies — Canvas 2D rendering, inline CSS/JS.
 */
export interface DashboardResult {
    path: string;
    message: string;
    kpis: {
        total_tokens: number;
        estimated_cost: number;
        session_duration_minutes: number;
        quality_score: number;
        quality_grade: string;
    };
}
export declare function computeUnifiedDashboard(sessionId?: string, crossSession?: boolean, knowledgeDir?: string): Promise<DashboardResult>;
