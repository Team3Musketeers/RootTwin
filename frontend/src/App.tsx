// RootTwin - production-line digital twin (3D) + Play mode. Viewport-first industrial HUD.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLive } from "./api";
import Play from "./Play";
import { CAMERA_PRESETS, cameraApi, TwinCanvas, type CameraPreset } from "./scene3d/TwinCanvas";
import type { ViewMode, ViewState } from "./scene3d/context";
import { FloorClient, type Action } from "./services/floor";
import { pushFault, useBackendSync } from "./services/productionBridge";
import { HAT, player } from "./scene3d/Worker";
import { MACHINE, MACHINES, ZONES, machineOfPart } from "./twin/registry";
import { TwinSim } from "./twin/sim";
import type { Fault } from "./twin/types";
import { Hierarchy } from "./ui/Hierarchy";
import { Btn, Segmented } from "./ui/common";
import { RightPanel, type Tab } from "./ui/RightPanel";


export default function App() {
  const [page, setPage] = useState<"twin" | "play">("twin");
  const simRef = useRef<TwinSim>(null as unknown as TwinSim);
  if (!simRef.current) simRef.current = new TwinSim();
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 200); return () => clearInterval(t); }, []);   // HUD refresh 5 Hz; 3D reads the sim every frame
  const sim = simRef.current;
  if (import.meta.env.DEV) (window as unknown as { __twin: TwinSim }).__twin = sim;     // dev-only handle for debugging / tests
  const live = useLive();
  useBackendSync(sim, live.snapshot, live.events);

  const [mode, setMode] = useState<ViewMode>("factory");
  const [machine, setMachine] = useState<string | null>(null);
  const [part, setPart] = useState<string | null>(null);
  const [hoverPart, setHover] = useState<string | null>(null);
  const [explode, setExplode] = useState(0.6);
  const [guides, setGuides] = useState(true);
  const [labels, setLabels] = useState(false);    // "All labels"; hovered / selected / faulted parts are always labelled
  const [xray, setXray] = useState(false);
  const [walk, setWalk] = useState(false);
  const [fp, setFp] = useState(false);
  const [floorV, setFloorV] = useState(0);
  const floorRef = useRef<FloorClient | null>(null);
  if (!floorRef.current) floorRef.current = new FloorClient(() => simRef.current, () => setFloorV((x) => x + 1));
  const floor = floorRef.current;
  const act = useCallback((a: Action) => floor.act(a), [floor]);
  const [who, setWho] = useState({ name: "", role: "technician" });
  const [help, setHelp] = useState(false);
  // big transient banner for what matters on the floor: faults, line stops, repairs (checked at the 5 Hz HUD refresh)
  const seenEvent = useRef<unknown>(null);
  const [toast, setToast] = useState<{ text: string; level: string; t: number } | null>(null);
  const top = sim.events[0];
  if (top && top !== seenEvent.current) {
    seenEvent.current = top;
    if (top.level === "fault" || (top.level === "success" && /cleared|reset/.test(top.text))) setTimeout(() => setToast({ text: top.text, level: top.level, t: Date.now() }), 0);
  }
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t); }, [toast]);
  const [quality, setQuality] = useState(true);
  const [tab, setTab] = useState<Tab>("controls");
  const [left, setLeft] = useState(() => window.innerWidth > 1350);      // keep 75-80 % of the screen for the 3D view
  const [right, setRight] = useState(() => window.innerWidth > 1000);
  const [preset, setPreset] = useState<CameraPreset>("overview");
  const anim = useRef<number | null>(null);

  const selectMachine = useCallback((id: string | null) => {
    setMachine(id); setPart(null);
    if (id) cameraApi.fit(id, 1.1); else { setMode("factory"); cameraApi.preset(preset); }
  }, [preset]);
  const isolate = useCallback((id: string) => { setMachine(id); setMode("isolate"); setTimeout(() => cameraApi.fit(id, 1), 30); }, []);
  const selectPart = useCallback((id: string | null) => {
    setPart(id);
    if (id) { const m = machineOfPart(id); if (m && m.id !== machine) setMachine(m.id); if (mode === "factory") setMode("isolate"); setTab((t) => t); }
  }, [machine, mode]);
  const framePart = () => part && cameraApi.fit(part, 2.2);
  const locate = useCallback((f: Fault) => {                  // fly to the machine, isolate, auto-explode, highlight the red part
    setMachine(f.machineId); setPart(f.partId); setMode("exploded"); setExplode(1); setTab("diagnostics");
    setTimeout(() => cameraApi.fit(f.machineId, 1.25), 30);
    setTimeout(() => cameraApi.fit(f.partId, 3), 1300);
  }, []);
  const animateAssembly = () => {                              // explode fully, then reassemble part by part
    if (anim.current) cancelAnimationFrame(anim.current);
    setMode("exploded");
    const t0 = performance.now();
    const step = (now: number) => {
      const t = (now - t0) / 1000;
      setExplode(t < 1.5 ? Math.min(1, t / 1.2) : Math.max(0, 1 - (t - 1.5) / 3.5));
      anim.current = t < 5 ? requestAnimationFrame(step) : null;
    };
    anim.current = requestAnimationFrame(step);
  };
  const inject = (mid: string, code: string) => { act({ m: "fault", id: mid, code }); pushFault(mid, code, live.connected).catch(() => {}); };
  const clear = (f: Fault) => { act({ m: "clear", id: f.machineId, code: f.code }); pushFault(f.machineId, f.code, live.connected, true).catch(() => {}); };
  const repair = (f: Fault) => act({ m: "repair", id: f.machineId, code: f.code, by: floor.myName });
  /** Machine whose footprint is closest to the worker (within 3 m), for E (open) and C (take control). */
  const nearest = () => {
    let best: string | null = null, bd = 3;
    for (const m of MACHINES) {
      if (m.type === "agv" || m.id === "CNV") continue;
      const dx = Math.max(0, Math.abs(player.x - m.position[0]) - m.size[0] / 2), dz = Math.max(0, Math.abs(player.z - m.position[2]) - m.size[2] / 2);
      const d = Math.hypot(dx, dz);
      if (d < bd) { bd = d; best = m.id; }
    }
    return best;
  };
  const toggleClaim = (id: string) => {
    const claiming = sim.owner[id] !== floor.myName;
    act({ m: "claim", id, who: claiming ? floor.myName : null });
    const m = MACHINE[id];
    if (claiming && m.type !== "agv") {                  // the worker goes and stands at the machine's control panel
      const spot = { x: m.position[0] + m.size[0] / 2 + 0.6, z: m.position[2] + m.size[2] / 2 + 0.75 };
      if (walk) player.goal = spot; else { player.x = spot.x; player.z = spot.z; player.yaw = Math.PI; }
    }
  };
  /** Factory I/O-like cameras: 1 orbit, 2 follow the worker, 3 first person. */
  const setCamera = (cam: "orbit" | "follow" | "fp") => {
    const c = cameraApi.controls;
    setWalk(cam !== "orbit"); setFp(cam === "fp");
    if (c) { c.minDistance = cam === "fp" ? 0.05 : 1.5; c.maxDistance = cam === "fp" ? 0.05 : 120; }
    if (cam === "orbit") { cameraApi.preset(preset); return; }
    setMode("factory"); setMachine(null); setPart(null);
    if (cam === "fp") c?.setLookAt(player.x - Math.sin(player.yaw) * 0.05, 1.7, player.z - Math.cos(player.yaw) * 0.05, player.x, 1.7, player.z, false);
    else c?.setLookAt(player.x - 3, 3.2, player.z + 5, player.x, 1.2, player.z, true);
  };
  const toggleWalk = () => setCamera(walk ? "orbit" : "follow");

  // Showcase tour: every station isolated, exploded, X-rayed, then a forced fault shown in red, then cleaned up.
  const tour = useRef(0);
  const [touring, setTouring] = useState<string | null>(null);
  const showcase = async (only?: string) => {
    const run = ++tour.current, live = () => tour.current === run;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    setCamera("orbit"); setTab("exploded"); setRight(true);
    for (const m of MACHINES.filter((x) => (only ? x.id === only : x.type !== "agv" || x.id === "AGV1"))) {
      if (!live()) break;
      setTouring(m.name);
      setMachine(m.id); setPart(null); setXray(false); setMode("isolate"); setExplode(0);
      setTimeout(() => cameraApi.fit(m.id, 1.05), 30); await wait(2200); if (!live()) break;
      setMode("exploded"); setExplode(0.75); await wait(3000); if (!live()) break;
      setXray(true); setExplode(0.25); await wait(2500); if (!live()) break;
      const spec = m.faults.find((f) => f.severity === "critical") ?? m.faults[0];
      if (spec) {
        act({ m: "fault", id: m.id, code: spec.code });
        setPart(spec.partId); setXray(false); setExplode(1);
        setTimeout(() => cameraApi.fit(spec.partId, 3), 600); await wait(3500);
        act({ m: "clear", id: m.id, code: spec.code });
      }
      setExplode(0);
    }
    if (live()) { setTouring(null); setXray(false); changeMode("factory"); setMachine(null); setPart(null); }
  };
  const stopTour = () => { tour.current++; setTouring(null); setXray(false); setExplode(0); };
  const resetSim = () => { simRef.current = new TwinSim(); setMachine(null); setPart(null); setMode("factory"); };
  const changeMode = (m: ViewMode) => {
    if (m !== "factory" && !machine) return;
    setMode(m);
    if (m === "factory") { setPart(null); cameraApi.preset(preset); } else cameraApi.fit(machine!, 1);
  };

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest?.("input, select, textarea")) return;
      const k = e.key.toLowerCase();
      if (k === "p") { toggleWalk(); return; }
      if (k === "1" || k === "2" || k === "3") { setCamera(k === "1" ? "orbit" : k === "2" ? "follow" : "fp"); return; }
      if (walk && k === "e") { const id = nearest(); if (id) { setMachine(id); setTab("controls"); setRight(true); } return; }
      if (walk && k === "c") { const id = nearest(); if (id) toggleClaim(id); return; }
      if (k === " ") { e.preventDefault();
        if (machine) sim.setMachine(machine, sim.rt[machine].status === "RUN" ? "HOLD" : "RUN");
        else act({ m: "line", state: sim.line.state === "RUNNING" ? "PAUSED" : "RUNNING" }); }
      else if (k === "e" && machine) changeMode(mode === "exploded" ? "isolate" : "exploded");
      else if (k === "i" && machine) changeMode(mode === "factory" ? "isolate" : "factory");
      else if (k === "f") { const f = sim.faults[0]; if (f) locate(f); else if (part) framePart(); else if (machine) cameraApi.fit(machine); }
      else if (k === "r") cameraApi.preset(preset);
      else if (k === "x") setXray((x) => !x);
      else if (k === "escape") { if (mode !== "factory") changeMode("factory"); else selectMachine(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const view: ViewState = useMemo(() => ({
    sim, mode, machine, part, hoverPart, explode, guides, xray, labels, quality,
    selectMachine, selectPart, hover: setHover, isolate, walk, fp, floor, act,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- floorV: re-render scene consumers when players join/leave/claim
  }), [sim, mode, machine, part, hoverPart, explode, guides, xray, labels, quality, selectMachine, selectPart, isolate, walk, fp, floor, act, floorV]);
  const near = walk ? nearest() : null;

  const health = sim.health(), k = sim.kpis(), crit = sim.faults.filter((f) => f.severity === "critical");
  const first = crit[0] ?? sim.faults[0];

  const status = sim.line.state === "ESTOP" ? { c: "alarm", t: "E-STOP" }
    : health === "FAULT" ? { c: "alarm", t: `FAULT • ${sim.faults.length} ALARM${sim.faults.length > 1 ? "S" : ""}` }
    : health === "WARNING" ? { c: "warn", t: `WARNING • ${sim.faults.length}` }
    : health === "PAUSED" ? { c: "dim", t: sim.line.state === "STOPPED" ? "STOPPED" : "PAUSED" } : { c: "ok", t: "RUNNING" };
  const zone = machine ? ZONES.find((z) => z.machines.includes(machine)) : null;
  const viewSeg = xray ? "xray" : mode;
  const camSeg = fp ? "fp" : walk ? "follow" : "orbit";
  const drawer = "glass absolute flex flex-col overflow-hidden transition-transform duration-200";

  return (
    <div className="flex h-screen flex-col bg-hmi-bg text-hmi-text">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-hmi-line bg-hmi-panel px-3">
        {/* left: brand, page, breadcrumb, line status */}
        <div className="flex min-w-0 items-center gap-3">
          <span className="text-[13px] font-semibold tracking-tight">Root<span className="text-hmi-muted">Twin</span></span>
          <Segmented label="Page" value={page} onChange={setPage} options={[["twin", "Twin"], ["play", "Play"]]} />
          {page === "twin" && <>
            <span className="hidden truncate text-[11px] text-hmi-muted xl:inline">Factory Floor{zone && <> / {zone.name}</>}{machine && <> / <span className="text-hmi-text">{MACHINE[machine].name}</span></>}</span>
            <span className="flex items-center gap-1.5 whitespace-nowrap text-[11px] font-medium">
              <span className={`h-2 w-2 rounded-full ${{ ok: "bg-ok", warn: "bg-warn", alarm: "bg-alarm animate-pulse", dim: "bg-hmi-dim" }[status.c]}`} />
              <span className={{ ok: "text-ok", warn: "text-warn", alarm: "text-alarm", dim: "text-hmi-muted" }[status.c]}>{status.t}</span>
              {first && <button onClick={() => locate(first)} className="ml-1 rounded-[3px] border border-hmi-line px-1.5 py-px text-hmi-muted hover:text-hmi-text" title={first.label}>Locate <kbd className="num">F</kbd></button>}
            </span>
          </>}
        </div>
        {page === "twin" && <>
          {/* centre: view + camera */}
          <div className="mx-auto flex items-center gap-2">
            <Segmented label="View" value={viewSeg} onChange={(v) => (v === "xray" ? setXray(!xray) : (setXray(false), changeMode(v)))}
              options={[["factory", "Overview"], ["isolate", "Isolate", !machine], ["exploded", "Exploded", !machine], ["xray", "X-Ray"]]} />
            <Segmented label="Camera" value={camSeg} onChange={setCamera} options={[["orbit", "Orbit"], ["follow", "Worker"], ["fp", "First-Person"]]} />
            {sim.line.timeScale !== 1 && <span className="num rounded-[3px] border border-warn/40 px-1.5 py-px text-[10px] text-warn">{sim.line.timeScale === 0 ? "SIM HOLD" : `${sim.line.timeScale}×`}</span>}
          </div>
          {/* right: KPIs, link, player, view menu, drawers */}
          <div className="flex items-center gap-3 text-[11px]">
            <span className="num hidden text-hmi-muted lg:inline" title={`A ${(k.availability * 100).toFixed(0)} · P ${(k.performance * 100).toFixed(0)} · Q ${(k.quality * 100).toFixed(0)}`}>
              OEE <span className="text-hmi-text">{(k.oee * 100).toFixed(0)}%</span> · <span className="text-hmi-text">{k.throughput.toFixed(0)}</span> parts/h · <span className="text-hmi-text">{k.good}</span> good
            </span>
            <span className={`flex items-center gap-1 ${live.connected ? "text-hmi-muted" : "text-hmi-dim"}`} title="Backend line link (faults, AI alarms, copilot)">
              <span className={`h-1.5 w-1.5 rounded-full ${live.connected ? "bg-ok" : "bg-hmi-dim"}`} />{live.connected ? "Live" : "Standalone"}
            </span>
            <details className="relative">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-[4px] border border-hmi-line px-2 py-1 text-hmi-muted hover:text-hmi-text">
                <span className="h-2 w-2 rounded-full" style={{ background: HAT[floor.me?.role ?? who.role] }} />
                {floor.connected ? <>{floor.me?.name} · {floor.players.size + 1}</> : <>{who.role[0].toUpperCase() + who.role.slice(1)} • Join</>}
              </summary>
              <div className="glass absolute right-0 top-9 z-30 w-60 space-y-2 p-3">
                {floor.connected ? <p className="text-hmi-muted">On the floor as <b className="text-hmi-text">{floor.me?.name}</b> ({floor.me?.role}). {floor.players.size} other worker(s).</p>
                  : <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); floor.join(who.name || "Worker", who.role); }}>
                      <input value={who.name} onChange={(e) => setWho({ ...who, name: e.target.value })} placeholder="Your name" maxLength={24} aria-label="Player name"
                             className="w-full rounded-[4px] border border-hmi-line bg-hmi-bg px-2 py-1 outline-none focus:border-sel" />
                      <select value={who.role} onChange={(e) => setWho({ ...who, role: e.target.value })} aria-label="Role" className="w-full rounded-[4px] border border-hmi-line bg-hmi-bg px-1.5 py-1">
                        {Object.keys(HAT).map((r) => <option key={r}>{r}</option>)}
                      </select>
                      <Btn c="sky" className="w-full">Join floor</Btn>
                    </form>}
              </div>
            </details>
            <details className="relative">
              <summary className="cursor-pointer list-none rounded-[4px] border border-hmi-line px-2 py-1 text-hmi-muted hover:text-hmi-text" aria-label="View menu">View ▾</summary>
              <div className="glass absolute right-0 top-9 z-30 w-64 space-y-2 p-3">
                <label className="block text-[10px] uppercase tracking-wider text-hmi-dim">Camera preset
                  <select value={preset} onChange={(e) => { const p = e.target.value as CameraPreset; setPreset(p); cameraApi.preset(p); }} className="mt-1 w-full rounded-[4px] border border-hmi-line bg-hmi-bg px-1.5 py-1 text-[11px] normal-case tracking-normal text-hmi-text">
                    {Object.entries(CAMERA_PRESETS).map(([id, c]) => <option key={id} value={id}>{c.label}</option>)}
                  </select></label>
                <label className="block text-[10px] uppercase tracking-wider text-hmi-dim">Inspect station
                  <select value="" aria-label="Inspect station" onChange={(e) => e.target.value && showcase(e.target.value)} className="mt-1 w-full rounded-[4px] border border-hmi-line bg-hmi-bg px-1.5 py-1 text-[11px] normal-case tracking-normal text-hmi-text">
                    <option value="">Select…</option>
                    {MACHINES.filter((m) => m.type !== "agv" || m.id === "AGV1").map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select></label>
                <Btn className="w-full" onClick={() => (touring ? stopTour() : showcase())}>{touring ? `Stop tour (${touring.split(" ")[0]})` : "Showcase tour (all stations)"}</Btn>
                <label className="flex items-center gap-2 text-hmi-muted"><input type="checkbox" checked={quality} onChange={() => setQuality(!quality)} className="accent-[#3b82f6]" /> High quality rendering</label>
              </div>
            </details>
            <div className="flex">
              <button onClick={() => setLeft(!left)} aria-pressed={left} aria-label="Toggle hierarchy drawer" className={`rounded-l-[4px] border border-hmi-line px-1.5 py-1 ${left ? "text-hmi-text" : "text-hmi-dim"}`}>◧</button>
              <button onClick={() => setRight(!right)} aria-pressed={right} aria-label="Toggle inspector drawer" className={`rounded-r-[4px] border border-l-0 border-hmi-line px-1.5 py-1 ${right ? "text-hmi-text" : "text-hmi-dim"}`}>◨</button>
            </div>
          </div>
        </>}
      </header>

      {page === "play" ? <Play /> : (
        <main className="relative min-h-0 flex-1 overflow-hidden">
          <TwinCanvas view={view} />
          {/* left drawer: zones -> machines -> components */}
          <aside className={`${drawer} bottom-14 left-3 top-3 w-[260px] ${left ? "" : "-translate-x-[280px]"}`} aria-label="Factory hierarchy">
            <div className="flex items-center justify-between px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-hmi-muted">Hierarchy & BOM
              <button onClick={() => setLeft(false)} aria-label="Close hierarchy" className="text-hmi-dim hover:text-hmi-text">✕</button></div>
            {left && <Hierarchy sim={sim} machine={machine} part={part} onMachine={(id) => { selectMachine(id); setTab("controls"); }}
                                onPart={(mid, pid) => { setMachine(mid); setPart(pid); if (mode === "factory") setMode("isolate"); setTimeout(() => cameraApi.fit(pid, 2.5), 30); }} />}
          </aside>
          {/* right drawer: inspector */}
          <aside className={`${drawer} bottom-14 right-3 top-3 w-[300px] ${right ? "" : "translate-x-[320px]"}`} aria-label="Inspector">
            <div className="flex items-center gap-2 px-3 pt-2.5 text-[12px]">
              <span className="truncate font-medium">{machine ? MACHINE[machine].name : "Production line"}</span>
              {machine && <button onClick={() => selectMachine(null)} className="ml-auto text-hmi-dim hover:text-hmi-text" aria-label="Deselect">✕</button>}
            </div>
            {right && <RightPanel sim={sim} tab={tab} setTab={setTab} machine={machine} part={part} explode={explode}
              setExplode={(e) => { setExplode(e); if (machine && mode !== "exploded") setMode("exploded"); }}
              guides={guides} xray={xray} toggleXray={() => setXray(!xray)} labels={labels} act={act} me={floor.myName} onRepair={repair}
              onClaim={toggleClaim} toggleGuides={() => setGuides(!guides)} toggleLabels={() => setLabels(!labels)}
              onIsolate={() => machine && isolate(machine)} onExploded={() => changeMode(mode === "exploded" ? "isolate" : "exploded")}
              onPart={(id) => { setPart(id); setTimeout(() => cameraApi.fit(id, 2.5), 30); }} onLocate={locate} onFramePart={framePart}
              onInject={inject} onClear={clear} animateAssembly={animateAssembly} reset={resetSim} />}
          </aside>
          {toast && (
            <div key={toast.t} className={`glass pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 px-3 py-1.5 text-[12px] shadow-xl ${toast.level === "fault" ? "shadow-[inset_3px_0_0_var(--color-alarm)]" : "shadow-[inset_3px_0_0_var(--color-ok)]"}`}>
              <span className={toast.level === "fault" ? "text-alarm" : "text-ok"}>{toast.level === "fault" ? "ALARM" : "OK"}</span> <span className="text-hmi-text">{toast.text}</span>
            </div>)}
          {walk && (
            <div className="glass pointer-events-none absolute bottom-14 left-1/2 -translate-x-1/2 px-3 py-1 text-[11px] text-hmi-muted">
              {near ? <>At <span className="text-hmi-text">{MACHINE[near].name}</span>{sim.owner[near] ? ` · operated by ${sim.owner[near]}` : " · automatic"} · <kbd className="num text-hmi-text">E</kbd> controls · <kbd className="num text-hmi-text">C</kbd> {sim.owner[near] === floor.myName ? "release" : "take control"}</>
                : <><kbd className="num text-hmi-text">WASD</kbd> / click floor to walk · <kbd className="num text-hmi-text">Shift</kbd> run · walk to a panel to operate it</>}
              {floor.denied && <span className="ml-2 text-alarm">{floor.denied}</span>}
            </div>)}
          {/* bottom dock: simulation playback */}
          <div className="glass absolute bottom-3 left-1/2 flex h-9 -translate-x-1/2 items-center gap-1 px-1.5 text-[11px]">
            <button onClick={() => act({ m: "line", state: sim.line.state === "RUNNING" ? "PAUSED" : "RUNNING" })} className="w-16 rounded-[3px] px-2 py-1 text-hmi-text hover:bg-white/5" aria-label="Run or pause the line">
              {sim.line.state === "RUNNING" ? "❚❚ Pause" : "▶ Run"}</button>
            <span className="h-4 w-px bg-hmi-line" />
            {[0.1, 0.25, 1, 2].map((v) => (
              <button key={v} onClick={() => act({ m: "speed", v })} aria-pressed={sim.line.timeScale === v}
                      className={`num rounded-[3px] px-2 py-1 ${sim.line.timeScale === v ? "bg-sel/20 text-hmi-text shadow-[inset_0_-2px_0_var(--color-sel)]" : "text-hmi-muted hover:text-hmi-text"}`}>{v}×</button>))}
            <span className="h-4 w-px bg-hmi-line" />
            <button onClick={() => sim.stepCycle()} disabled={sim.line.state === "RUNNING"} className="rounded-[3px] px-2 py-1 text-hmi-muted hover:text-hmi-text disabled:opacity-35">Step</button>
            <button onClick={resetSim} className="rounded-[3px] px-2 py-1 text-hmi-muted hover:text-hmi-text">Reset</button>
            <span className="h-4 w-px bg-hmi-line" />
            <button onClick={() => setHelp(!help)} aria-pressed={help} aria-label="Keyboard shortcuts" className="num rounded-[3px] px-2 py-1 text-hmi-muted hover:text-hmi-text">?</button>
          </div>
          {help && (
            <div className="glass absolute bottom-14 left-1/2 w-[420px] -translate-x-1/2 p-3 text-[11px]">
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-hmi-muted">Keyboard</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-hmi-muted">
                {[["Click / dbl-click", "select / isolate"], ["Space", "run / pause"], ["E", "exploded view"], ["X", "X-ray"], ["I", "isolate"], ["F", "locate fault"], ["R", "reset camera"], ["Esc", "back"],
                  ["1 / 2 / 3", "orbit / worker / first person"], ["P", "worker mode"], ["WASD, Shift", "walk, run"], ["E / C (worker)", "open machine / take control"]].map(([key, what]) => (
                  <div key={key} className="flex justify-between gap-2"><kbd className="num text-hmi-text">{key}</kbd><span className="text-right">{what}</span></div>))}
              </div>
            </div>)}
        </main>
      )}
    </div>
  );
}
