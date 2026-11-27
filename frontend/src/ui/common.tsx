// Small shared UI pieces (dark matte industrial style, tabular numbers).
import type { ReactNode } from "react";
import type { TwinSim } from "../twin/sim";

export const btn = "rounded-md px-2.5 py-1 text-xs font-medium transition focus-visible:outline-2 focus-visible:outline-amber-300 disabled:opacity-40";
export const tone = {
  sky: "bg-sky-600 text-white hover:bg-sky-500", slate: "bg-slate-700 text-slate-100 hover:bg-slate-600",
  red: "bg-red-600 text-white hover:bg-red-500", green: "bg-emerald-600 text-white hover:bg-emerald-500",
  amber: "bg-amber-500 text-slate-950 hover:bg-amber-400", ghost: "bg-slate-800/80 text-slate-300 hover:bg-slate-700",
};

export function Btn({ c = "slate", children, ...p }: { c?: keyof typeof tone; children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...p} className={`${btn} ${tone[c]} ${p.className ?? ""}`}>{children}</button>;
}

export function Dot({ level }: { level: "critical" | "warning" | "ok" | "off" }) {
  const c = { critical: "bg-red-500 shadow-[0_0_6px_#ef4444]", warning: "bg-amber-400", ok: "bg-emerald-500", off: "bg-slate-500" }[level];
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${c}`} aria-label={level} />;
}

/** Health of a machine (or a set of parts) for the status dots that bubble up the tree. */
export function levelOf(sim: TwinSim, machineIds: string[], partIds?: string[]): "critical" | "warning" | "ok" | "off" {
  const fs = sim.faults.filter((f) => machineIds.includes(f.machineId) && (!partIds || partIds.includes(f.partId)));
  if (fs.some((f) => f.severity === "critical")) return "critical";
  if (fs.length) return "warning";
  if (!partIds && machineIds.every((id) => sim.rt[id].status !== "RUN")) return "off";
  return "ok";
}

/** Slider + exact numeric input, two-way synced. */
export function ValueControl({ label, unit, min, max, step, value, actual, onChange }: {
  label: string; unit: string; min: number; max: number; step: number; value: number; actual?: number; onChange: (v: number) => void;
}) {
  const id = `vc-${label.replace(/\W/g, "")}`;
  return (
    <div className="space-y-0.5">
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <label htmlFor={id} className="text-slate-400">{label}</label>
        {actual !== undefined && <span className="tabular-nums text-slate-500">act {actual.toFixed(step < 1 ? 2 : 0)}</span>}
      </div>
      <div className="flex items-center gap-2">
        <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} className="h-1 flex-1 accent-sky-500" />
        <input type="number" min={min} max={max} step={step} value={Number(value.toFixed(3))} aria-label={`${label} exact value`}
               onChange={(e) => { const x = +e.target.value; if (Number.isFinite(x)) onChange(Math.max(min, Math.min(max, x))); }}
               className="w-20 rounded border border-white/10 bg-slate-950 px-1.5 py-0.5 text-right text-xs tabular-nums" />
        <span className="w-9 text-[10px] text-slate-500">{unit}</span>
      </div>
    </div>
  );
}
