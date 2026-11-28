// Right inspector drawer: Controls (line or machine), Exploded / BOM, I/O, Faults; component engineering card. ISA-101 styling.
import { useState } from "react";
import { api, type BackendEvent } from "../api";
import type { Action } from "../services/floor";
import { liveComponents } from "../services/productionBridge";
import { ioTags } from "../twin/io";
import { BACKEND_TO_MACHINE, MACHINE, allParts, partById } from "../twin/registry";
import type { TwinSim } from "../twin/sim";
import type { Fault, MachineRuntime, Part } from "../twin/types";
import { Btn, Dot, GuardedEstop, ValueControl } from "./common";

export type Tab = "controls" | "exploded" | "io" | "diagnostics";

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

const H = ({ children }: { children: React.ReactNode }) => <h4 className="mb-1 mt-1 text-[10px] font-semibold uppercase tracking-wider text-hmi-dim">{children}</h4>;
const Row = ({ k, v, mono = true }: { k: string; v: React.ReactNode; mono?: boolean }) => (
  <div className="flex justify-between gap-3 py-[2px]"><span className="text-hmi-muted">{k}</span><span className={`${mono ? "num" : ""} text-right text-hmi-text`}>{v}</span></div>);
const repairLabel = (sim: TwinSim, f: Fault) => (sim.repairs[f.id] ? `Repairing ${sim.repairs[f.id].left.toFixed(1)} s` : "Repair");

export function PartCard({ sim, part, onLocate, onRepair, onInject, onClear }: { sim: TwinSim; part: Part; onLocate: () => void; onRepair?: (f: Fault) => void;
  onInject?: (machineId: string, code: string) => void; onClear?: (f: Fault) => void }) {
  const m = Object.values(MACHINE).find((x) => allParts(x).includes(part))!;
  const rt = sim.rt[m.id], fault = sim.partFault(part.id);
  const live = liveComponents.get(part.id);             // backend component telemetry wins when connected
  const tele = live
    ? Object.fromEntries(Object.entries(live.channels).map(([k, c]) => [k.replace(/_/g, " "), `${c.value.toFixed(2)} ${c.unit}`]))
    : { ...defaultTelemetry(part, rt, fault), ...(part.telemetry?.(rt) ?? {}) };
  const faultHealth = fault ? (fault.severity === "critical" ? 12 : 48) : 100;          // a red part is never shown healthy
  const health = Math.min(faultHealth, live ? live.health : fault ? 100 : Math.max(70, 100 - (rt.cycles % 300) / 10));
  const spec = m.faults.find((f) => f.partId === part.id);
  const [answer, setAnswer] = useState<{ text: string; sources: string[]; mode: string } | null>(null);
  const ask = () => api("/copilot/ask", { question: `How do I repair the ${part.name}?`, fault_codes: spec?.backendCodes?.slice(0, 1) ?? [],
    alert_text: fault?.label }).then(setAnswer).catch((e) => setAnswer({ text: `Copilot unavailable (${e.message}) - the backend API is not running.`, sources: [], mode: "blocked" }));
  return (
    <section className={`rounded-[4px] border bg-hmi-bg/60 p-2.5 ${fault ? "border-alarm/50 shadow-[inset_3px_0_0_var(--color-alarm)]" : "border-hmi-line"}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="num text-[10px] text-hmi-dim">{part.partNumber} · {part.category} · axis {part.assemblyAxis}</div>
          <h3 className="truncate text-[13px] font-medium">{part.name}</h3>
          <div className="truncate text-[11px] text-hmi-muted">{part.material}</div>
        </div>
        <Btn c="ghost" onClick={onLocate} title="Frame this part in 3D" aria-label="Frame part">⌖</Btn>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-px overflow-hidden rounded-[3px] border border-hmi-line bg-hmi-line text-center">
        {[["Health", <span className={health < 30 ? "text-alarm" : health < 60 ? "text-warn" : "text-ok"}>{health.toFixed(0)}%</span>], ["Source", live ? "backend" : "model"], ["Tol.", part.tolerance ?? "-"]].map(([k, v]) => (
          <div key={k as string} className="bg-hmi-panel px-1 py-1"><div className="text-[9px] uppercase tracking-wider text-hmi-dim">{k}</div><div className="num truncate text-[11px]">{v}</div></div>))}
      </div>
      {fault && <div className="mt-2 flex items-center gap-2 text-[11px]"><Dot level={fault.severity} /><span className="flex-1 text-alarm">{fault.id} · {fault.label}</span></div>}
      {spec && onInject && onClear && onRepair && (
        <div className="mt-2 flex gap-1.5">
          {fault ? <>
            <Btn c="amber" onClick={() => onRepair(fault)} disabled={!!sim.repairs[fault.id]}>{repairLabel(sim, fault)}</Btn>
            <Btn onClick={() => onClear(fault)}>Clear fault</Btn></>
            : <Btn onClick={() => onInject(m.id, spec.code)} title={spec.label}>Force fault</Btn>}
        </div>)}
      {part.description && <p className="mt-2 text-[11px] leading-relaxed text-hmi-muted">{part.description}</p>}
      <div className="mt-2 border-t border-hmi-line pt-1.5 text-[11px]">
        {Object.entries(tele).map(([k, v]) => <Row key={k} k={k} v={v} />)}
        {Object.entries(part.specs ?? {}).map(([k, v]) => <Row key={k} k={k} v={v} />)}
      </div>
      {part.maintenanceNotes && <p className="mt-2 border-l-2 border-hmi-line pl-2 text-[11px] text-hmi-muted">{part.maintenanceNotes}</p>}
      <Btn className="mt-2 w-full" onClick={ask}>Ask the maintenance copilot</Btn>
      {answer && <pre className={`mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-[3px] border p-2 font-sans text-[11px] ${answer.mode === "blocked" ? "border-alarm/40 text-alarm" : "border-hmi-line text-hmi-text"}`}>
        {answer.text}{answer.sources.length ? `\n\n${answer.sources.join(" ")}` : ""}</pre>}
    </section>
  );
}

interface Props {
  sim: TwinSim; tab: Tab; setTab: (t: Tab) => void; machine: string | null; part: string | null; explode: number;
  setExplode: (e: number) => void; guides: boolean; xray: boolean; toggleXray: () => void; labels: boolean; toggleGuides: () => void; toggleLabels: () => void;
  onIsolate: () => void; onExploded: () => void; onPart: (id: string) => void; onLocate: (f: Fault) => void; onFramePart: () => void;
  onInject: (machineId: string, code: string) => void; onClear: (f: Fault) => void; animateAssembly: () => void; reset: () => void;
  act: (a: Action) => void; me: string; onRepair: (f: Fault) => void; onClaim: (machineId: string) => void;
  alarms: BackendEvent[]; onMachine: (machineId: string) => void;
}

/** Compact command bar: neutral icon + label buttons, colour only on the button's state meaning. */
function CommandBar({ items }: { items: [string, string, () => void, boolean?, ("green" | "red" | "amber" | "sky")?][] }) {
  return (
    <div className="grid grid-cols-5 gap-1">
      {items.map(([icon, label, fn, disabled, c]) => (
        <button key={label} onClick={fn} disabled={disabled}
                className={`flex flex-col items-center gap-0.5 rounded-[4px] border border-hmi-line bg-hmi-raised py-1.5 text-[10px] transition-colors hover:border-white/20 disabled:opacity-35 ${c === "green" ? "text-ok" : c === "red" ? "text-alarm" : c === "amber" ? "text-warn" : c === "sky" ? "text-sel" : "text-hmi-text"}`}>
          <span className="text-[13px] leading-none">{icon}</span>{label}</button>))}
    </div>
  );
}

function LineControls({ sim, reset, act }: { sim: TwinSim; reset: () => void; act: (a: Action) => void }) {
  const st = sim.line.state;
  return (
    <div className="space-y-3">
      <CommandBar items={[
        ["▶", "Start", () => act({ m: "line", state: "RUNNING" }), st === "RUNNING", "green"],
        ["❚❚", "Pause", () => act({ m: "line", state: "PAUSED" }), st !== "RUNNING"],
        ["↺", "Reset", () => act({ m: "reset", id: "PLC" }), st !== "ESTOP", "sky"],
        ["⏭", "Step", () => sim.stepCycle(), st === "RUNNING" || st === "ESTOP"],
        ["⟲", "Restart", reset],
      ]} />
      <GuardedEstop latched={st === "ESTOP"} onPress={() => act({ m: "estop" })} onReset={() => act({ m: "reset", id: "PLC" })} label="LINE E-STOP" />
      {sim.interlock() && <p className="rounded-[4px] border border-alarm/40 px-2 py-1.5 text-[11px] text-alarm">Line interlock: an operator mistake damaged a part. Repair the red component, then Start.</p>}
      <div>
        <H>Line parameters</H>
        <ValueControl label="Master line speed" unit="%" min={0} max={150} step={1} value={sim.line.speedPct} onChange={(v) => { sim.line.speedPct = v; }} />
        <ValueControl label="Conveyor belt speed" unit="m/s" min={0} max={1.2} step={0.01} value={sim.rt.CNV.set.speed} actual={sim.rt.CNV.act.speed} safe={1.08} onChange={(v) => act({ m: "set", id: "CNV", key: "speed", v })} />
        <ValueControl label="AGV fleet speed" unit="m/s" min={0} max={2} step={0.05} value={sim.rt.AGV1.set.speed} onChange={(v) => sim.setFleetSpeed(v)} />
        <ValueControl label="Workpiece spawn interval" unit="s" min={2} max={30} step={0.5} value={sim.line.spawnInterval} onChange={(v) => { sim.line.spawnInterval = v; }} />
        <ValueControl label="Hall lighting" unit="×" min={0.2} max={2} step={0.05} value={sim.line.lighting} onChange={(v) => { sim.line.lighting = v; }} />
        <ValueControl label="Ghost opacity (isolate)" unit="" min={0} max={0.6} step={0.01} value={sim.line.ghost} onChange={(v) => { sim.line.ghost = v; }} />
      </div>
      <div>
        <H>Scenarios</H>
        <div className="grid grid-cols-2 gap-1">
          {([["normal", "Normal shift"], ["peak", "Peak throughput"], ["changeover", "Changeover"], ["lockout", "Maintenance lockout"], ["fault", "Simulated line fault"]] as const).map(([k, l]) => (
            <Btn key={k} c={k === "fault" ? "red" : "slate"} onClick={() => sim.scenario(k)}>{l}</Btn>))}
        </div>
      </div>
      <div className="text-[11px]"><Row k="Dispenser stock" v={`${sim.stock} carriers`} /><Row k="Pallet" v={`${sim.pallet.filter((x) => x !== null && x >= 0).length} / 9`} /></div>
    </div>
  );
}

function MachineControls({ sim, id, onIsolate, onXray, act, me, onClaim }: { sim: TwinSim; id: string; onIsolate: () => void; onXray: () => void; act: (a: Action) => void; me: string; onClaim: (id: string) => void }) {
  const m = MACHINE[id], rt = sim.rt[id], owner = sim.owner[id], locked = !!owner && owner !== me;
  const stColor = rt.status === "FAULT" ? "text-alarm" : rt.status === "RUN" ? "text-ok" : "text-hmi-muted";
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-[3px] border border-hmi-line bg-hmi-line text-center">
        {[["Status", <span className={stColor}>{rt.status}</span>], ["Mode", <span className={rt.manual ? "text-warn" : ""}>{rt.manual ? "MANUAL" : "AUTO"}</span>], ["Cycles", rt.cycles]].map(([k, v]) => (
          <div key={k as string} className="bg-hmi-panel py-1"><div className="text-[9px] uppercase tracking-wider text-hmi-dim">{k}</div><div className="num text-[11px]">{v}</div></div>))}
      </div>
      <div className="flex items-center gap-2 text-[11px]">
        <span className="flex-1 text-hmi-muted">{owner ? <>Operated by <span className="text-hmi-text">{owner}</span></> : "Unclaimed · automatic cycle"}</span>
        <Btn c={owner === me ? "slate" : "sky"} onClick={() => onClaim(id)} disabled={locked}>{owner === me ? "Release" : "Take control"}</Btn>
      </div>
      <fieldset disabled={locked} className="space-y-3 disabled:opacity-50">
        <CommandBar items={[
          ["▶", "Start", () => act({ m: "start", id }), rt.status === "RUN", "green"],
          ["■", "Stop", () => act({ m: "stop", id })],
          ["↺", "Reset", () => act({ m: "reset", id }), false, "sky"],
          ["⌂", "Home", () => sim.home(id)],
          ["⏭", "Step", () => sim.stepCycle(id)],
        ]} />
        <GuardedEstop latched={sim.line.state === "ESTOP"} onPress={() => act({ m: "estop", id })} onReset={() => act({ m: "reset", id })} />
        <div className="grid grid-cols-3 gap-1">
          <Btn onClick={() => act({ m: "mode", id })} c={rt.manual ? "amber" : "slate"}>{rt.manual ? "Manual" : "Auto"} mode</Btn>
          <Btn onClick={onIsolate}>Isolate</Btn>
          <Btn onClick={onXray}>X-Ray</Btn>
        </div>
        <div>
          <H>Setpoint / actual</H>
          {m.controls.map((c) => (
            <ValueControl key={c.key} label={c.label} unit={c.unit} min={c.min} max={c.max} step={c.step} value={rt.set[c.key] ?? 0} actual={rt.act[c.key]}
                          safe={!/J\d$/.test(c.key) && c.key !== "grip" ? +(c.min + 0.9 * (c.max - c.min)).toFixed(2) : undefined} onChange={(v) => act({ m: "set", id, key: c.key, v })} />
          ))}
        </div>
      </fieldset>
      <p className="text-[11px] leading-relaxed text-hmi-muted">{m.description}</p>
    </div>
  );
}

function Exploded(p: Props) {
  const m = p.machine ? MACHINE[p.machine] : null;
  if (!m) return <p className="text-[11px] text-hmi-muted">Select a machine in 3D or in the tree to open its exploded view (vue éclatée) and bill of materials.</p>;
  return (
    <div className="space-y-2">
      <ValueControl label="Explode (vue éclatée)" unit="%" min={0} max={100} step={1} value={Math.round(p.explode * 100)} onChange={(v) => p.setExplode(v / 100)} />
      <div className="flex gap-1">
        {[0, 0.5, 1].map((v) => <Btn key={v} c={Math.abs(p.explode - v) < 0.01 ? "sky" : "slate"} className="flex-1" onClick={() => p.setExplode(v)}>{v * 100}%</Btn>)}
        <Btn c={p.xray ? "sky" : "slate"} className="flex-1" onClick={p.toggleXray}>X-Ray</Btn>
        <Btn className="flex-1" onClick={p.animateAssembly} title="Animate the assembly sequence">Sequence</Btn>
      </div>
      <div className="flex gap-3 text-[11px] text-hmi-muted">
        <label className="flex items-center gap-1"><input type="checkbox" checked={p.guides} onChange={p.toggleGuides} className="accent-[#3b82f6]" /> Axis guides</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={p.labels} onChange={p.toggleLabels} className="accent-[#3b82f6]" /> All labels</label>
      </div>
      <table className="w-full text-[11px]">
        <thead className="text-left text-[9px] uppercase tracking-wider text-hmi-dim"><tr><th className="font-normal">P/N</th><th className="font-normal">Component</th><th className="font-normal">Cat.</th></tr></thead>
        <tbody>{m.subAssemblies.map((s) => [
          <tr key={s.id}><td colSpan={3} className="pt-2 text-[10px] font-semibold text-hmi-muted">{s.name}</td></tr>,
          ...s.parts.map((x) => (
            <tr key={x.id} onClick={() => p.onPart(x.id)} className={`cursor-pointer border-t border-hmi-line/50 ${p.part === x.id ? "bg-sel/15" : "hover:bg-white/[.04]"}`}>
              <td className="num py-[3px] text-hmi-dim">{x.partNumber}</td>
              <td className="py-[3px]"><span className="flex items-center gap-1.5">{p.sim.partFault(x.id) && <Dot level={p.sim.partFault(x.id)!.severity} />}<span className={p.sim.partFault(x.id) ? "text-alarm" : ""}>{x.name}</span></span></td>
              <td className="text-hmi-dim">{x.category.slice(0, 4)}</td>
            </tr>)),
        ])}</tbody>
      </table>
    </div>
  );
}

/** Live I/O inspector (Factory I/O tags): DI / DO with force On / Off / release, AI / AO with 0-10 V scaling. */
function IoTable(p: Props) {
  if (!p.machine) return <p className="text-[11px] text-hmi-muted">Select a machine to see its I/O tags.</p>;
  const id = p.machine, tags = ioTags(p.sim, id);
  const force = (tag: string, v: number | null, part?: string) => p.act({ m: "force", id, tag, v, part });
  return (
    <div className="space-y-2 text-[11px]">
      <p className="text-hmi-dim">Forcing a sensor overrides its signal; on a part with a failure mode it injects that fault.</p>
      {(["DI", "DO", "AI", "AO"] as const).map((k) => (
        <section key={k}>
          <H>{{ DI: "DI · sensor → PLC", DO: "DO · PLC → actuator", AI: "AI · actual (0-10 V)", AO: "AO · setpoint (0-10 V)" }[k]}</H>
          <table className="w-full">
            <tbody>{tags.filter((t) => t.kind === k).map((t) => (
              <tr key={t.name} className={`border-t border-hmi-line/50 ${t.forced ? "shadow-[inset_2px_0_0_var(--color-warn)]" : ""}`}>
                <td className="max-w-0 truncate py-[3px] pl-1 pr-1 text-hmi-muted" title={t.name}>{t.partId ? partById(t.partId)?.name ?? t.name : t.name.split(".").slice(1).join(".")}</td>
                {typeof t.value === "boolean"
                  ? <td className="w-6"><span className={`inline-block h-2 w-2 rounded-full ${t.value ? "bg-ok" : "border border-hmi-dim"}`} /></td>
                  : <td className="num w-32 text-right">{t.value.toFixed(2)} <span className="text-hmi-dim">{t.unit} · {t.volts}V</span></td>}
                <td className="w-20 text-right">{typeof t.value === "boolean" && (t.forced
                  ? <button onClick={() => force(t.name, null)} className="num rounded-[3px] border border-warn/50 px-1 text-[10px] text-warn">FORCED ✕</button>
                  : <span className="text-hmi-dim"><button onClick={() => force(t.name, 1, t.partId)} className="px-1 hover:text-hmi-text">1</button>
                      <button onClick={() => force(t.name, 0, t.partId)} className="px-1 hover:text-hmi-text">0</button></span>)}</td>
              </tr>))}</tbody>
          </table>
        </section>))}
    </div>
  );
}

function Diagnostics(p: Props) {
  const [mid, setMid] = useState(p.machine ?? "PRS");
  const [code, setCode] = useState("");
  const specs = MACHINE[mid].faults;
  const sel = code && specs.some((f) => f.code === code) ? code : specs[0]?.code ?? "";
  const fmt = (t: number) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  const select = "w-full rounded-[4px] border border-hmi-line bg-hmi-bg px-1.5 py-1 text-[11px]";
  return (
    <div className="space-y-3 text-[11px]">
      <section>
        <H>Active alarms ({p.sim.faults.length})</H>
        {p.sim.interlock() && <p className="mb-1.5 rounded-[4px] border border-alarm/40 px-2 py-1.5 text-alarm">Line interlock: repair the red component, then Start.</p>}
        {p.sim.faults.length === 0 && <p className="text-hmi-dim">No active alarm.</p>}
        {p.sim.faults.map((f) => (
          <div key={f.id} className={`mb-1.5 rounded-[4px] border border-hmi-line p-2 ${f.severity === "critical" ? "shadow-[inset_3px_0_0_var(--color-alarm)]" : "shadow-[inset_3px_0_0_var(--color-warn)]"} ${f.acknowledged ? "opacity-70" : ""}`}>
            <div className="flex items-center gap-2"><Dot level={f.severity} /><span className="num">{f.id}</span><span className="num text-hmi-dim">{fmt(f.t)}</span>
              <span className="num ml-auto text-[10px] text-hmi-dim">{f.code}</span></div>
            <div className="mt-0.5">{MACHINE[f.machineId].name} → <span className={f.severity === "critical" ? "text-alarm" : "text-warn"}>{partById(f.partId)?.name}</span></div>
            <div className="text-hmi-muted">{f.label}{f.source === "backend" ? " · from line / AI" : f.source === "player" ? " · operator mistake" : ""}</div>
            <div className="mt-1.5 grid grid-cols-4 gap-1">
              <Btn onClick={() => p.onLocate(f)}>Locate</Btn>
              <Btn onClick={() => p.sim.acknowledge(f.id)} disabled={f.acknowledged}>Ack</Btn>
              <Btn c="amber" onClick={() => p.onRepair(f)} disabled={!!p.sim.repairs[f.id]}>{p.sim.repairs[f.id] ? `${p.sim.repairs[f.id].left.toFixed(1)}s` : "Repair"}</Btn>
              <Btn onClick={() => p.onClear(f)}>Clear</Btn>
            </div>
          </div>
        ))}
      </section>
      <RootCause alarms={p.alarms} onMachine={p.onMachine} />
      <section className="space-y-1.5">
        <H>Fault simulator</H>
        <select value={mid} onChange={(e) => setMid(e.target.value)} aria-label="machine" className={select}>
          {Object.values(MACHINE).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <select value={sel} onChange={(e) => setCode(e.target.value)} aria-label="fault" className={select}>
          {specs.map((f) => <option key={f.code} value={f.code}>{f.label} ({f.severity})</option>)}
        </select>
        <div className="flex gap-1"><Btn c="red" className="flex-1" onClick={() => p.onInject(mid, sel)}>Trigger fault</Btn>
          <Btn className="flex-1" onClick={() => p.sim.faults.slice().forEach((f) => p.onClear(f))} disabled={!p.sim.faults.length}>Clear all</Btn></div>
      </section>
      <section>
        <H>Event log</H>
        <div className="num max-h-56 space-y-0.5 overflow-y-auto text-[10.5px]">
          {p.sim.events.slice(0, 60).map((e, i) => (
            <div key={i} className={e.level === "fault" ? "text-alarm" : e.level === "warning" ? "text-warn" : "text-hmi-muted"}>
              <span className="text-hmi-dim">{fmt(e.t)}</span> {e.text}
            </div>))}
        </div>
      </section>
    </div>
  );
}

export function RightPanel(p: Props) {
  const part = p.part ? partById(p.part) : undefined;
  const tabs: [Tab, string][] = [["controls", "Controls"], ["exploded", "Exploded / BOM"], ["io", "I/O"], ["diagnostics", "Faults"]];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="tablist" className="flex gap-3 border-b border-hmi-line px-3">
        {tabs.map(([t, l]) => (
          <button key={t} role="tab" aria-selected={p.tab === t} onClick={() => p.setTab(t)}
                  className={`-mb-px border-b py-2 text-[11px] transition-colors ${p.tab === t ? "border-sel text-hmi-text" : "border-transparent text-hmi-muted hover:text-hmi-text"}`}>
            {l}{t === "diagnostics" && p.sim.faults.length > 0 && <span className="num ml-1 text-alarm">{p.sim.faults.length}</span>}
          </button>))}
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {part && <PartCard sim={p.sim} part={part} onLocate={p.onFramePart} onRepair={p.onRepair} onInject={p.onInject} onClear={p.onClear} />}
        {p.tab === "controls" && (p.machine
          ? <MachineControls sim={p.sim} id={p.machine} onIsolate={p.onIsolate} onXray={p.toggleXray} act={p.act} me={p.me} onClaim={p.onClaim} />
          : <LineControls sim={p.sim} reset={p.reset} act={p.act} />)}
        {p.tab === "exploded" && <Exploded {...p} />}
        {p.tab === "io" && <IoTable {...p} />}
        {p.tab === "diagnostics" && <Diagnostics {...p} />}
      </div>
    </div>
  );
}

/** T23 root-cause panel: propagation graph of the line with the root and its path highlighted (T15), Bayesian
 *  posteriors over the root machine and the fault family (T19), the explanation (T22) and the alarm timeline. */
function RootCause({ alarms, onMachine }: { alarms: BackendEvent[]; onMachine: (id: string) => void }) {
  const latest = alarms.find((a) => a.payload?.diagnosis);
  if (!latest) return (<section><H>Root cause</H><p className="text-hmi-dim">No AI alarm from the line. The diagnosis (propagation graph + Bayesian network) appears here when the backend detector raises one.</p></section>);
  const d = latest.payload!.diagnosis!, nodes = ["M1", "M2", "M3", "M4", "M5", "M6"], alarmed = new Set(alarms.slice(0, 12).map((a) => a.machine_id));
  const onPath = (a: string, b: string) => d.path.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  const X = (i: number) => 14 + i * 50;
  const bar = (rows: [string, number][], fmt: (k: string) => string) => rows.map(([k, v]) => (
    <div key={k} className="flex items-center gap-2"><span className="w-24 truncate text-hmi-muted">{fmt(k)}</span>
      <span className="h-1 flex-1 rounded bg-hmi-raised"><span className="block h-1 rounded bg-hmi-muted" style={{ width: `${v * 100}%` }} /></span><span className="num w-9 text-right">{(v * 100).toFixed(0)}%</span></div>));
  const name = (b: string) => (BACKEND_TO_MACHINE[b] ? MACHINE[BACKEND_TO_MACHINE[b]].name.split(" ")[0] : b);
  return (
    <section className="space-y-2">
      <H>Root cause · propagation graph</H>
      <svg viewBox="0 0 280 54" className="w-full" role="img" aria-label={`Root cause ${d.root}`}>
        {nodes.slice(0, -1).map((n, i) => (
          <line key={n} x1={X(i) + 9} y1={20} x2={X(i + 1) - 9} y2={20} stroke={onPath(n, nodes[i + 1]) ? "var(--color-warn)" : "#2a313d"} strokeWidth={onPath(n, nodes[i + 1]) ? 2 : 1} markerEnd="url(#arr)" />))}
        <defs><marker id="arr" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#5b6475" /></marker></defs>
        {nodes.map((n, i) => {
          const root = n === d.root, ex = d.explained.includes(n);
          return (
            <g key={n} onClick={() => BACKEND_TO_MACHINE[n] && onMachine(BACKEND_TO_MACHINE[n])} className="cursor-pointer">
              <circle cx={X(i)} cy={20} r={9} fill="#141820" stroke={root ? "var(--color-alarm)" : ex ? "var(--color-warn)" : alarmed.has(n) ? "#8a94a6" : "#2a313d"} strokeWidth={root ? 2.5 : 1.5} />
              <text x={X(i)} y={23.5} textAnchor="middle" fontSize="8.5" fill="#e6eaf0" fontFamily="var(--font-mono)">{n}</text>
              <text x={X(i)} y={44} textAnchor="middle" fontSize="7" fill={root ? "var(--color-alarm)" : "#8a94a6"}>{name(n)}</text>
            </g>);
        })}
      </svg>
      <div className="text-[11px]">
        <Row k="Root cause (graph, T15)" v={<span className="text-alarm">{d.root ? `${d.root} · ${name(d.root)}` : "-"}</span>} />
        <Row k="Consequences" v={d.explained.length ? d.explained.join(", ") : "none"} />
      </div>
      {d.bayes_root && <div className="space-y-1 text-[11px]"><div className="text-[10px] text-hmi-dim">Bayesian network (T19) · P(root)</div>{bar(d.bayes_root, (k) => (k === "none" ? "no fault" : `${k} ${name(k)}`))}</div>}
      {d.family && <div className="space-y-1 text-[11px]"><div className="text-[10px] text-hmi-dim">Fault family on {d.root}</div>{bar(d.family, (k) => k)}</div>}
      {latest.payload?.explanation && <p className="border-l-2 border-hmi-line pl-2 text-[11px] text-hmi-muted">{latest.payload.explanation}</p>}
      <div className="num space-y-0.5 text-[10.5px]">
        {alarms.slice(0, 8).map((a, i) => (
          <div key={i} className="flex gap-2"><span className="text-hmi-dim">{a.received ? new Date(a.received).toLocaleTimeString() : ""}</span>
            <span className={a.machine_id === d.root ? "text-alarm" : "text-hmi-muted"}>{a.machine_id}</span><span className="truncate text-hmi-muted">{a.fault_code ?? "anomaly"}{a.payload?.is_root_cause ? " · root" : ""}</span></div>))}
      </div>
    </section>
  );
}
