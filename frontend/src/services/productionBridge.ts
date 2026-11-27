// Production bridge: the one place where the RootTwin backend meets the 3D twin.
//   in : WebSocket snapshot (machine state, sensors, per-component health/telemetry) + alarm events (AI detector)
//   out: line / machine commands (inject or clear a fault) through the command API
// Component ids in the backend catalogue (roottwin/faults/components.yaml) are the CAD part ids of the 3D model.
import { useEffect } from "react";
import { command, type BackendComponent, type BackendEvent, type BackendSnapshot } from "../api";
import { BACKEND_TO_MACHINE, MACHINE } from "../twin/registry";
import type { TwinSim } from "../twin/sim";

/** part id -> live component state from the backend (empty when standalone). Read by the engineering card. */
export const liveComponents = new Map<string, BackendComponent>();

/** Pick the local fault spec that matches a backend fault code (falls back to the machine's first fault). */
export function specFor(machineId: string, backendCode?: string | null, component?: string | null) {
  const m = MACHINE[machineId];
  return m.faults.find((f) => component && f.partId === component)                    // the backend located the part
    ?? m.faults.find((f) => backendCode && f.backendCodes?.includes(backendCode)) ?? m.faults[0];
}

const seen = new WeakSet<BackendEvent>();

/** Backend down/maintenance machines and AI alarms become faults in the twin; they clear when the backend recovers. */
export function syncFromBackend(sim: TwinSim, snap: BackendSnapshot | null, events: BackendEvent[]) {
  if (!snap) return;
  liveComponents.clear();
  for (const list of Object.values(snap.components ?? {})) for (const c of list) liveComponents.set(c.id, c);
  for (const bm of snap.machines) {
    const id = BACKEND_TO_MACHINE[bm.id];
    if (!id) continue;
    const down = bm.status === "down" || bm.status === "maintenance";
    const existing = sim.faults.filter((f) => f.machineId === id && f.source === "backend");
    if (down && !existing.some((f) => f.severity === "critical")) {
      const code = bm.faults[bm.faults.length - 1];
      const located = snap.components?.[bm.id]?.find((c) => c.fault?.code === code)?.id;
      const spec = specFor(id, code, located);
      if (spec && !sim.faults.some((f) => f.machineId === id && f.code === spec.code)) {
        sim.injectFault(id, spec.code, "backend", bm.status === "maintenance" ? `${spec.label} (maintenance / LOTO)` : `${spec.label} (line ${bm.id} down)`);
      }
    }
    if (!down && bm.faults.length === 0) for (const f of existing) sim.clearFault(f.id);
  }
  for (const e of events.slice(0, 10)) {
    if (e.event_type !== "alarm" || seen.has(e)) continue;
    seen.add(e);                                       // each alarm is turned into a fault once; the operator may clear it
    const id = BACKEND_TO_MACHINE[e.machine_id];
    if (!id) continue;
    const spec = specFor(id, e.fault_code, e.payload?.component);
    if (spec && !sim.faults.some((f) => f.machineId === id && f.code === spec.code)) {
      const f = sim.injectFault(id, spec.code, "backend", `AI alarm: ${spec.label}`);
      if (f && f.severity === "critical") { f.severity = "warning"; if (sim.rt[id].status === "FAULT") sim.rt[id].status = "RUN"; }  // an alarm is an early warning, not a stop
    }
  }
}

export function useBackendSync(sim: TwinSim, snap: BackendSnapshot | null, events: BackendEvent[]) {
  useEffect(() => { syncFromBackend(sim, snap, events); }, [sim, snap, events]);
}

/** Mirror a local fault injection / clear on the backend line when connected. */
export async function pushFault(machineId: string, code: string, connected: boolean, clear = false) {
  const m = MACHINE[machineId];
  if (!connected || !m.backendId) return;
  if (clear) return command(m.backendId, "clear_fault");
  const backendCode = m.faults.find((f) => f.code === code)?.backendCodes?.[0];
  if (backendCode) return command(m.backendId, "inject_fault", { fault_code: backendCode });
}
