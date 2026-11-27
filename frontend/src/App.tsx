// RootTwin - production-line digital twin (3D) + Play mode. Viewport-first industrial HUD.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLive } from "./api";
import Play from "./Play";
import { CAMERA_PRESETS, cameraApi, TwinCanvas, type CameraPreset } from "./scene3d/TwinCanvas";
import type { ViewMode, ViewState } from "./scene3d/context";
import { pushFault, useBackendSync } from "./twin/backend";
import { MACHINE, machineOfPart } from "./twin/registry";
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
  const inject = (mid: string, code: string) => { const f = sim.injectFault(mid, code); if (f) pushFault(mid, code, live.connected).catch(() => {}); };
  const clear = (f: Fault) => { sim.clearFault(f.id); pushFault(f.machineId, f.code, live.connected, true).catch(() => {}); };
  const resetSim = () => { simRef.current = new TwinSim(); setMachine(null); setPart(null); setMode("factory"); };
  const changeMode = (m: ViewMode) => {
    if (m !== "factory" && !machine) return;
    setMode(m);
    if (m === "factory") { setPart(null); cameraApi.preset(preset); } else cameraApi.fit(machine!, 1);
  };

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, select, textarea")) return;
      const k = e.key.toLowerCase();
      if (k === " ") { e.preventDefault();
        if (machine) sim.setMachine(machine, sim.rt[machine].status === "RUN" ? "HOLD" : "RUN");
        else sim.setLine(sim.line.state === "RUNNING" ? "PAUSED" : "RUNNING"); }
      else if (k === "e" && machine) changeMode(mode === "exploded" ? "isolate" : "exploded");
      else if (k === "i" && machine) changeMode(mode === "factory" ? "isolate" : "factory");
      else if (k === "f") { const f = sim.faults[0]; if (f) locate(f); else if (part) framePart(); else if (machine) cameraApi.fit(machine); }
      else if (k === "r") cameraApi.preset(preset);
      else if (k === "escape") { if (mode !== "factory") changeMode("factory"); else selectMachine(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const view: ViewState = useMemo(() => ({
    sim, mode, machine, part, hoverPart, explode, guides, labels, quality,
    selectMachine, selectPart, hover: setHover, isolate,
  }), [sim, mode, machine, part, hoverPart, explode, guides, labels, quality, selectMachine, selectPart, isolate]);

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
              guides={guides} labels={labels} toggleGuides={() => setGuides(!guides)} toggleLabels={() => setLabels(!labels)}
              onIsolate={() => machine && isolate(machine)} onExploded={() => changeMode(mode === "exploded" ? "isolate" : "exploded")}
              onPart={(id) => { setPart(id); setTimeout(() => cameraApi.fit(id, 2.5), 30); }} onLocate={locate} onFramePart={framePart}
              onInject={inject} onClear={clear} animateAssembly={animateAssembly} reset={resetSim} />}
          </aside>
          <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded bg-slate-950/70 px-2 py-1 text-[10px] text-slate-400">
            Click = select · double-click = isolate · Space run/pause · E exploded · I isolate · F locate fault · R reset camera · Esc back
          </div>
        </main>
      )}
    </div>
  );
}
