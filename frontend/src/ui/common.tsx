// Shared HMI controls (ISA-101 high-performance style): neutral by default, colour only carries state.
import { useState, type ReactNode } from "react";
import type { TwinSim } from "../twin/sim";

export const btn = "inline-flex items-center justify-center gap-1.5 rounded-[4px] border px-2 py-1 text-[11px] font-medium transition-colors focus-visible:outline-1 focus-visible:outline-sel disabled:opacity-35 disabled:pointer-events-none";
// old tone names kept for call sites: sky = selection, green = run/ok, amber = warning/manual, red = fault/stop
export const tone = {
  slate: "border-hmi-line bg-hmi-raised text-hmi-text hover:border-white/20",
  ghost: "border-transparent bg-transparent text-hmi-muted hover:bg-white/5 hover:text-hmi-text",
  sky: "border-sel/60 bg-sel/15 text-hmi-text hover:bg-sel/25",
  green: "border-ok/40 bg-hmi-raised text-ok hover:bg-ok/10",
  amber: "border-warn/40 bg-hmi-raised text-warn hover:bg-warn/10",
  red: "border-alarm/50 bg-hmi-raised text-alarm hover:bg-alarm/10",
};

export function Btn({ c = "slate", children, ...p }: { c?: keyof typeof tone; children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...p} className={`${btn} ${tone[c]} ${p.className ?? ""}`}>{children}</button>;
}

/** Segmented control: one hairline group, active item = steel-blue selection. */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T | null; options: [T, string, boolean?][]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex h-7 overflow-hidden rounded-[4px] border border-hmi-line bg-hmi-panel">
      {options.map(([v, l, disabled]) => (
        <button key={v} onClick={() => onChange(v)} disabled={disabled} aria-pressed={value === v}
                className={`px-2.5 text-[11px] transition-colors disabled:opacity-35 ${value === v ? "bg-sel/20 text-hmi-text shadow-[inset_0_-2px_0_var(--color-sel)]" : "text-hmi-muted hover:text-hmi-text"}`}>{l}</button>
      ))}
    </div>
  );
}

export function Dot({ level }: { level: "critical" | "warning" | "ok" | "off" }) {
  const c = { critical: "bg-alarm", warning: "bg-warn", ok: "bg-ok", off: "bg-hmi-dim" }[level];
  return <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${c} ${level === "critical" ? "animate-pulse" : ""}`} aria-label={level} />;
}

/** Health of a machine (or a set of parts) for the status dots that bubble up the tree. */
export function levelOf(sim: TwinSim, machineIds: string[], partIds?: string[]): "critical" | "warning" | "ok" | "off" {
  const fs = sim.faults.filter((f) => machineIds.includes(f.machineId) && (!partIds || partIds.includes(f.partId)));
  if (fs.some((f) => f.severity === "critical")) return "critical";
  if (fs.length) return "warning";
  if (!partIds && machineIds.every((id) => sim.rt[id].status !== "RUN")) return "off";
  return "ok";
}

const fmtNum = (x: number, step: number) => x.toLocaleString("en-US", { maximumFractionDigits: step < 1 ? (step < 0.1 ? 2 : 1) : 0, minimumFractionDigits: step < 1 ? (step < 0.1 ? 2 : 1) : 0 });

/** Precision parameter row: label, setpoint / actual readout, 2 px slider, inline numeric entry. Amber above the safe limit. */
export function ValueControl({ label, unit, min, max, step, value, actual, onChange, safe }: {
  label: string; unit: string; min: number; max: number; step: number; value: number; actual?: number; onChange: (v: number) => void; safe?: number;
}) {
  const id = `vc-${label.replace(/\W/g, "")}`;
  const over = safe !== undefined && value >= safe;
  return (
    <div className="space-y-1 py-1">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="truncate text-[11px] text-hmi-muted">{label}</label>
        <span className={`num text-[11px] ${over ? "text-warn" : "text-hmi-text"}`}>
          {fmtNum(value, step)}{actual !== undefined && <span className="text-hmi-dim"> / {fmtNum(actual, step)}</span>} <span className="text-hmi-dim">{unit}</span>
        </span>
      </div>
      <div className="flex items-center gap-2">
        <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} className="hmi flex-1" />
        <input type="number" min={min} max={max} step={step} value={Number(value.toFixed(3))} aria-label={`${label} exact value`}
               onChange={(e) => { const x = +e.target.value; if (Number.isFinite(x)) onChange(Math.max(min, Math.min(max, x))); }}
               className={`hmi num w-16 rounded-[3px] border bg-hmi-bg px-1.5 py-0.5 text-right text-[11px] outline-none focus:border-sel ${over ? "border-warn/60" : "border-hmi-line"}`} />
      </div>
      {safe !== undefined && <div className="text-[10px] text-hmi-dim">safe ≤ <span className="num">{fmtNum(safe, step)}</span> {unit}{over && <span className="text-warn"> · over limit: damage in 4 s</span>}</div>}
    </div>
  );
}

/** Guarded emergency stop: flip the yellow guard, then press the red mushroom (two deliberate actions, like the real one). */
export function GuardedEstop({ onPress, latched, onReset, label = "E-STOP" }: { onPress: () => void; latched: boolean; onReset?: () => void; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`flex items-center gap-2 rounded-[4px] border px-2 py-1.5 ${latched ? "border-alarm/60 bg-alarm/10" : "border-hmi-line bg-hmi-raised"}`}>
      <button onClick={() => (open ? (onPress(), setOpen(false)) : setOpen(true))} aria-label={open ? "Press emergency stop" : "Lift emergency stop guard"}
              className={`relative grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 transition ${open ? "border-yellow-400" : "border-yellow-500/70"} bg-yellow-400/15`}>
        <span className={`h-6 w-6 rounded-full bg-gradient-to-b from-red-500 to-red-800 shadow-[inset_0_-2px_3px_rgba(0,0,0,.5)] ${latched ? "scale-90" : ""}`} />
        {!open && <span className="absolute inset-0 rounded-full border border-yellow-300/50 bg-yellow-200/10 backdrop-blur-[1px]" aria-hidden />}
      </button>
      <div className="min-w-0 flex-1 leading-tight">
        <div className={`text-[11px] font-semibold tracking-wide ${latched ? "text-alarm" : "text-hmi-text"}`}>{latched ? `${label} LATCHED` : label}</div>
        <div className="text-[10px] text-hmi-dim">{latched ? "Remove the cause, then reset" : open ? "Guard open: press to stop all motion" : "Click to lift the guard"}</div>
      </div>
      {latched && onReset && <Btn c="sky" onClick={onReset}>Reset</Btn>}
    </div>
  );
}
