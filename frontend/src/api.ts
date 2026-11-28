// Client for the RootTwin backend (same origin in production, proxied by Vite in dev).
import { useEffect, useRef, useState } from "react";

export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail ?? res.status));
  return data as T;
}

export const command = (target: string, name: string, params: Record<string, unknown> = {}) =>
  api(`/command/line1/${target}`, { command: name, params, issued_by: "ui" });

export interface BackendMachine { id: string; status: string; state: string; faults: string[]; worker: string | null; wear: number }
export interface BackendSnapshot {
  t_min: number; running: boolean; machines: BackendMachine[];
  sensors?: Record<string, Record<string, number>>; kpi: Record<string, number>;
  components?: Record<string, BackendComponent[]>;        // backend machine id -> per-component state
}
export interface BackendComponent {
  id: string; name: string; kind: string; health: number;
  channels: Record<string, { value: number; unit: string }>;
  fault: { code: string; state: string; progress: number } | null;
}
export interface BackendEvent {
  machine_id: string; event_type: string; fault_code?: string | null; state?: string | null;
  received?: number;                                     // client time the event arrived (ms)
  payload?: { explanation?: string; root_cause?: string; is_root_cause?: boolean; component?: string | null;
    diagnosis?: { root: string | null; explained: string[]; path: [string, string][]; ranking: [string, number][];
      bayes_root?: [string, number][]; family?: [string, number][] };
    copilot?: { text: string; sources: string[]; mode: string } | null; candidates?: { fault_code: string; match: number }[] };
}

/** Live backend link over WebSocket; reconnects with back-off. Works without a backend (connected = false). */
export function useLive() {
  const [snapshot, setSnapshot] = useState<BackendSnapshot | null>(null);
  const [events, setEvents] = useState<BackendEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const retry = useRef(0);
  useEffect(() => {
    let ws: WebSocket | undefined, timer: ReturnType<typeof setTimeout> | undefined, closed = false;
    const open = () => {
      ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
      ws.onopen = () => { setConnected(true); retry.current = 0; };
      ws.onmessage = (m) => {
        const msg = JSON.parse(m.data);
        if (msg.type === "snapshot") setSnapshot(msg.data);
        else setEvents((e) => [{ ...msg.data, received: Date.now() }, ...e].slice(0, 60));
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closed) timer = setTimeout(open, Math.min(1000 * 2 ** retry.current++, 15000));
      };
    };
    open();
    return () => { closed = true; clearTimeout(timer); ws?.close(); };
  }, []);
  return { snapshot, events, connected };
}
