import { useState, useCallback, useMemo } from "react";

// ═══════════════════════════════════════════════════════
//  Claude Code Skills & Hooks Architecture Graph
//  Interactive visualization of the full lifecycle
// ═══════════════════════════════════════════════════════

const HOOK_EVENTS = [
  { id: "setup", name: "Setup", desc: "Init/maintenance. Runs before SessionStart for first-time setup, dependency checks, onboarding.", phase: "session", x: 80, y: 60, color: "#64748b", handlers: ["command"], matcher: "init|maintenance", canBlock: false, example: "Check required tools exist, run npm install" },
  { id: "session_start", name: "SessionStart", desc: "Fires when a session begins. Stdout becomes Claude's context. Set env vars via CLAUDE_ENV_FILE.", phase: "session", x: 80, y: 140, color: "#22c55e", handlers: ["command"], matcher: "startup|resume|clear|compact", canBlock: false, example: "Load git status, inject recent tickets, set NODE_ENV" },
  { id: "user_prompt", name: "UserPromptSubmit", desc: "Fires when user submits a prompt. Can inject context, validate input, or block submission.", phase: "loop", x: 80, y: 260, color: "#3b82f6", handlers: ["command", "prompt"], matcher: null, canBlock: true, example: "Enrich prompt with project context, validate not empty" },
  { id: "pre_tool", name: "PreToolUse", desc: "THE GATEKEEPER. Fires before any tool executes. Can ALLOW, DENY, or MODIFY the tool input. Exit code 2 = block.", phase: "tools", x: 300, y: 320, color: "#ef4444", handlers: ["command", "http", "prompt", "agent"], matcher: "Bash|Edit|Write|Read|Search|WebFetch|Task", canBlock: true, example: "Block rm -rf, protect .env files, validate commands" },
  { id: "permission", name: "PermissionRequest", desc: "Fires when user would see a permission dialog. Auto-approve safe operations, block dangerous ones.", phase: "tools", x: 520, y: 320, color: "#f97316", handlers: ["command", "http"], matcher: "Bash|Edit|Write", canBlock: true, example: "Auto-approve npm test, block npm publish" },
  { id: "post_tool", name: "PostToolUse", desc: "THE WORKHORSE. Fires after a tool succeeds. Auto-format, lint, run tests, log actions. Cannot undo.", phase: "tools", x: 520, y: 420, color: "#10b981", handlers: ["command", "http", "prompt", "agent"], matcher: "Write|Edit|MultiEdit|Bash", canBlock: false, example: "Run prettier, eslint --fix, pytest on changed files" },
  { id: "post_tool_fail", name: "PostToolUseFailure", desc: "Fires when a tool fails. Error tracking, retry logic, alerting.", phase: "tools", x: 300, y: 420, color: "#dc2626", handlers: ["command", "http"], matcher: "Bash|Edit|Write", canBlock: false, example: "Log error to monitoring, notify Slack, attempt retry" },
  { id: "subagent_start", name: "SubagentStart", desc: "Fires when a subagent is spawned via the Agent tool.", phase: "subagent", x: 700, y: 260, color: "#8b5cf6", handlers: ["command"], matcher: null, canBlock: false, example: "Log subagent creation, allocate resources" },
  { id: "subagent_stop", name: "SubagentStop", desc: "Fires when a subagent completes. Validate output, run cleanup.", phase: "subagent", x: 700, y: 370, color: "#a855f7", handlers: ["command", "prompt", "agent"], matcher: null, canBlock: false, example: "Validate subagent output quality, merge results" },
  { id: "notification", name: "Notification", desc: "Fires on system notifications (async). Route to Slack, desktop, or custom alerting.", phase: "loop", x: 700, y: 140, color: "#eab308", handlers: ["command", "http"], matcher: "permission_prompt|idle_prompt|auth_success", canBlock: false, example: "Send Slack message, desktop notification, log event" },
  { id: "pre_compact", name: "PreCompact", desc: "Fires before context compaction. Last chance to snapshot critical context before it's summarized.", phase: "maintenance", x: 700, y: 480, color: "#f43f5e", handlers: ["command"], matcher: "manual|auto", canBlock: false, example: "Snapshot decisions, entities, file list to .claude/" },
  { id: "post_compact", name: "PostCompact", desc: "Fires after compaction completes. Inject recovery context.", phase: "maintenance", x: 520, y: 540, color: "#fb923c", handlers: ["command"], matcher: null, canBlock: false, example: "Load snapshot, inject recovery context into session" },
  { id: "stop", name: "Stop", desc: "Fires when Claude finishes responding. Exit code 2 forces Claude to keep working. Validate completion.", phase: "loop", x: 300, y: 540, color: "#06b6d4", handlers: ["command", "prompt", "agent"], matcher: null, canBlock: true, example: "Check tests pass before allowing stop, enforce todo completion" },
  { id: "session_end", name: "SessionEnd", desc: "Session cleanup. Save logs, generate summaries, tear down resources.", phase: "session", x: 80, y: 540, color: "#475569", handlers: ["command"], matcher: "exit|sigint|error", canBlock: false, example: "Save session log, push metrics, cleanup temp files" },
  { id: "teammate_idle", name: "TeammateIdle", desc: "Fires in Agent Teams when a teammate finishes and becomes idle.", phase: "subagent", x: 700, y: 60, color: "#7c3aed", handlers: ["command"], matcher: null, canBlock: false, example: "Assign next task to idle teammate" },
  { id: "task_completed", name: "TaskCompleted", desc: "Fires when a task in the task queue is completed.", phase: "subagent", x: 520, y: 60, color: "#6366f1", handlers: ["command"], matcher: null, canBlock: false, example: "Update progress tracker, trigger next dependent task" },
];

const CONNECTIONS = [
  { from: "setup", to: "session_start", label: "init" },
  { from: "session_start", to: "user_prompt", label: "ready" },
  { from: "user_prompt", to: "pre_tool", label: "Claude processes" },
  { from: "pre_tool", to: "permission", label: "allow?" },
  { from: "permission", to: "post_tool", label: "execute", style: "success" },
  { from: "permission", to: "post_tool_fail", label: "fail", style: "error" },
  { from: "post_tool", to: "user_prompt", label: "next turn", style: "loop" },
  { from: "post_tool_fail", to: "user_prompt", label: "retry", style: "error" },
  { from: "pre_tool", to: "subagent_start", label: "spawn agent" },
  { from: "subagent_start", to: "subagent_stop", label: "completes" },
  { from: "subagent_stop", to: "post_tool", label: "return" },
  { from: "post_tool", to: "stop", label: "done?" },
  { from: "stop", to: "session_end", label: "exit" },
  { from: "stop", to: "user_prompt", label: "continue (exit 2)", style: "loop" },
  { from: "post_tool", to: "pre_compact", label: "context full" },
  { from: "pre_compact", to: "post_compact", label: "summarize" },
  { from: "post_compact", to: "user_prompt", label: "recovered", style: "loop" },
  { from: "user_prompt", to: "notification", label: "async" },
  { from: "task_completed", to: "teammate_idle", label: "next" },
];

const SKILLS = [
  { id: "claudemd", name: "CLAUDE.md", desc: "Project instructions, conventions, persistent context. Loaded every session.", type: "config", hooks: ["session_start"], color: "#22c55e" },
  { id: "memory", name: "MEMORY.md", desc: "Auto-learned patterns. First 200 lines loaded at session start.", type: "memory", hooks: ["session_start", "session_end"], color: "#06b6d4" },
  { id: "skills", name: "Skills (.claude/skills/)", desc: "Reusable techniques with frontmatter hooks. Hot-reload on change.", type: "skill", hooks: ["pre_tool", "post_tool", "stop"], color: "#f59e0b" },
  { id: "commands", name: "Slash Commands", desc: "Custom /commands as markdown files in .claude/commands/.", type: "command", hooks: ["user_prompt"], color: "#3b82f6" },
  { id: "subagents", name: "Subagents", desc: "Task/Explore/custom agents with isolated context windows.", type: "agent", hooks: ["subagent_start", "subagent_stop", "pre_tool", "post_tool"], color: "#8b5cf6" },
  { id: "mcp", name: "MCP Servers", desc: "Model Context Protocol — external tool integration. 97M+ monthly SDK downloads.", type: "protocol", hooks: ["pre_tool", "post_tool", "permission"], color: "#ef4444" },
  { id: "plugins", name: "Plugins", desc: "npm packages with hooks, commands, and skills bundled together.", type: "plugin", hooks: ["session_start", "pre_tool", "post_tool", "stop"], color: "#f97316" },
  { id: "worktrees", name: "Worktrees", desc: "Isolated git branches for parallel work. Sparse checkout for monorepos.", type: "env", hooks: ["session_start"], color: "#64748b" },
];

const HANDLER_TYPES = [
  { name: "command", desc: "Shell script. Most common. Fast, deterministic.", icon: "⚡", color: "#22c55e" },
  { name: "http", desc: "POST to URL endpoint. For remote validation, team policies.", icon: "🌐", color: "#3b82f6" },
  { name: "prompt", desc: "LLM-judged evaluation. Semantic checks, quality assessment.", icon: "🧠", color: "#f59e0b" },
  { name: "agent", desc: "Full codebase-aware agent review. Deepest analysis.", icon: "🤖", color: "#ef4444" },
];

const PHASES = {
  session: { label: "Session Lifecycle", color: "#22c55e", y: 30 },
  loop: { label: "Conversation Loop", color: "#3b82f6", y: 230 },
  tools: { label: "Tool Execution", color: "#ef4444", y: 290 },
  subagent: { label: "Multi-Agent", color: "#8b5cf6", y: 230 },
  maintenance: { label: "Maintenance", color: "#f43f5e", y: 460 },
};

function Node({ event, isSelected, isHighlighted, onClick }) {
  const size = event.canBlock ? 18 : 14;
  return (
    <g onClick={() => onClick(event.id)} style={{ cursor: "pointer" }}>
      {isHighlighted && (
        <circle cx={event.x} cy={event.y} r={size + 8} fill="none" stroke={event.color} strokeWidth={1} opacity={0.3}>
          <animate attributeName="r" values={`${size + 6};${size + 12};${size + 6}`} dur="2s" repeatCount="indefinite" />
        </circle>
      )}
      <circle cx={event.x} cy={event.y} r={size} fill={isSelected ? event.color : `${event.color}22`}
        stroke={event.color} strokeWidth={isSelected ? 2.5 : 1.5}
        style={{ transition: "all 0.3s" }} />
      {event.canBlock && (
        <circle cx={event.x} cy={event.y} r={size + 3} fill="none" stroke={event.color} strokeWidth={0.5}
          strokeDasharray="3 3" opacity={0.5} />
      )}
      <text x={event.x} y={event.y + size + 14} textAnchor="middle" fill={isSelected ? "#f1f5f9" : "#94a3b8"}
        fontSize={9} fontFamily="'IBM Plex Mono', monospace" fontWeight={isSelected ? 600 : 400}
        style={{ transition: "all 0.3s" }}>
        {event.name}
      </text>
    </g>
  );
}

function Connection({ from, to, label, style: connStyle, isHighlighted }) {
  const fromNode = HOOK_EVENTS.find(e => e.id === from);
  const toNode = HOOK_EVENTS.find(e => e.id === to);
  if (!fromNode || !toNode) return null;

  const dx = toNode.x - fromNode.x;
  const dy = toNode.y - fromNode.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const offset = 20;
  const x1 = fromNode.x + (dx / dist) * offset;
  const y1 = fromNode.y + (dy / dist) * offset;
  const x2 = toNode.x - (dx / dist) * offset;
  const y2 = toNode.y - (dy / dist) * offset;

  const color = connStyle === "error" ? "#dc2626" : connStyle === "loop" ? "#06b6d4" : connStyle === "success" ? "#22c55e" : "#334155";
  const opacity = isHighlighted ? 0.8 : 0.2;
  const dasharray = connStyle === "loop" ? "4 4" : connStyle === "error" ? "2 3" : "none";

  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={isHighlighted ? 1.5 : 0.8}
        strokeDasharray={dasharray} opacity={opacity} markerEnd="url(#arrow)" style={{ transition: "all 0.3s" }} />
    </g>
  );
}

export default function HooksGraph() {
  const [selected, setSelected] = useState(null);
  const [view, setView] = useState("hooks"); // hooks | skills | handlers

  const selectedEvent = useMemo(() => HOOK_EVENTS.find(e => e.id === selected), [selected]);

  const connectedIds = useMemo(() => {
    if (!selected) return new Set();
    const ids = new Set([selected]);
    CONNECTIONS.forEach(c => {
      if (c.from === selected) ids.add(c.to);
      if (c.to === selected) ids.add(c.from);
    });
    return ids;
  }, [selected]);

  const connectedSkills = useMemo(() => {
    if (!selected) return [];
    return SKILLS.filter(s => s.hooks.includes(selected));
  }, [selected]);

  return (
    <div style={{ minHeight: "100vh", background: "#060a12", fontFamily: "'IBM Plex Mono', 'Fira Code', monospace", color: "#cbd5e1" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600;700&family=Syne:wght@400;500;600;700;800&display=swap');
        * { box-sizing: border-box; margin: 0; }
        ::selection { background: #ef4444; color: #000; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 2px; }
        @keyframes scan { from { transform: translateY(-100%); } to { transform: translateY(100vh); } }
      `}</style>

      {/* Scanline overlay */}
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, pointerEvents: "none", zIndex: 0, overflow: "hidden" }}>
        <div style={{ width: "100%", height: 2, background: "linear-gradient(90deg, transparent, rgba(34,197,94,0.03), transparent)", animation: "scan 8s linear infinite" }} />
      </div>

      {/* Header */}
      <header style={{ padding: "20px 32px", borderBottom: "1px solid #0f1a2b", position: "relative", zIndex: 1, background: "linear-gradient(180deg, #0a1020 0%, #060a12 100%)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: 20, fontWeight: 800, color: "#f1f5f9", letterSpacing: -0.5 }}>
              Claude Code Architecture
            </h1>
            <div style={{ fontSize: 10, color: "#475569", letterSpacing: 1.5, marginTop: 2 }}>
              HOOKS · SKILLS · LIFECYCLE · HANDLERS — INTERACTIVE REFERENCE
            </div>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            {[
              { key: "hooks", label: "Hooks Lifecycle" },
              { key: "skills", label: "Skills & Config" },
              { key: "handlers", label: "Handler Types" },
            ].map(tab => (
              <button key={tab.key} onClick={() => { setView(tab.key); setSelected(null); }} style={{
                background: view === tab.key ? "#1e293b" : "transparent",
                border: `1px solid ${view === tab.key ? "#334155" : "transparent"}`,
                borderRadius: 4, padding: "4px 12px", fontSize: 10,
                color: view === tab.key ? "#f1f5f9" : "#64748b",
                cursor: "pointer", fontFamily: "inherit",
              }}>
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", minHeight: "calc(100vh - 70px)", position: "relative", zIndex: 1 }}>
        {/* Graph Area */}
        <div style={{ padding: 16 }}>
          {view === "hooks" && (
            <svg viewBox="0 0 820 610" style={{ width: "100%", height: "auto", maxHeight: "calc(100vh - 100px)" }}>
              <defs>
                <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#334155" />
                </marker>
                <filter id="glow">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              </defs>

              {/* Phase backgrounds */}
              {Object.entries(PHASES).map(([key, phase]) => {
                const events = HOOK_EVENTS.filter(e => e.phase === key);
                if (!events.length) return null;
                const minX = Math.min(...events.map(e => e.x)) - 40;
                const minY = Math.min(...events.map(e => e.y)) - 30;
                const maxX = Math.max(...events.map(e => e.x)) + 40;
                const maxY = Math.max(...events.map(e => e.y)) + 40;
                return (
                  <g key={key}>
                    <rect x={minX} y={minY} width={maxX - minX} height={maxY - minY} rx={8}
                      fill={`${phase.color}06`} stroke={`${phase.color}15`} strokeWidth={0.5} />
                    <text x={minX + 6} y={minY + 12} fill={`${phase.color}44`} fontSize={8} fontWeight={600} letterSpacing={1.5}>
                      {phase.label.toUpperCase()}
                    </text>
                  </g>
                );
              })}

              {/* Connections */}
              {CONNECTIONS.map((c, i) => (
                <Connection key={i} {...c} isHighlighted={!selected || connectedIds.has(c.from) && connectedIds.has(c.to)} />
              ))}

              {/* Nodes */}
              {HOOK_EVENTS.map(event => (
                <Node key={event.id} event={event} isSelected={selected === event.id}
                  isHighlighted={!selected || connectedIds.has(event.id)} onClick={setSelected} />
              ))}
            </svg>
          )}

          {view === "skills" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, padding: 8 }}>
              {SKILLS.map(skill => (
                <button key={skill.id} onClick={() => setSelected(selected === skill.id ? null : skill.id)} style={{
                  background: selected === skill.id ? `${skill.color}15` : "#0a0f1a",
                  border: `1px solid ${selected === skill.id ? skill.color : "#1e293b"}`,
                  borderLeft: `3px solid ${skill.color}`,
                  borderRadius: 8, padding: 16, textAlign: "left", cursor: "pointer",
                  transition: "all 0.2s",
                }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: skill.color, marginBottom: 4 }}>{skill.name}</div>
                  <div style={{ fontSize: 10, color: "#64748b", lineHeight: 1.5 }}>{skill.desc}</div>
                  <div style={{ marginTop: 8, display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {skill.hooks.map(h => (
                      <span key={h} style={{ fontSize: 9, padding: "1px 6px", borderRadius: 3, background: `${skill.color}15`, color: skill.color }}>
                        {h}
                      </span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          )}

          {view === "handlers" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16, padding: 16 }}>
              {HANDLER_TYPES.map(h => (
                <div key={h.name} style={{
                  background: "#0a0f1a", border: `1px solid ${h.color}22`, borderRadius: 10, padding: 20,
                }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>{h.icon}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: h.color, fontFamily: "'Syne', sans-serif" }}>{h.name}</div>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6, lineHeight: 1.6 }}>{h.desc}</div>
                  <div style={{ marginTop: 12, fontSize: 10, color: "#475569" }}>
                    Supported by: {HOOK_EVENTS.filter(e => e.handlers.includes(h.name)).map(e => e.name).join(", ")}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Detail Panel */}
        <div style={{ borderLeft: "1px solid #0f1a2b", padding: 20, background: "#080d17", overflow: "auto" }}>
          {view === "hooks" && selectedEvent ? (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <div style={{ width: 12, height: 12, borderRadius: "50%", background: selectedEvent.color, boxShadow: `0 0 10px ${selectedEvent.color}44` }} />
                <div style={{ fontSize: 14, fontWeight: 700, color: "#f1f5f9", fontFamily: "'Syne', sans-serif" }}>{selectedEvent.name}</div>
              </div>
              <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.7, marginBottom: 16 }}>{selectedEvent.desc}</div>

              {selectedEvent.canBlock && (
                <div style={{ padding: 8, borderRadius: 6, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)", marginBottom: 12, fontSize: 10, color: "#fca5a5" }}>
                  CAN BLOCK — Exit code 2 denies the action
                </div>
              )}

              <div style={{ fontSize: 10, color: "#475569", letterSpacing: 1, marginBottom: 6, fontWeight: 600 }}>HANDLER TYPES</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 14 }}>
                {selectedEvent.handlers.map(h => {
                  const ht = HANDLER_TYPES.find(t => t.name === h);
                  return (
                    <span key={h} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: `${ht?.color ?? "#334155"}15`, color: ht?.color ?? "#94a3b8" }}>
                      {ht?.icon} {h}
                    </span>
                  );
                })}
              </div>

              {selectedEvent.matcher && (
                <>
                  <div style={{ fontSize: 10, color: "#475569", letterSpacing: 1, marginBottom: 4, fontWeight: 600 }}>MATCHER VALUES</div>
                  <div style={{ fontSize: 11, color: "#f59e0b", padding: "4px 8px", background: "rgba(245,158,11,0.06)", borderRadius: 4, marginBottom: 14, fontFamily: "inherit" }}>
                    {selectedEvent.matcher}
                  </div>
                </>
              )}

              <div style={{ fontSize: 10, color: "#475569", letterSpacing: 1, marginBottom: 4, fontWeight: 600 }}>EXAMPLE USE</div>
              <div style={{ fontSize: 11, color: "#a7f3d0", padding: 10, background: "rgba(16,185,129,0.06)", borderRadius: 6, lineHeight: 1.6, border: "1px solid rgba(16,185,129,0.1)" }}>
                {selectedEvent.example}
              </div>

              {connectedSkills.length > 0 && (
                <>
                  <div style={{ fontSize: 10, color: "#475569", letterSpacing: 1, marginTop: 14, marginBottom: 6, fontWeight: 600 }}>CONNECTED SKILLS</div>
                  {connectedSkills.map(s => (
                    <div key={s.id} style={{ fontSize: 11, color: s.color, marginBottom: 4 }}>
                      {s.name} <span style={{ color: "#475569" }}>— {s.type}</span>
                    </div>
                  ))}
                </>
              )}

              <div style={{ fontSize: 10, color: "#475569", letterSpacing: 1, marginTop: 14, marginBottom: 4, fontWeight: 600 }}>PHASE</div>
              <div style={{ fontSize: 11, color: PHASES[selectedEvent.phase]?.color }}>{PHASES[selectedEvent.phase]?.label}</div>
            </div>
          ) : view === "hooks" ? (
            <div style={{ textAlign: "center", paddingTop: 40, color: "#1e293b" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>◉</div>
              <div style={{ fontSize: 11, color: "#334155" }}>Click a node to inspect</div>
              <div style={{ fontSize: 10, color: "#1e293b", marginTop: 4 }}>Dashed border = can block</div>
              <div style={{ marginTop: 32, textAlign: "left" }}>
                <div style={{ fontSize: 10, color: "#334155", letterSpacing: 1, marginBottom: 8, fontWeight: 600 }}>LEGEND</div>
                {Object.entries(PHASES).map(([key, phase]) => (
                  <div key={key} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: phase.color }} />
                    <span style={{ fontSize: 10, color: "#475569" }}>{phase.label}</span>
                  </div>
                ))}
                <div style={{ marginTop: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <div style={{ width: 16, height: 1, background: "#22c55e" }} />
                    <span style={{ fontSize: 10, color: "#475569" }}>Success flow</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <div style={{ width: 16, height: 0, borderTop: "1px dashed #06b6d4" }} />
                    <span style={{ fontSize: 10, color: "#475569" }}>Loop / retry</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <div style={{ width: 16, height: 0, borderTop: "1px dotted #dc2626" }} />
                    <span style={{ fontSize: 10, color: "#475569" }}>Error path</span>
                  </div>
                </div>
                <div style={{ marginTop: 16, fontSize: 10, color: "#1e293b" }}>
                  {HOOK_EVENTS.length} events · {SKILLS.length} skill types · {HANDLER_TYPES.length} handler types
                </div>
              </div>
            </div>
          ) : view === "skills" && selected ? (
            <div>
              {(() => {
                const skill = SKILLS.find(s => s.id === selected);
                if (!skill) return null;
                return (
                  <>
                    <div style={{ fontSize: 14, fontWeight: 700, color: skill.color, fontFamily: "'Syne', sans-serif", marginBottom: 8 }}>{skill.name}</div>
                    <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.7, marginBottom: 16 }}>{skill.desc}</div>
                    <div style={{ fontSize: 10, color: "#475569", letterSpacing: 1, marginBottom: 6, fontWeight: 600 }}>TYPE</div>
                    <div style={{ fontSize: 12, color: "#f1f5f9", marginBottom: 14 }}>{skill.type}</div>
                    <div style={{ fontSize: 10, color: "#475569", letterSpacing: 1, marginBottom: 6, fontWeight: 600 }}>LIFECYCLE HOOKS</div>
                    {skill.hooks.map(h => {
                      const evt = HOOK_EVENTS.find(e => e.id === h);
                      return (
                        <div key={h} style={{ fontSize: 11, color: evt?.color ?? "#94a3b8", marginBottom: 4, paddingLeft: 8, borderLeft: `2px solid ${evt?.color ?? "#334155"}33` }}>
                          {evt?.name ?? h} <span style={{ color: "#475569", fontSize: 10 }}>— {evt?.desc?.slice(0, 60)}...</span>
                        </div>
                      );
                    })}
                  </>
                );
              })()}
            </div>
          ) : (
            <div style={{ textAlign: "center", paddingTop: 40, color: "#1e293b" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>◉</div>
              <div style={{ fontSize: 11, color: "#334155" }}>Select an item to inspect</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
