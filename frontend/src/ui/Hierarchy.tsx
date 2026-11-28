// Left drawer: Zones -> Machines -> Sub-assemblies -> Components, 6 px status dots bubbling up, search filter.
import { useState } from "react";
import { MACHINE, ZONES } from "../twin/registry";
import type { TwinSim } from "../twin/sim";
import { Dot, levelOf } from "./common";

export function Hierarchy({ sim, machine, part, onMachine, onPart }: {
  sim: TwinSim; machine: string | null; part: string | null; onMachine: (id: string) => void; onPart: (machineId: string, partId: string) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({ logistics: true, machining: true, assembly: true, packaging: true, control: true });
  const [q, setQ] = useState("");
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const needle = q.trim().toLowerCase();
  const hit = (s: string) => !needle || s.toLowerCase().includes(needle);
  const isOpen = (k: string) => !!needle || !!open[k];               // searching expands everything that matches
  const row = "flex w-full items-center gap-2 rounded-[3px] px-1.5 py-[3px] text-left";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-2 pb-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter machines, parts, P/N…" aria-label="Filter hierarchy"
               className="w-full rounded-[4px] border border-hmi-line bg-hmi-bg px-2 py-1 text-[11px] text-hmi-text placeholder:text-hmi-dim outline-none focus:border-sel" />
      </div>
      <nav aria-label="Factory hierarchy" className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2 text-[11.5px]">
        {ZONES.map((z) => {
          const machines = z.machines.filter((mid) => {
            const m = MACHINE[mid];
            return hit(m.name) || hit(z.name) || m.subAssemblies.some((s) => s.parts.some((p) => hit(p.name) || hit(p.partNumber)));
          });
          if (!machines.length) return null;
          return (
            <div key={z.id} className="mb-1">
              <button onClick={() => toggle(z.id)} aria-expanded={isOpen(z.id)} className={`${row} text-[10px] font-semibold uppercase tracking-wider text-hmi-muted hover:text-hmi-text`}>
                <span className="w-2.5 text-hmi-dim">{isOpen(z.id) ? "▾" : "▸"}</span>
                <span className="flex-1 truncate">{z.name}</span><Dot level={levelOf(sim, z.machines)} />
              </button>
              {isOpen(z.id) && machines.map((mid) => {
                const m = MACHINE[mid];
                return (
                  <div key={mid} className="ml-2.5 border-l border-hmi-line pl-1">
                    <div className={`flex items-center rounded-[3px] ${machine === mid ? "bg-sel/15 shadow-[inset_2px_0_0_var(--color-sel)]" : "hover:bg-white/[.04]"}`}>
                      <button onClick={() => toggle(mid)} aria-label={`expand ${m.name}`} className="w-4 text-hmi-dim">{isOpen(mid) && needle ? "▾" : open[mid] ? "▾" : "▸"}</button>
                      <button onClick={() => onMachine(mid)} className="flex flex-1 items-center gap-2 py-[3px] pr-1.5 text-left text-hmi-text">
                        <span className="flex-1 truncate">{m.name}</span><Dot level={levelOf(sim, [mid])} />
                      </button>
                    </div>
                    {(open[mid] || needle) && m.subAssemblies.map((s) => {
                      const parts = s.parts.filter((p) => hit(p.name) || hit(p.partNumber) || hit(m.name));
                      if (!parts.length) return null;
                      return (
                        <div key={s.id} className="ml-3 border-l border-hmi-line pl-1">
                          <button onClick={() => toggle(s.id)} className={`${row} text-hmi-muted hover:text-hmi-text`}>
                            <span className="w-2.5 text-hmi-dim">{isOpen(s.id) ? "▾" : "▸"}</span><span className="flex-1 truncate">{s.name}</span>
                            <Dot level={levelOf(sim, [mid], s.parts.map((p) => p.id))} />
                          </button>
                          {isOpen(s.id) && parts.map((p) => {
                            const f = sim.partFault(p.id);
                            return (
                              <button key={p.id} onClick={() => onPart(mid, p.id)}
                                      className={`${row} ml-3 w-[calc(100%-0.75rem)] ${part === p.id ? "bg-sel/15 text-hmi-text shadow-[inset_2px_0_0_var(--color-sel)]" : "text-hmi-muted hover:bg-white/[.04] hover:text-hmi-text"}`}>
                                <span className="num text-[10px] text-hmi-dim">{p.partNumber}</span>
                                <span className="flex-1 truncate">{p.name}</span>
                                {f && <Dot level={f.severity} />}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          );
        })}
      </nav>
    </div>
  );
}
