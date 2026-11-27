// Small client for the RootTwin API (same origin in production, proxied by Vite in dev).
import { useEffect, useRef, useState } from "react";

export async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail ?? res.status));
  return data;
}

export const command = (target, command, params = {}) =>
  api(`/command/line1/${target}`, { command, params, issued_by: "ui" });

// Live state over WebSocket: latest snapshot + rolling list of events/alarms. Reconnects automatically.
export function useLive() {
  const [snapshot, setSnapshot] = useState(null);
  const [events, setEvents] = useState([]);
  const [connected, setConnected] = useState(false);
  const retry = useRef(0);
  useEffect(() => {
    let ws, timer, closed = false;
    const open = () => {
      ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
      ws.onopen = () => { setConnected(true); retry.current = 0; };
      ws.onmessage = (m) => {
        const msg = JSON.parse(m.data);
        if (msg.type === "snapshot") setSnapshot(msg.data);
        else setEvents((e) => [msg.data, ...e].slice(0, 60));
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closed) timer = setTimeout(open, Math.min(1000 * 2 ** retry.current++, 10000));
      };
    };
    open();
    return () => { closed = true; clearTimeout(timer); ws && ws.close(); };
  }, []);
  return { snapshot, events, connected };
}

export const STATUS_COLOR = {
  working: "#2E9E6B", idle: "#7f8c8d", starved: "#b7950b", blocked: "#d68910",
  down: "#c0392b", maintenance: "#2E6FDB", stopped: "#5d6d7e",
};

export function machineColor(m) {
  if (!m) return "#7f8c8d";
  if (m.status === "down") return STATUS_COLOR.down;
  if (m.status === "maintenance") return STATUS_COLOR.maintenance;
  if (m.state === "degraded") return "#E8892B";
  return STATUS_COLOR[m.status] ?? "#7f8c8d";
}
