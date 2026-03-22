import { useState, useEffect, useRef, useMemo } from "react";

const TYPES = {
  product:  { color: "#06d6a0", bg: "#06d6a015", icon: "◆", label: "Product"  },
  decision: { color: "#ffd166", bg: "#ffd16612", icon: "▲", label: "Decision" },
  research: { color: "#118ab2", bg: "#118ab212", icon: "◈", label: "Research" },
  error:    { color: "#ef476f", bg: "#ef476f12", icon: "●", label: "Bug Fix"  },
  concept:  { color: "#f78c6b", bg: "#f78c6b12", icon: "◎", label: "Concept"  },
  tool:     { color: "#83c5be", bg: "#83c5be12", icon: "⬡", label: "Tool"     },
  person:   { color: "#b5838d", bg: "#b5838d12", icon: "◉", label: "Person"   },
  metric:   { color: "#a7c957", bg: "#a7c95712", icon: "▣", label: "Metric"   },
};

const NODES = [
  { id: "cs-py",       name: "ContextScore Python",        type: "product",  w: 9,  phase: 1, detail: "7 analyzers, 28 IssueCauses, HTTP API, React dashboard. 71 tests." },
  { id: "cs-cc",       name: "ContextScore Claude Code",   type: "product",  w: 8,  phase: 2, detail: "TypeScript port, Smart Compaction Guard, snapshot/recovery. 41 tests." },
  { id: "openbrain",   name: "OpenBrain",                  type: "product",  w: 9,  phase: 3, detail: "L1→L4 pipeline. MCP server (8 tools). CLI (6 commands). 27 tests." },
  { id: "cortex",      name: "Cortex",                     type: "product",  w: 10, phase: 4, detail: "Knowledge graph engine, hook processor, Context Hub integration. 48 tests." },
  { id: "specflow",    name: "SpecFlow Demo",              type: "product",  w: 6,  phase: 3, detail: "Interactive React app showing AI Skill Hierarchy transformations." },
  { id: "hooks-graph", name: "Hooks Architecture",         type: "product",  w: 7,  phase: 4, detail: "Interactive Claude Code lifecycle visualization. 16 events, 8 skills." },
  { id: "analysis",    name: "Competitive Analysis",       type: "product",  w: 6,  phase: 1, detail: "Market map, 3 ghost segments, pricing tiers, Sequoia positioning." },
  { id: "review",      name: "Deep Code Review",           type: "product",  w: 7,  phase: 4, detail: "Multi-specialist review: 3 critical, 5 important, 4 suggestions. All fixed." },
  { id: "d-autopilot", name: "Sell work, not tools",       type: "decision", w: 9,  phase: 1, detail: "Sequoia thesis: autopilot captures $6 services budget per $1 software." },
  { id: "d-coherence", name: "Coherence > capacity",       type: "decision", w: 9,  phase: 1, detail: "Core insight: 10M token window with bad context = expensive noise." },
  { id: "d-hooks-sh",  name: "Hooks = shell scripts",      type: "decision", w: 8,  phase: 2, detail: "Plan review caught: Claude Code hooks are NOT importable modules." },
  { id: "d-graph",     name: "Graph > event log",          type: "decision", w: 8,  phase: 4, detail: "Cortex niche: knowledge graph with typed edges, not flat event streams." },
  { id: "d-chub",      name: "Integrate Context Hub",      type: "decision", w: 7,  phase: 5, detail: "Ng's chub = external docs. Cortex = internal quality. Complementary." },
  { id: "d-regex",     name: "No lazy quantifiers",        type: "decision", w: 6,  phase: 4, detail: "C3 fix: [^.\\n]{10,120} instead of .{10,120}? for O(1) matching." },
  { id: "r-talisman",  name: "Talisman: Context Problem",  type: "research", w: 7,  phase: 1, detail: "Context as credence good. Context rot. 80% token reduction via graphs." },
  { id: "r-sequoia",   name: "Sequoia: Services as SW",    type: "research", w: 8,  phase: 1, detail: "Julien Bek. Intelligence vs judgement. Outsourced wedge → insourced TAM." },
  { id: "r-jones",     name: "Nate Jones: Open Brain",     type: "research", w: 7,  phase: 3, detail: "Memory bottleneck. MCP = USB-C of AI. Agent-readable context." },
  { id: "r-ng",        name: "Andrew Ng: Context Hub",     type: "research", w: 7,  phase: 5, detail: "chub CLI. Curated versioned docs. Agent annotations. 11K GitHub stars." },
  { id: "r-reddit",    name: "Claude Code Pain Points",    type: "research", w: 7,  phase: 2, detail: "500+ Reddit comments. #1 pain: 'dumber after compaction.'" },
  { id: "e-score",     name: "Score always 100",           type: "error",    w: 5,  phase: 4, detail: "C2: Quality formula saturated. Fixed: normalized spread (47 for brief)." },
  { id: "e-regex",     name: "Regex backtracking",         type: "error",    w: 5,  phase: 4, detail: "C3: Lazy quantifiers O(n²) without periods. Character class fix." },
  { id: "e-stdin",     name: "Silent file fallback",       type: "error",    w: 4,  phase: 4, detail: "I5: CLI treated filenames as text. existsSync gate added." },
  { id: "e-dedup",     name: "Duplicate decisions",        type: "error",    w: 4,  phase: 4, detail: "I4: Prefix dedup missed variants. Substring containment fix." },
  { id: "c-ccs",       name: "Coherence Score",            type: "concept",  w: 8,  phase: 1, detail: "Weighted 0-100 across 7 dimensions. Letter grades A+ to F." },
  { id: "c-compact",   name: "Compaction Guard",           type: "concept",  w: 8,  phase: 2, detail: "Snapshot before compaction. Auto-inject recovery after." },
  { id: "c-hierarchy", name: "AI Skill Hierarchy",         type: "concept",  w: 7,  phase: 3, detail: "L1 Prompt → L2 Context → L3 Intent → L4 Specification." },
  { id: "c-mcp",       name: "MCP Protocol",               type: "concept",  w: 6,  phase: 3, detail: "Universal agent protocol. Multiple AIs share one brain." },
  { id: "t-vitest",    name: "Vitest",                     type: "tool",     w: 4,  phase: 2, detail: "TypeScript test runner. 116 TS tests total." },
  { id: "t-pytest",    name: "Pytest",                     type: "tool",     w: 4,  phase: 1, detail: "71 Python tests for ContextScore MVP." },
  { id: "p-talisman",  name: "Jessica Talisman",           type: "person",   w: 3,  phase: 1, detail: "Information architect. Context Problem author." },
  { id: "p-jones",     name: "Nate B. Jones",              type: "person",   w: 3,  phase: 3, detail: "AI thought leader. Open Brain creator." },
  { id: "p-ng",        name: "Andrew Ng",                  type: "person",   w: 3,  phase: 5, detail: "DeepLearning.AI founder. Context Hub." },
  { id: "p-bek",       name: "Julien Bek",                 type: "person",   w: 3,  phase: 1, detail: "Sequoia partner. Services thesis." },
  { id: "m-tests",     name: "187 Tests Pass",             type: "metric",   w: 5,  phase: 5, detail: "71 + 41 + 27 + 48 = 187 total tests. All green." },
  { id: "m-files",     name: "119 Files Shipped",          type: "metric",   w: 4,  phase: 5, detail: "Across 4 repos in complete deliverable." },
];

const EDGES = [
  { s:"cs-py",t:"cs-cc",label:"ported to",w:.9 },{ s:"cs-cc",t:"cortex",label:"evolved into",w:.8 },
  { s:"openbrain",t:"cortex",label:"pipeline feeds",w:.7 },{ s:"cortex",t:"r-ng",label:"integrates",w:.8 },
  { s:"specflow",t:"openbrain",label:"visualizes",w:.5 },{ s:"analysis",t:"cs-py",label:"defined niche",w:.5 },
  { s:"review",t:"cortex",label:"hardened",w:.6 },{ s:"review",t:"openbrain",label:"hardened",w:.6 },
  { s:"r-talisman",t:"d-coherence",label:"inspired",w:.9 },{ s:"r-sequoia",t:"d-autopilot",label:"defined",w:.9 },
  { s:"r-jones",t:"c-hierarchy",label:"created",w:.8 },{ s:"r-ng",t:"d-chub",label:"motivated",w:.7 },
  { s:"r-reddit",t:"c-compact",label:"validated",w:.8 },{ s:"r-reddit",t:"d-hooks-sh",label:"informed",w:.6 },
  { s:"d-coherence",t:"cs-py",label:"drove",w:.8 },{ s:"d-autopilot",t:"openbrain",label:"positioned",w:.8 },
  { s:"d-hooks-sh",t:"cs-cc",label:"reshaped",w:.9 },{ s:"d-graph",t:"cortex",label:"defined",w:.9 },
  { s:"d-chub",t:"cortex",label:"enriched",w:.7 },{ s:"d-regex",t:"openbrain",label:"fixed",w:.6 },
  { s:"c-ccs",t:"cs-py",label:"core metric",w:.9 },{ s:"c-compact",t:"cs-cc",label:"core feature",w:.9 },
  { s:"c-hierarchy",t:"openbrain",label:"structured",w:.8 },{ s:"c-mcp",t:"openbrain",label:"protocol",w:.7 },
  { s:"e-score",t:"openbrain",label:"C2",w:.5 },{ s:"e-regex",t:"openbrain",label:"C3",w:.5 },
  { s:"e-stdin",t:"openbrain",label:"I5",w:.4 },{ s:"e-dedup",t:"openbrain",label:"I4",w:.4 },
  { s:"p-talisman",t:"r-talisman",label:"authored",w:.6 },{ s:"p-jones",t:"r-jones",label:"authored",w:.6 },
  { s:"p-ng",t:"r-ng",label:"created",w:.6 },{ s:"p-bek",t:"r-sequoia",label:"authored",w:.6 },
  { s:"t-vitest",t:"cs-cc",label:"41 tests",w:.4 },{ s:"t-vitest",t:"openbrain",label:"27 tests",w:.4 },
  { s:"t-vitest",t:"cortex",label:"48 tests",w:.4 },{ s:"t-pytest",t:"cs-py",label:"71 tests",w:.4 },
  { s:"m-tests",t:"cortex",label:"verified",w:.3 },{ s:"m-files",t:"cortex",label:"shipped",w:.3 },
];

const PHASES = [
  { id:1, name:"Research & Python MVP", emoji:"🔬" },
  { id:2, name:"Claude Code Plugin",    emoji:"🔌" },
  { id:3, name:"OpenBrain & SpecFlow",  emoji:"🧠" },
  { id:4, name:"Cortex & Code Review",  emoji:"⚡" },
  { id:5, name:"Context Hub Integration", emoji:"🔗" },
];

const RECS = [
  { type:"critical", title:"4 decisions unanchored",   desc:"Persist to CLAUDE.md before compaction kills them.", icon:"🔴" },
  { type:"optimize", title:"Stale reads detected",     desc:"4 files read but never modified — wasting context budget.", icon:"🟡" },
  { type:"suggest",  title:"Context Hub available",     desc:"Run chub get for API docs before writing integrations.", icon:"🔵" },
  { type:"suggest",  title:"Subagent candidate",        desc:"7-file cluster could free ~800 tokens from main context.", icon:"🔵" },
];

const CC = { product:{x:.48,y:.3}, decision:{x:.22,y:.52}, research:{x:.13,y:.28}, error:{x:.78,y:.58},
  concept:{x:.5,y:.68}, tool:{x:.85,y:.28}, person:{x:.1,y:.72}, metric:{x:.88,y:.7} };

function useSim(ns,es,W,H) {
  const pos=useRef(new Map()),vel=useRef(new Map()),[,set]=useState(0);
  useEffect(()=>{ns.forEach(n=>{if(!pos.current.has(n.id)){const c=CC[n.type]||{x:.5,y:.5};
    pos.current.set(n.id,{x:c.x*W+(Math.random()-.5)*110,y:c.y*H+(Math.random()-.5)*70});
    vel.current.set(n.id,{vx:0,vy:0})}});},[ns,W,H]);
  useEffect(()=>{let raf,f=0;const step=()=>{const a=Math.max(.002,.4*Math.pow(.985,f));
    for(let i=0;i<ns.length;i++)for(let j=i+1;j<ns.length;j++){const pa=pos.current.get(ns[i].id),pb=pos.current.get(ns[j].id);
      if(!pa||!pb)continue;const dx=pb.x-pa.x,dy=pb.y-pa.y,d=Math.max(5,Math.sqrt(dx*dx+dy*dy)),
      ff=-550/(d*d)*a,fx=(dx/d)*ff,fy=(dy/d)*ff,va=vel.current.get(ns[i].id),vb=vel.current.get(ns[j].id);
      if(va){va.vx-=fx;va.vy-=fy}if(vb){vb.vx+=fx;vb.vy+=fy}}
    es.forEach(e=>{const pa=pos.current.get(e.s),pb=pos.current.get(e.t);if(!pa||!pb)return;
      const dx=pb.x-pa.x,dy=pb.y-pa.y,d=Math.max(1,Math.sqrt(dx*dx+dy*dy)),tgt=85+(1-e.w)*55,
      ff=(d-tgt)*.008*a,fx=(dx/d)*ff,fy=(dy/d)*ff,va=vel.current.get(e.s),vb=vel.current.get(e.t);
      if(va){va.vx+=fx;va.vy+=fy}if(vb){vb.vx-=fx;vb.vy-=fy}});
    ns.forEach(n=>{const p=pos.current.get(n.id),v=vel.current.get(n.id);if(!p||!v)return;
      const c=CC[n.type]||{x:.5,y:.5};v.vx+=(c.x*W-p.x)*.003*a;v.vy+=(c.y*H-p.y)*.003*a;
      v.vx*=.55;v.vy*=.55;p.x=Math.max(35,Math.min(W-35,p.x+v.vx));p.y=Math.max(25,Math.min(H-25,p.y+v.vy))});
    f++;set(t=>t+1);raf=requestAnimationFrame(step)};raf=requestAnimationFrame(step);
    return()=>cancelAnimationFrame(raf)},[ns,es,W,H]);
  return pos.current;
}

export default function CortexInsights() {
  const W=860,H=520;
  const [sel,setSel]=useState(null),[hov,setHov]=useState(null),
    [tf,setTf]=useState(null),[view,setView]=useState("graph");
  const positions=useSim(NODES,EDGES,W,H);
  const vis=useMemo(()=>{let ns=NODES;if(tf)ns=ns.filter(n=>n.type===tf);return new Set(ns.map(n=>n.id))},[tf]);
  const selN=NODES.find(n=>n.id===sel);
  const conn=useMemo(()=>{if(!sel)return new Set();const s=new Set([sel]);
    EDGES.forEach(e=>{if(e.s===sel)s.add(e.t);if(e.t===sel)s.add(e.s)});return s},[sel]);
  const deg=useMemo(()=>{const c={};EDGES.forEach(e=>{c[e.s]=(c[e.s]||0)+1;c[e.t]=(c[e.t]||0)+1});return c},[]);
  const gp=id=>positions.get(id)||{x:W/2,y:H/2};

  return(
  <div style={{minHeight:"100vh",background:"#05070e",fontFamily:"'DM Mono','Fira Code',monospace",color:"#b0bec5"}}>
    <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Outfit:wght@300;400;500;600;700;800&display=swap');
      *{box-sizing:border-box;margin:0}::selection{background:#06d6a0;color:#000}
      @keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
      .hr:hover{background:rgba(255,255,255,0.03)!important}`}</style>

    {/* Header */}
    <div style={{padding:"12px 20px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:"1px solid #111827"}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <div style={{width:28,height:28,borderRadius:6,background:"linear-gradient(135deg,#06d6a0,#118ab2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,color:"#000"}}>C</div>
        <div><span style={{fontFamily:"'Outfit',sans-serif",fontWeight:700,fontSize:14,color:"#e2e8f0",letterSpacing:-.3}}>CORTEX</span>
        <span style={{fontSize:9,color:"#475569",marginLeft:8,letterSpacing:1.5}}>SESSION KNOWLEDGE GRAPH</span></div>
      </div>
      <div style={{display:"flex",gap:2,background:"#0d1117",borderRadius:6,padding:2,border:"1px solid #1e293b"}}>
        {[{k:"graph",l:"Graph"},{k:"timeline",l:"Timeline"},{k:"recs",l:"Insights"}].map(v=>
          <button key={v.k} onClick={()=>{setView(v.k);setSel(null)}} style={{
            background:view===v.k?"#1e293b":"transparent",border:"none",borderRadius:4,
            padding:"4px 14px",fontSize:10,color:view===v.k?"#f1f5f9":"#64748b",
            cursor:"pointer",fontFamily:"inherit",fontWeight:view===v.k?500:300}}>{v.l}</button>)}
      </div>
    </div>

    {/* Stats */}
    <div style={{padding:"8px 20px",display:"flex",gap:16,borderBottom:"1px solid #0d1117",background:"#080c16"}}>
      {[{v:73,l:"Quality",c:"#06d6a0",s:"/100"},{v:"187",l:"Tests",c:"#06d6a0",s:" pass"},
        {v:"119",l:"Files",c:"#118ab2",s:" shipped"},{v:NODES.length,l:"Nodes",c:"#83c5be",s:""},
        {v:EDGES.length,l:"Edges",c:"#b5838d",s:""},{v:"4",l:"Products",c:"#06d6a0",s:" core"},
        {v:"3/3",l:"Critical",c:"#ef476f",s:" fixed"}].map((s,i)=>
        <div key={i} style={{textAlign:"center"}}>
          <div style={{fontSize:13,fontWeight:500,color:s.c,fontFamily:"'Outfit',sans-serif"}}>{s.v}<span style={{fontSize:9,color:"#475569"}}>{s.s}</span></div>
          <div style={{fontSize:8,color:"#334155",letterSpacing:1}}>{s.l.toUpperCase()}</div>
        </div>)}
    </div>

    <div style={{display:"grid",gridTemplateColumns:"1fr 280px",height:"calc(100vh - 88px)"}}>
      <div style={{position:"relative",overflow:"hidden"}}>

        {view==="graph"&&<>
          {/* Filters */}
          <div style={{position:"absolute",top:8,left:8,display:"flex",gap:3,zIndex:2,flexWrap:"wrap"}}>
            <button onClick={()=>setTf(null)} style={{background:!tf?"#1e293b":"#0d1117",border:"1px solid #1e293b",
              borderRadius:4,padding:"2px 8px",fontSize:8,color:!tf?"#e2e8f0":"#475569",cursor:"pointer",fontFamily:"inherit"}}>All {NODES.length}</button>
            {Object.entries(TYPES).map(([k,v])=>{const c=NODES.filter(n=>n.type===k).length;return(
              <button key={k} onClick={()=>setTf(tf===k?null:k)} style={{background:tf===k?v.bg:"#0d1117",
                border:`1px solid ${tf===k?v.color+"44":"#1e293b"}`,borderRadius:4,padding:"2px 8px",fontSize:8,
                color:tf===k?v.color:"#475569",cursor:"pointer",fontFamily:"inherit"}}>{v.icon} {c}</button>)})}
          </div>

          <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} style={{background:"radial-gradient(ellipse at 35% 35%,#0a0f20,#05070e 70%)"}}>
            <defs><filter id="gl"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
            {Array.from({length:18}).map((_,i)=><line key={`x${i}`} x1={i*W/18} y1={0} x2={i*W/18} y2={H} stroke="#0a1020" strokeWidth={.3}/>)}
            {Array.from({length:12}).map((_,i)=><line key={`y${i}`} x1={0} y1={i*H/12} x2={W} y2={i*H/12} stroke="#0a1020" strokeWidth={.3}/>)}

            {/* Cluster labels */}
            {Object.entries(CC).map(([type,cc])=>{if(tf&&tf!==type)return null;const cfg=TYPES[type];return(
              <text key={type} x={cc.x*W} y={cc.y*H-42} textAnchor="middle" fill={cfg.color} opacity={.1}
                fontSize={10} fontFamily="'Outfit',sans-serif" fontWeight={600} letterSpacing={2}>{cfg.label.toUpperCase()}</text>)})}

            {/* Edges */}
            {EDGES.filter(e=>vis.has(e.s)&&vis.has(e.t)).map((e,i)=>{const a=gp(e.s),b=gp(e.t);
              const mx=(a.x+b.x)/2,my=(a.y+b.y)/2,dx=b.x-a.x,dy=b.y-a.y,
                d=Math.max(1,Math.sqrt(dx*dx+dy*dy)),off=14*(i%2===0?1:-1),
                cx=mx-(dy/d)*off,cy=my+(dx/d)*off;
              const act=!sel||(conn.has(e.s)&&conn.has(e.t));
              const isH=hov&&(e.s===hov||e.t===hov);
              const col=TYPES[NODES.find(n=>n.id===e.s)?.type||"concept"]?.color||"#334155";
              return(<g key={i}><path d={`M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}`}
                fill="none" stroke={col} strokeWidth={act?e.w*1.3:.2} opacity={act?(isH?.5:.2):.04}
                style={{transition:"opacity .3s"}}/>
                {isH&&<text x={cx} y={cy-4} textAnchor="middle" fill={col} fontSize={7} opacity={.7}
                  fontFamily="'DM Mono',monospace">{e.label}</text>}</g>)})}

            {/* Nodes */}
            {NODES.filter(n=>vis.has(n.id)).map(n=>{const p=gp(n.id),cfg=TYPES[n.type],
              act=!sel||conn.has(n.id),isSel=sel===n.id,isH=hov===n.id,r=3+n.w*1.8;
              return(<g key={n.id} onClick={()=>setSel(isSel?null:n.id)} onMouseEnter={()=>setHov(n.id)} onMouseLeave={()=>setHov(null)} style={{cursor:"pointer"}}>
                {(isSel||isH)&&<circle cx={p.x} cy={p.y} r={r+10} fill="none" stroke={cfg.color} strokeWidth={.5} opacity={.3}>
                  <animate attributeName="r" values={`${r+8};${r+14};${r+8}`} dur="3s" repeatCount="indefinite"/></circle>}
                <circle cx={p.x} cy={p.y} r={r} fill={isSel?cfg.color:`${cfg.color}18`}
                  stroke={cfg.color} strokeWidth={isSel?2:isH?1.2:.6} opacity={act?1:.15}
                  filter={isSel?"url(#gl)":undefined} style={{transition:"all .3s"}}/>
                {(deg[n.id]||0)>3&&<circle cx={p.x} cy={p.y} r={r+3} fill="none" stroke={cfg.color} strokeWidth={.3} strokeDasharray="2 2" opacity={act?.3:0}/>}
                <text x={p.x} y={p.y+r+10} textAnchor="middle" fill={act?"#94a3b8":"#1e293b"}
                  fontSize={isH||isSel?8.5:7.5} fontFamily="'DM Mono',monospace" fontWeight={isSel?500:300}
                  style={{transition:"fill .3s",pointerEvents:"none"}}>{n.name.length>22?n.name.slice(0,20)+"…":n.name}</text>
              </g>)})}
          </svg>
        </>}

        {view==="timeline"&&<div style={{padding:20,overflow:"auto",height:"100%"}}>
          <div style={{fontSize:12,fontFamily:"'Outfit',sans-serif",fontWeight:600,color:"#e2e8f0",marginBottom:16}}>Build Timeline</div>
          {PHASES.map((ph,pi)=>{const pn=NODES.filter(n=>n.phase===ph.id);return(
            <div key={ph.id} style={{marginBottom:20,animation:`fadeUp .4s ease ${pi*.1}s both`}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                <div style={{width:28,height:28,borderRadius:6,background:"#0d1117",border:"1px solid #1e293b",
                  display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}>{ph.emoji}</div>
                <div><div style={{fontSize:11,fontWeight:500,color:"#e2e8f0",fontFamily:"'Outfit',sans-serif"}}>Phase {ph.id}: {ph.name}</div>
                  <div style={{fontSize:9,color:"#475569"}}>{pn.length} nodes</div></div>
              </div>
              <div style={{marginLeft:14,borderLeft:"1px solid #1e293b",paddingLeft:16}}>
                {pn.map(n=>{const cfg=TYPES[n.type];return(
                  <div key={n.id} className="hr" onClick={()=>{setView("graph");setSel(n.id);setTf(null)}}
                    style={{padding:"6px 8px",borderRadius:6,cursor:"pointer",marginBottom:2,display:"flex",alignItems:"center",gap:6}}>
                    <span style={{color:cfg.color,fontSize:9}}>{cfg.icon}</span>
                    <span style={{fontSize:10,color:"#94a3b8",flex:1}}>{n.name}</span>
                    <span style={{fontSize:8,color:cfg.color,opacity:.6}}>{cfg.label}</span>
                  </div>)})}
              </div></div>)})}
        </div>}

        {view==="recs"&&<div style={{padding:20,overflow:"auto",height:"100%"}}>
          <div style={{fontSize:12,fontFamily:"'Outfit',sans-serif",fontWeight:600,color:"#e2e8f0",marginBottom:4}}>Optimization Insights</div>
          <div style={{fontSize:9,color:"#475569",marginBottom:16}}>From Cortex recommendation engine — graph analysis of this session.</div>
          {/* Quality gauge */}
          <div style={{background:"#0d1117",borderRadius:10,padding:16,marginBottom:16,border:"1px solid #1e293b"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <span style={{fontSize:10,color:"#94a3b8"}}>Context Quality Score</span>
              <span style={{fontSize:18,fontFamily:"'Outfit',sans-serif",fontWeight:700,color:"#06d6a0"}}>73</span></div>
            <div style={{height:6,background:"#1e293b",borderRadius:3,overflow:"hidden"}}>
              <div style={{width:"73%",height:"100%",borderRadius:3,background:"linear-gradient(90deg,#ffd166,#06d6a0,#118ab2)"}}/></div>
            <div style={{display:"flex",justifyContent:"space-between",marginTop:4,fontSize:8,color:"#334155"}}>
              <span>0</span><span>Needs work</span><span>Good</span><span>Excellent</span><span>100</span></div>
          </div>
          {/* Token budget */}
          <div style={{background:"#0d1117",borderRadius:10,padding:16,marginBottom:16,border:"1px solid #1e293b"}}>
            <div style={{fontSize:10,color:"#94a3b8",marginBottom:8}}>Token Economics</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
              {[{l:"Consumed",v:"~142K",c:"#83c5be"},{l:"Useful",v:"~128K",c:"#06d6a0"},{l:"Wasted",v:"~14K",c:"#ef476f"}].map((t,i)=>
                <div key={i} style={{textAlign:"center"}}><div style={{fontSize:15,fontWeight:600,color:t.c,fontFamily:"'Outfit',sans-serif"}}>{t.v}</div>
                  <div style={{fontSize:8,color:"#475569"}}>{t.l}</div></div>)}</div>
            <div style={{marginTop:8,fontSize:9,color:"#475569"}}>Efficiency: <span style={{color:"#06d6a0"}}>90%</span> — above the 70% threshold.</div>
          </div>
          {RECS.map((r,i)=><div key={i} style={{background:"#0d1117",borderRadius:8,padding:12,marginBottom:8,border:"1px solid #1e293b",animation:`fadeUp .3s ease ${i*.08}s both`}}>
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
              <span style={{fontSize:10}}>{r.icon}</span><span style={{fontSize:10,fontWeight:500,color:"#e2e8f0"}}>{r.title}</span></div>
            <div style={{fontSize:9,color:"#64748b",lineHeight:1.5}}>{r.desc}</div></div>)}
        </div>}
      </div>

      {/* Detail panel */}
      <div style={{borderLeft:"1px solid #111827",padding:14,background:"#070b14",overflow:"auto"}}>
        {selN?<div style={{animation:"fadeUp .25s ease"}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:10}}>
            <div style={{width:8,height:8,borderRadius:"50%",background:TYPES[selN.type].color,boxShadow:`0 0 10px ${TYPES[selN.type].color}44`}}/>
            <div style={{fontSize:12,fontWeight:600,color:"#f1f5f9",fontFamily:"'Outfit',sans-serif"}}>{selN.name}</div></div>
          <div style={{fontSize:8,color:TYPES[selN.type].color,letterSpacing:1.5,marginBottom:8,textTransform:"uppercase"}}>
            {TYPES[selN.type].icon} {TYPES[selN.type].label} · PHASE {selN.phase} · WEIGHT {selN.w}/10</div>
          <div style={{fontSize:10,color:"#94a3b8",lineHeight:1.7,marginBottom:14}}>{selN.detail}</div>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:14}}>
            <div style={{flex:1,height:3,background:"#111827",borderRadius:2}}>
              <div style={{width:`${selN.w*10}%`,height:"100%",background:TYPES[selN.type].color,borderRadius:2}}/></div>
            <span style={{fontSize:9,color:TYPES[selN.type].color}}>{selN.w}/10</span></div>
          <div style={{fontSize:8,color:"#334155",letterSpacing:1,marginBottom:6,fontWeight:500}}>CONNECTIONS ({deg[sel]||0})</div>
          {EDGES.filter(e=>e.s===sel||e.t===sel).map((e,i)=>{const oid=e.s===sel?e.t:e.s,o=NODES.find(n=>n.id===oid);
            if(!o)return null;const cfg=TYPES[o.type],dir=e.s===sel?"→":"←";return(
              <div key={i} className="hr" onClick={()=>setSel(oid)} style={{padding:"5px 6px",marginBottom:2,borderRadius:4,cursor:"pointer",
                display:"flex",alignItems:"center",gap:5}}>
                <span style={{color:cfg.color,fontSize:8}}>{cfg.icon}</span>
                <span style={{fontSize:9,color:"#94a3b8",flex:1}}>{o.name}</span>
                <span style={{fontSize:7,color:"#334155"}}>{dir} {e.label}</span></div>)})}
        </div>
        :<div>
          <div style={{fontSize:10,fontFamily:"'Outfit',sans-serif",fontWeight:600,color:"#334155",marginBottom:12}}>SESSION MAP</div>
          <div style={{fontSize:9,color:"#475569",lineHeight:1.7,marginBottom:16}}>
            Everything from this conversation visualized as a knowledge graph. Click any node to drill in.</div>
          <div style={{fontSize:8,color:"#334155",letterSpacing:1,marginBottom:6,fontWeight:500}}>MOST CONNECTED</div>
          {Object.entries(deg).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([id,c])=>{const n=NODES.find(x=>x.id===id);
            if(!n)return null;const cfg=TYPES[n.type];return(
              <div key={id} className="hr" onClick={()=>setSel(id)} style={{padding:"5px 6px",marginBottom:2,borderRadius:4,cursor:"pointer",
                display:"flex",alignItems:"center",gap:5}}>
                <span style={{color:cfg.color,fontSize:8}}>{cfg.icon}</span>
                <span style={{fontSize:9,color:"#94a3b8",flex:1}}>{n.name}</span>
                <span style={{fontSize:9,color:cfg.color,fontWeight:500}}>{c}</span></div>)})}
          <div style={{fontSize:8,color:"#334155",letterSpacing:1,marginTop:14,marginBottom:6,fontWeight:500}}>BY TYPE</div>
          {Object.entries(TYPES).map(([k,v])=>{const c=NODES.filter(n=>n.type===k).length;return(
            <div key={k} onClick={()=>setTf(tf===k?null:k)} className="hr" style={{display:"flex",alignItems:"center",gap:5,marginBottom:2,padding:"3px 6px",borderRadius:4,cursor:"pointer"}}>
              <span style={{fontSize:8,color:v.color}}>{v.icon}</span>
              <span style={{fontSize:9,color:"#64748b",flex:1}}>{v.label}</span>
              <span style={{fontSize:9,color:v.color}}>{c}</span></div>)})}
          <div style={{marginTop:14,padding:10,borderRadius:6,background:"#06d6a008",border:"1px solid #06d6a015"}}>
            <div style={{fontSize:8,color:"#06d6a0",fontWeight:500,letterSpacing:1,marginBottom:3}}>QUALITY SCORE</div>
            <div style={{fontSize:18,fontFamily:"'Outfit',sans-serif",fontWeight:700,color:"#06d6a0"}}>73<span style={{fontSize:10,color:"#475569"}}>/100</span></div>
            <div style={{fontSize:8,color:"#475569",marginTop:2}}>3 critical bugs fixed. 187 tests passing.</div>
          </div>
        </div>}
      </div>
    </div>
  </div>);
}
