// Right panel: context-aware Controls (line vs machine), Exploded view / BOM, Diagnostics; component learning card.
import { useState } from "react";
import { api } from "../api";
import { MACHINE, allParts, partById } from "../twin/registry";
import type { TwinSim } from "../twin/sim";
import type { Fault, MachineRuntime, Part } from "../twin/types";
import { Btn, Dot, ValueControl } from "./common";

export type Tab = "controls" | "exploded" | "diagnostics";

function defaultTelemetry(p: Part, rt: MachineRuntime, fault?: Fault): Record<string, string> {
  const hot = fault ? 1 : 0;
  switch (p.category) {
    case "electrical": return { current: `${(2 + (rt.act.current ?? 4) * 0.3 + hot * 4).toFixed(2)} A`, temperature: `${(36 + hot * 38).toFixed(1)} °C` };
    case "mechanical": return { vibration: `${(0.9 + hot * 3.4).toFixed(2)} mm/s`, temperature: `${(34 + hot * 41).toFixed(1)} °C` };
    case "sensor": return { signal: hot ? "invalid / out of range" : "OK", "self-test": hot ? "FAILED" : "passed" };
    case "actuator": return { state: rt.status === "RUN" ? "active" : "idle", "cycles": String(rt.cycles) };
    case "tooling": return { wear: `${Math.min(100, (rt.cycles % 60) / 0.6 + hot * 40).toFixed(0)} %` };
    default: return { condition: hot ? "damaged" : "nominal" };
  }
}

export function PartCard({ sim, part, onLocate }: { sim: TwinSim; part: Part; onLocate: () => void }) {
  const m = Object.values(MACHINE).find((x) => allParts(x).includes(part))!;
  const rt = sim.rt[m.id], fault = sim.partFault(part.id);
  const tele = { ...defaultTelemetry(part, rt, fault), ...(part.telemetry?.(rt) ?? {}) };
  const [answer, setAnswer] = useState<{ text: string; sources: string[]; mode: string } | null>(null);
  const ask = () => api("/copilot/ask", { question: `How do I repair the ${part.name}?`, fault_codes: m.faults.find((f) => f.partId === part.id)?.backendCodes?.slice(0, 1) ?? [],
    alert_text: fault?.label }).then(setAnswer).catch((e) => setAnswer({ text: `Copilot unavailable (${e.message}) - the backend API is not running.`, sources: [], mode: "blocked" }));
  return (
    <section className={`rounded-lg border p-2.5 text-[12px] ${fault ? "border-red-500/70 bg-red-950/40" : "border-white/10 bg-slate-900/80"}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <div className="font-mono text-[10px] text-sky-300">{part.partNumber} · {part.category} · axis {part.assemblyAxis}</div>
          <h3 className="text-sm font-semibold text-white">{part.name}</h3>
          <div className="text-[11px] text-slate-400">{m.name} · {part.material}</div>
        </div>
        <Btn c="ghost" onClick={onLocate} title="Frame this part in 3D">⌖</Btn>
      </div>
      {fault && <div className="mt-2 rounded bg-red-600/25 px-2 py-1 text-red-200">⚠ {fault.id} · {fault.label} ({fault.severity})</div>}
      {part.description && <p className="mt-2 text-slate-300">{part.description}</p>}
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[11px] tabular-nums">
        {Object.entries(tele).map(([k, v]) => (<div key={k} className="contents"><dt className="text-slate-500">{k}</dt><dd className="text-slate-100">{v}</dd></div>))}
        {Object.entries(part.specs ?? {}).map(([k, v]) => (<div key={k} className="contents"><dt className="text-slate-500">{k}</dt><dd>{v}</dd></div>))}
      </dl>
      <p className="mt-2 rounded bg-slate-800/70 px-2 py-1 text-[11px] text-amber-200/90">🛠 {part.maintenanceNotes}</p>
      <Btn c="sky" className="mt-2 w-full" onClick={ask}>Ask the maintenance copilot</Btn>
      {answer && <pre className={`mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap rounded p-2 font-sans text-[11px] ${answer.mode === "blocked" ? "bg-red-950/50 text-red-200" : "bg-slate-950 text-slate-200"}`}>
        {answer.text}{answer.sources.length ? `\n\n${answer.sources.join(" ")}` : ""}</pre>}
    </section>
  );
}

interface Props {
  sim: TwinSim; tab: Tab; setTab: (t: Tab) => void; machine: string | null; part: string | null; explode: number;
  setExplode: (e: number) => void; guides: boolean; labels: boolean; toggleGuides: () => void; toggleLabels: () => void;
  onIsolate: () => void; onExploded: () => void; onPart: (id: string) => void; onLocate: (f: Fault) => void; onFramePart: () => void;
  onInject: (machineId: string, code: string) => void; onClear: (f: Fault) => void; animateAssembly: () => void; reset: () => void;
}

function LineControls({ sim, reset }: { sim: TwinSim; reset: () => void }) {
  const st = sim.line.state;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-1.5">
        <Btn c="green" onClick={() => sim.setLine("RUNNING")} disabled={st === "RUNNING"}>▶ Start line</Btn>
        <Btn onClick={() => sim.setLine("PAUSED")} disabled={st !== "RUNNING"}>⏸ Pause</Btn>
        <Btn c="red" onClick={() => sim.setLine("ESTOP")} className="font-bold">E-STOP</Btn>
        <Btn c="amber" onClick={() => sim.resetEstop()} disabled={st !== "ESTOP"}>Reset E-stop</Btn>
        <Btn onClick={() => sim.stepCycle()} disabled={st === "RUNNING" || st === "ESTOP"}>⏭ Step</Btn>
        <Btn c="ghost" onClick={reset}>↺ Reset sim</Btn>
      </div>
      <ValueControl label="Master line speed / throughput" unit="%" min={0} max={150} step={1} value={sim.line.speedPct} onChange={(v) => { sim.line.speedPct = v; }} />
      <ValueControl label="Conveyor belt speed" unit="m/s" min={0} max={1.2} step={0.01} value={sim.rt.CNV.set.speed} actual={sim.rt.CNV.act.speed} onChange={(v) => sim.setValue("CNV", "speed", v)} />
      <ValueControl label="AGV fleet speed" unit="m/s" min={0} max={2} step={0.05} value={sim.rt.AGV1.set.speed} onChange={(v) => sim.setFleetSpeed(v)} />
      <ValueControl label="Workpiece spawn interval" unit="s" min={2} max={30} step={0.5} value={sim.line.spawnInterval} onChange={(v) => { sim.line.spawnInterval = v; }} />
      <ValueControl label="Ambient factory lighting" unit="×" min={0.2} max={2} step={0.05} value={sim.line.lighting} onChange={(v) => { sim.line.lighting = v; }} />
      <ValueControl label="X-ray ghosting opacity" unit="" min={0} max={0.6} step={0.01} value={sim.line.ghost} onChange={(v) => { sim.line.ghost = v; }} />
      <div>
        <div className="mb-1 text-[11px] text-slate-400">Scenario presets</div>
        <div className="flex flex-wrap gap-1.5">
          {([["normal", "Normal shift"], ["peak", "Peak throughput"], ["changeover", "Changeover / reduced"], ["lockout", "Maintenance lockout"], ["fault", "Simulated line fault"]] as const).map(([k, l]) => (
            <Btn key={k} c={k === "fault" ? "red" : "ghost"} onClick={() => sim.scenario(k)}>{l}</Btn>))}
        </div>
      </div>
      <div className="rounded bg-slate-800/60 p-2 text-[11px] text-slate-400">Dispenser stock: <b className="tabular-nums text-slate-200">{sim.stock}</b> carriers · pallet {sim.pallet.filter((x) => x !== null && x >= 0).length}/9</div>
    </div>
  );
}

function MachineControls({ sim, id, explode, setExplode, onIsolate, onExploded }: { sim: TwinSim; id: string; explode: number; setExplode: (e: number) => void; onIsolate: () => void; onExploded: () => void }) {
  const m = MACHINE[id], rt = sim.rt[id];
  return (
    <div className="space-y-3">
      <div className="text-[11px] text-slate-400">{m.description}</div>
      <div className="flex items-center gap-2 text-xs">Status <b className={`rounded px-1.5 tabular-nums ${rt.status === "FAULT" ? "bg-red-600" : rt.status === "RUN" ? "bg-emerald-700" : "bg-slate-700"}`}>{rt.status}</b>
        {rt.manual && <span className="rounded bg-amber-500/20 px-1.5 text-amber-300">manual</span>}<span className="ml-auto tabular-nums text-slate-400">cycles {rt.cycles}</span></div>
      <div className="grid grid-cols-3 gap-1.5">
        <Btn c="green" onClick={() => sim.setMachine(id, "RUN")}>▶ Run</Btn>
        <Btn onClick={() => sim.setMachine(id, "HOLD")}>⏸ Hold</Btn>
        <Btn c="red" onClick={() => sim.setMachine(id, "STOP")}>■ Stop</Btn>
        <Btn onClick={() => sim.home(id)}>⌂ Home axes</Btn>
        <Btn onClick={() => sim.stepCycle(id)}>⏭ Step cycle</Btn>
        <Btn c="sky" onClick={onIsolate}>◎ Isolate</Btn>
      </div>
      <Btn c="amber" className="w-full" onClick={onExploded}>✳ Toggle exploded view (vue éclatée)</Btn>
      {m.controls.map((c) => (
        <ValueControl key={c.key} label={c.label} unit={c.unit} min={c.min} max={c.max} step={c.step} value={rt.set[c.key] ?? 0} actual={rt.act[c.key]} onChange={(v) => sim.setValue(id, c.key, v)} />
      ))}
      <ValueControl label="Explode factor" unit="%" min={0} max={100} step={1} value={Math.round(explode * 100)} onChange={(v) => setExplode(v / 100)} />
    </div>
  );
}

function Exploded(p: Props) {
  const m = p.machine ? MACHINE[p.machine] : null;
  if (!m) return <p className="text-xs text-slate-400">Select a machine (3D or tree) to open its exploded view and bill of materials.</p>;
  return (
    <div className="space-y-2">
      <ValueControl label="Explode" unit="%" min={0} max={100} step={1} value={Math.round(p.explode * 100)} onChange={(v) => p.setExplode(v / 100)} />
      <div className="grid grid-cols-4 gap-1">
        <Btn onClick={() => p.setExplode(0)}>0 %</Btn><Btn onClick={() => p.setExplode(0.5)}>50 %</Btn><Btn onClick={() => p.setExplode(1)}>100 %</Btn>
        <Btn c="sky" onClick={p.animateAssembly} title="Animate the assembly sequence">▶ Seq.</Btn>
      </div>
      <div className="flex gap-3 text-[11px] text-slate-300">
        <label className="flex items-center gap-1"><input type="checkbox" checked={p.guides} onChange={p.toggleGuides} className="accent-sky-500" /> axis guide lines</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={p.labels} onChange={p.toggleLabels} className="accent-sky-500" /> part callouts</label>
      </div>
      <table className="w-full text-[11px]">
        <thead className="text-left text-slate-500"><tr><th className="font-normal">Part no.</th><th className="font-normal">Component</th><th className="font-normal">Cat.</th></tr></thead>
        <tbody>{m.subAssemblies.map((s) => [
          <tr key={s.id}><td colSpan={3} className="pt-1.5 text-[10px] uppercase tracking-wide text-slate-500">{s.name}</td></tr>,
          ...s.parts.map((x) => (
            <tr key={x.id} onClick={() => p.onPart(x.id)} className={`cursor-pointer ${p.part === x.id ? "bg-sky-500/25" : "hover:bg-white/5"}`}>
              <td className="font-mono text-slate-400">{x.partNumber}</td><td className="flex items-center gap-1">{p.sim.partFault(x.id) && <Dot level={p.sim.partFault(x.id)!.severity} />}{x.name}</td>
              <td className="text-slate-500">{x.category.slice(0, 4)}</td>
            </tr>)),
        ])}</tbody>
      </table>
    </div>
  );
}

function Diagnostics(p: Props) {
  const [mid, setMid] = useState(p.machine ?? "PRS");
  const [code, setCode] = useState("");
  const specs = MACHINE[mid].faults;
  const sel = code && specs.some((f) => f.code === code) ? code : specs[0]?.code ?? "";
  const fmt = (t: number) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  return (
    <div className="space-y-3 text-[12px]">
      <section>
        <h4 className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">Active faults ({p.sim.faults.length})</h4>
        {p.sim.faults.length === 0 && <p className="text-slate-500">No active fault.</p>}
        {p.sim.faults.map((f) => (
          <div key={f.id} className={`mb-1.5 rounded border p-2 ${f.severity === "critical" ? "border-red-500/60 bg-red-950/40" : "border-amber-400/50 bg-amber-950/30"} ${f.acknowledged ? "opacity-70" : ""}`}>
            <div className="flex items-center gap-2"><Dot level={f.severity} /><b className="tabular-nums">{f.id}</b><span className="text-slate-400">{fmt(f.t)}</span>
              <span className="ml-auto rounded bg-slate-800 px-1 font-mono text-[10px]">{f.code}</span></div>
            <div className="mt-0.5 text-slate-200">{MACHINE[f.machineId].name} → <b>{partById(f.partId)?.name}</b></div>
            <div className="text-slate-400">{f.label} · {f.severity}{f.source === "backend" ? " · from the line / AI" : ""}</div>
            <div className="mt-1 flex gap-1.5">
              <Btn c="sky" onClick={() => p.onLocate(f)}>⌖ Locate & explode</Btn>
              <Btn onClick={() => p.sim.acknowledge(f.id)} disabled={f.acknowledged}>Acknowledge</Btn>
              <Btn c="green" onClick={() => p.onClear(f)}>Clear</Btn>
            </div>
          </div>
        ))}
      </section>
      <section className="rounded border border-white/10 p-2">
        <h4 className="mb-1.5 text-[11px] uppercase tracking-wide text-slate-500">Fault simulator</h4>
        <select value={mid} onChange={(e) => setMid(e.target.value)} aria-label="machine" className="mb-1.5 w-full rounded border border-white/10 bg-slate-950 px-1.5 py-1">
          {Object.values(MACHINE).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <select value={sel} onChange={(e) => setCode(e.target.value)} aria-label="fault" className="mb-1.5 w-full rounded border border-white/10 bg-slate-950 px-1.5 py-1">
          {specs.map((f) => <option key={f.code} value={f.code}>{f.label} ({f.severity})</option>)}
        </select>
        <div className="flex gap-1.5"><Btn c="red" onClick={() => p.onInject(mid, sel)}>⚡ Trigger fault</Btn>
          <Btn onClick={() => p.sim.faults.slice().forEach((f) => p.onClear(f))} disabled={!p.sim.faults.length}>Clear all</Btn></div>
      </section>
      <section>
        <h4 className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">Event log</h4>
        <div className="max-h-56 space-y-0.5 overflow-y-auto font-mono text-[10.5px]">
          {p.sim.events.slice(0, 60).map((e, i) => (
            <div key={i} className={e.level === "fault" ? "text-red-300" : e.level === "warning" ? "text-amber-200" : e.level === "success" ? "text-emerald-300" : "text-slate-400"}>
              <span className="tabular-nums text-slate-600">{fmt(e.t)}</span> {e.text}
            </div>))}
        </div>
      </section>
    </div>
  );
}

export function RightPanel(p: Props) {
  const part = p.part ? partById(p.part) : undefined;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="tablist" className="flex gap-1 border-b border-white/10 px-2 pt-2">
        {(["controls", "exploded", "diagnostics"] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={p.tab === t} onClick={() => p.setTab(t)}
                  className={`rounded-t px-2.5 py-1 text-xs capitalize ${p.tab === t ? "bg-slate-800 text-white" : "text-slate-400 hover:text-slate-200"}`}>
            {t === "exploded" ? "Exploded / BOM" : t}{t === "diagnostics" && p.sim.faults.length > 0 && <span className="ml-1 rounded-full bg-red-600 px-1.5 text-[10px] text-white">{p.sim.faults.length}</span>}
          </button>))}
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-2.5">
        {part && <PartCard sim={p.sim} part={part} onLocate={p.onFramePart} />}
        <div className="text-xs font-semibold text-slate-300">{p.tab === "controls" ? (p.machine ? MACHINE[p.machine].name : "Whole production line") : ""}</div>
        {p.tab === "controls" && (p.machine
          ? <MachineControls sim={p.sim} id={p.machine} explode={p.explode} setExplode={p.setExplode} onIsolate={p.onIsolate} onExploded={p.onExploded} />
          : <LineControls sim={p.sim} reset={p.reset} />)}
        {p.tab === "exploded" && <Exploded {...p} />}
        {p.tab === "diagnostics" && <Diagnostics {...p} />}
      </div>
    </div>
  );
}
