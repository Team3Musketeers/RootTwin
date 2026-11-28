// RootTwin - production-line digital twin (3D) + Play mode. Viewport-first industrial HUD.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLive } from "./api";
import Play from "./Play";
import { CAMERA_PRESETS, cameraApi, TwinCanvas, type CameraPreset } from "./scene3d/TwinCanvas";
import type { ViewMode, ViewState } from "./scene3d/context";
import { FloorClient, type Action } from "./services/floor";
import { pushFault, useBackendSync } from "./services/productionBridge";
import { HAT, player } from "./scene3d/Worker";
import { MACHINE, MACHINES, machineOfPart } from "./twin/registry";
import { TwinSim } from "./twin/sim";
import type { Fault } from "./twin/types";
import { Hierarchy } from "./ui/Hierarchy";
import { RightPanel, type Tab } from "./ui/RightPanel";

const HEALTH = { RUNNING: "bg-emerald-600", WARNING: "bg-amber-500 text-slate-950", FAULT: "bg-red-600 animate-pulse", PAUSED: "bg-slate-600" };

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
  const [labels, setLabels] = useState(true);
  const [xray, setXray] = useState(false);
  const [walk, setWalk] = useState(false);
  const [fp, setFp] = useState(false);
  const [floorV, setFloorV] = useState(0);
  const floorRef = useRef<FloorClient | null>(null);
  if (!floorRef.current) floorRef.current = new FloorClient(() => simRef.current, () => setFloorV((x) => x + 1));
  const floor = floorRef.current;
  const act = useCallback((a: Action) => floor.act(a), [floor]);
  const [who, setWho] = useState({ name: "", role: "technician" });
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
  const toggleClaim = (id: string) => act({ m: "claim", id, who: sim.owner[id] === floor.myName ? null : floor.myName });
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

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-slate-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-white/10 bg-[#0b1220] px-3 py-1.5">
        <h1 className="text-base font-bold tracking-tight">Root<span className="text-sky-400">Twin</span></h1>
        <nav className="flex gap-1" aria-label="Page">
          {([["twin", "Digital twin"], ["play", "Play: AI maintenance"]] as const).map(([p, l]) => (
            <button key={p} onClick={() => setPage(p)} aria-pressed={page === p} className={`rounded px-2 py-0.5 text-xs ${page === p ? "bg-sky-600" : "text-slate-400 hover:bg-white/10"}`}>{l}</button>))}
        </nav>
        {page === "twin" && <>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${HEALTH[health]}`}>{health === "FAULT" ? (sim.line.state === "ESTOP" ? "E-STOP" : "FAULT / STOPPED") : health}</span>
          {first && (
            <button onClick={() => locate(first)} className={`flex items-center gap-2 rounded px-2 py-0.5 text-xs ${crit.length ? "bg-red-600/90 hover:bg-red-500" : "bg-amber-500/90 text-slate-950"}`}>
              ⚠ {sim.faults.length} fault{sim.faults.length > 1 ? "s" : ""} · {MACHINE[first.machineId].name.split(" ")[0]} – {first.label} <b>⌖ Locate (F)</b>
            </button>)}
          <div className="flex rounded border border-white/10 text-xs" role="group" aria-label="View mode">
            {([["factory", "Full factory"], ["isolate", "Isolate machine"], ["exploded", "Exploded view"]] as const).map(([m, l]) => (
              <button key={m} onClick={() => changeMode(m)} disabled={m !== "factory" && !machine} aria-pressed={mode === m}
                      className={`px-2 py-0.5 disabled:opacity-40 ${mode === m ? "bg-sky-600" : "hover:bg-white/10"}`}>{l}</button>))}
          </div>
          <button onClick={() => setXray(!xray)} aria-pressed={xray} title="X-ray / cutaway: housings turn to glass (X)"
                  className={`rounded border border-white/10 px-2 py-0.5 text-xs ${xray ? "bg-cyan-600" : "hover:bg-white/10"}`}>⌗ X-ray</button>
          <button onClick={toggleWalk} aria-pressed={walk} title="Play as a factory worker: WASD to walk, Shift to run, E open machine, C take control (P)"
                  className={`rounded border border-white/10 px-2 py-0.5 text-xs ${walk ? "bg-amber-500 text-slate-950" : "hover:bg-white/10"}`}>🦺 Worker mode</button>
          <div className="flex rounded border border-white/10 text-xs" role="group" aria-label="Camera">
            {([["orbit", "1 Orbit"], ["follow", "2 Follow"], ["fp", "3 First person"]] as const).map(([c, l]) => {
              const on = c === "orbit" ? !walk : c === "fp" ? fp : walk && !fp;
              return <button key={c} onClick={() => setCamera(c)} aria-pressed={on} className={`px-1.5 py-0.5 ${on ? "bg-sky-600" : "hover:bg-white/10"}`}>{l}</button>;
            })}
          </div>
          {sim.line.timeScale !== 1 && <span className="rounded bg-violet-600 px-1.5 py-0.5 text-[11px] font-bold">{sim.line.timeScale === 0 ? "SIM PAUSED" : `${sim.line.timeScale}× time`}</span>}
          {floor.connected
            ? <span className="flex items-center gap-1 text-[11px] text-slate-300"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: HAT[floor.me?.role ?? "operator"] }} />
                {floor.me?.name} · {floor.players.size + 1} on the floor</span>
            : <form className="flex items-center gap-1 text-xs" onSubmit={(e) => { e.preventDefault(); floor.join(who.name || "Worker", who.role); }}>
                <input value={who.name} onChange={(e) => setWho({ ...who, name: e.target.value })} placeholder="your name" maxLength={24} aria-label="Player name"
                       className="w-24 rounded border border-white/10 bg-slate-900 px-1.5 py-0.5" />
                <select value={who.role} onChange={(e) => setWho({ ...who, role: e.target.value })} aria-label="Role" className="rounded border border-white/10 bg-slate-900 px-1 py-0.5">
                  {Object.keys(HAT).map((r) => <option key={r}>{r}</option>)}
                </select>
                <button className="rounded bg-sky-600 px-2 py-0.5 hover:bg-sky-500">Join floor</button>
              </form>}
          <select value={preset} aria-label="Camera preset" onChange={(e) => { const p = e.target.value as CameraPreset; setPreset(p); cameraApi.preset(p); }}
                  className="rounded border border-white/10 bg-slate-900 px-1.5 py-0.5 text-xs">
            {Object.entries(CAMERA_PRESETS).map(([id, c]) => <option key={id} value={id}>📷 {c.label}</option>)}
          </select>
          <div className="ml-auto flex items-center gap-3 text-[11px] tabular-nums text-slate-400">
            <span>OEE <b className="text-slate-100">{(k.oee * 100).toFixed(0)}%</b></span>
            <span>A {(k.availability * 100).toFixed(0)} · P {(k.performance * 100).toFixed(0)} · Q {(k.quality * 100).toFixed(0)}</span>
            <span>{k.throughput.toFixed(0)} parts/h</span><span>good {k.good}</span><span>pallets {k.pallets}</span>
            <label className="flex items-center gap-1"><input type="checkbox" checked={quality} onChange={() => setQuality(!quality)} className="accent-sky-500" />HQ</label>
            <span className={live.connected ? "text-emerald-400" : "text-slate-500"} title="Backend line link (faults, AI alarms, copilot)">{live.connected ? "● live" : "○ standalone"}</span>
          </div>
        </>}
      </header>

      {page === "play" ? <Play /> : (
        <main className="relative min-h-0 flex-1 overflow-hidden">
          <TwinCanvas view={view} />
          {/* left: hierarchy & BOM tree */}
          <aside className={`absolute bottom-2 left-2 top-2 flex w-72 flex-col rounded-lg border border-white/10 bg-slate-950/85 backdrop-blur transition ${left ? "" : "-translate-x-[17.5rem]"}`}>
            <div className="flex items-center justify-between px-3 py-2 text-xs font-semibold">Factory hierarchy & BOM
              <button onClick={() => setLeft(!left)} aria-label="Toggle hierarchy panel" className="px-1 text-slate-400 hover:text-white">{left ? "⟨" : "⟩"}</button></div>
            {left && <Hierarchy sim={sim} machine={machine} part={part} onMachine={(id) => { selectMachine(id); setTab("controls"); }}
                                onPart={(mid, pid) => { setMachine(mid); setPart(pid); if (mode === "factory") setMode("isolate"); setTimeout(() => cameraApi.fit(pid, 2.5), 30); }} />}
          </aside>
          {/* right: context controls / exploded / diagnostics */}
          <aside className={`absolute bottom-2 right-2 top-2 flex w-[23rem] flex-col rounded-lg border border-white/10 bg-slate-950/85 backdrop-blur transition ${right ? "" : "translate-x-[21.5rem]"}`}>
            <div className="flex items-center gap-2 px-3 pt-2 text-xs">
              <button onClick={() => setRight(!right)} aria-label="Toggle control panel" className="px-1 text-slate-400 hover:text-white">{right ? "⟩" : "⟨"}</button>
              <span className="font-semibold">{machine ? MACHINE[machine].name : "Production line"}</span>
              {machine && <button onClick={() => selectMachine(null)} className="ml-auto text-slate-400 hover:text-white" aria-label="Deselect">✕</button>}
            </div>
            {right && <RightPanel sim={sim} tab={tab} setTab={setTab} machine={machine} part={part} explode={explode}
              setExplode={(e) => { setExplode(e); if (machine && mode !== "exploded") setMode("exploded"); }}
              guides={guides} xray={xray} toggleXray={() => setXray(!xray)} labels={labels} act={act} me={floor.myName} onRepair={repair}
              onClaim={toggleClaim} toggleGuides={() => setGuides(!guides)} toggleLabels={() => setLabels(!labels)}
              onIsolate={() => machine && isolate(machine)} onExploded={() => changeMode(mode === "exploded" ? "isolate" : "exploded")}
              onPart={(id) => { setPart(id); setTimeout(() => cameraApi.fit(id, 2.5), 30); }} onLocate={locate} onFramePart={framePart}
              onInject={inject} onClear={clear} animateAssembly={animateAssembly} reset={resetSim} />}
          </aside>
          {walk && (
            <div className="pointer-events-none absolute bottom-10 left-1/2 -translate-x-1/2 rounded bg-slate-950/85 px-3 py-1.5 text-xs text-slate-200">
              {near ? <>At <b>{MACHINE[near].name}</b>{sim.owner[near] ? ` (operated by ${sim.owner[near]})` : " (unclaimed, automatic)"} · <b>E</b> open controls · <b>C</b> {sim.owner[near] === floor.myName ? "release" : "take control"} · click the panel buttons / drag the handwheel</>
                : <>WASD or click the floor to walk · Shift run · 1/2/3 cameras · walk up to a machine panel to operate it</>}
              {floor.denied && <span className="ml-2 text-red-300">⛔ {floor.denied}</span>}
            </div>)}
          <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded bg-slate-950/70 px-2 py-1 text-[10px] text-slate-400">
            P worker mode · Click = select · double-click = isolate · Space run/pause · E exploded · X x-ray · I isolate · F locate fault · R reset camera · Esc back
          </div>
        </main>
      )}
    </div>
  );
}
