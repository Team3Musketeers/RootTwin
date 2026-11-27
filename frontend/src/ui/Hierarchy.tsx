// Left panel: Factory hierarchy & BOM tree (Zone -> Machine -> Sub-assembly -> Component) with fault dots bubbling up.
import { useState } from "react";
import { MACHINE, ZONES } from "../twin/registry";
import type { TwinSim } from "../twin/sim";
import { Dot, levelOf } from "./common";

export function Hierarchy({ sim, machine, part, onMachine, onPart }: {
  sim: TwinSim; machine: string | null; part: string | null; onMachine: (id: string) => void; onPart: (machineId: string, partId: string) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({ logistics: true, machining: true, assembly: true, packaging: true, control: true });
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  return (
    <nav aria-label="Factory hierarchy" className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 text-[12px]">
      {ZONES.map((z) => (
        <div key={z.id} className="mb-1">
          <button onClick={() => toggle(z.id)} aria-expanded={!!open[z.id]} className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left font-semibold text-slate-200 hover:bg-white/5">
            <span className="w-3 text-slate-500">{open[z.id] ? "▾" : "▸"}</span>
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: z.color }} />
            <span className="flex-1 truncate">{z.name}</span><Dot level={levelOf(sim, z.machines)} />
          </button>
          {open[z.id] && z.machines.map((mid) => {
            const m = MACHINE[mid];
            return (
              <div key={mid} className="ml-4">
                <div className={`flex items-center gap-1 rounded ${machine === mid ? "bg-sky-500/20" : "hover:bg-white/5"}`}>
                  <button onClick={() => toggle(mid)} aria-label={`expand ${m.name}`} className="w-4 text-slate-500">{open[mid] ? "▾" : "▸"}</button>
                  <button onClick={() => onMachine(mid)} className="flex flex-1 items-center gap-2 py-0.5 text-left text-slate-300">
                    <span className="flex-1 truncate">{m.name}</span><Dot level={levelOf(sim, [mid])} />
                  </button>
                </div>
                {open[mid] && m.subAssemblies.map((s) => (
                  <div key={s.id} className="ml-5 border-l border-white/10 pl-2">
                    <button onClick={() => toggle(s.id)} className="flex w-full items-center gap-2 py-0.5 text-left text-slate-400 hover:text-slate-200">
                      <span className="w-3">{open[s.id] ? "▾" : "▸"}</span><span className="flex-1 truncate">{s.name}</span>
                      <Dot level={levelOf(sim, [mid], s.parts.map((p) => p.id))} />
                    </button>
                    {open[s.id] && s.parts.map((p) => {
                      const f = sim.partFault(p.id);
                      return (
                        <button key={p.id} onClick={() => onPart(mid, p.id)}
                                className={`ml-4 flex w-[calc(100%-1rem)] items-center gap-2 rounded px-1 py-0.5 text-left ${part === p.id ? "bg-sky-500/25 text-white" : "text-slate-400 hover:bg-white/5"}`}>
                          <span className="font-mono text-[10px] text-slate-500">{p.partNumber}</span>
                          <span className="flex-1 truncate">{p.name}</span>
                          {f && <Dot level={f.severity} />}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
