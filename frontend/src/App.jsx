// Observer mode (T11): run the production from the 3D factory, see the AI's alerts, ask the copilot.
import { useEffect, useMemo, useState } from "react";
import Factory3D from "./Factory3D.jsx";
import Play from "./Play.jsx";
import { api, command, machineColor, useLive } from "./api.js";

const SENSOR_UNITS = { vibration: "mm/s", temperature: "°C", current: "A", cadence: "parts/min" };

function Kpi({ k }) {
  if (!k) return null;
  const items = [
    ["Good parts", k.parts_ok], ["Scrap", k.parts_scrap], ["Throughput", `${k.throughput_per_h}/h`],
    ["Availability", `${Math.round(k.availability * 100)}%`], ["Downtime", `${Math.round(k.line_down_min)} min`],
    ["MTTR", `${k.mttr_min} min`], ["Cost", `${k.total_cost} €`],
  ];
  return <div className="kpis">{items.map(([l, v]) => <div key={l} className="kpi"><span>{l}</span><b>{v}</b></div>)}</div>;
}

function ControlPanel({ snapshot, faults, notify }) {
  const [qty, setQty] = useState(200);
  const [fault, setFault] = useState("BEARING_WEAR");
  const [target, setTarget] = useState("M3");
  const run = (t, c, p) => command(t, c, p).then(() => notify(`${c} → ${t}`)).catch((e) => notify(e.message, true));
  const scale = snapshot?.time_scale ?? 60;
  return (
    <section className="panel">
      <h3>Production</h3>
      <div className="row">
        <button onClick={() => run("LINE", "start_line")} disabled={snapshot?.running}>▶ Start</button>
        <button onClick={() => run("LINE", "pause_line")} disabled={!snapshot?.running}>⏸ Pause</button>
      </div>
      <div className="row">
        <input type="number" min={1} value={qty} onChange={(e) => setQty(+e.target.value)} aria-label="order quantity" />
        <button onClick={() => run("LINE", "create_order", { quantity: qty })}>New order</button>
      </div>
      <div className="muted">Order: {snapshot?.order?.id ?? "-"} {snapshot?.order?.left != null ? `· ${snapshot.order.left} left` : ""}</div>
      <label>Time ×{scale}
        <input type="range" min={10} max={600} step={10} value={scale}
               onChange={(e) => run("LINE", "set_time_scale", { scale: +e.target.value })} />
      </label>
      <h3>Inject a fault</h3>
      <div className="row">
        <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="machine">
          {(snapshot?.machines ?? []).map((m) => <option key={m.id}>{m.id}</option>)}
        </select>
        <select value={fault} onChange={(e) => setFault(e.target.value)} aria-label="fault">
          {faults.map((f) => <option key={f.fault_code} value={f.fault_code}>{f.fault_code}</option>)}
        </select>
      </div>
      <button className="danger" onClick={() => run(target, "inject_fault", { fault_code: fault })}>⚡ Inject</button>
    </section>
  );
}

function MachinePanel({ m, sensors, notify }) {
  const [speed, setSpeed] = useState(1);
  useEffect(() => setSpeed(m?.speed ?? 1), [m?.id]);
  if (!m) return <section className="panel"><h3>Machine</h3><p className="muted">Click a machine in the 3D view.</p></section>;
  const run = (c, p) => command(m.id, c, p).then(() => notify(`${c} → ${m.id}`)).catch((e) => notify(e.message, true));
  return (
    <section className="panel">
      <h3><span className="dot" style={{ background: machineColor(m) }} /> {m.id} · {m.status}</h3>
      <table className="sensors"><tbody>
        {Object.entries(sensors ?? {}).map(([k, v]) => <tr key={k}><td>{k}</td><td>{v} {SENSOR_UNITS[k]}</td></tr>)}
        <tr><td>wear</td><td>{Math.round(m.wear * 100)}%</td></tr>
        <tr><td>downtime</td><td>{m.down_min} min</td></tr>
        <tr><td>worker</td><td>{m.worker ?? "-"}</td></tr>
      </tbody></table>
      <label>Speed ×{speed.toFixed(1)}
        <input type="range" min={0.5} max={1.5} step={0.1} value={speed}
               onChange={(e) => setSpeed(+e.target.value)} onMouseUp={() => run("set_speed", { factor: speed })}
               onKeyUp={() => run("set_speed", { factor: speed })} />
      </label>
      <div className="row">
        <button onClick={() => run("dispatch_worker", { action: "repair" })}>🔧 Send worker</button>
        <button onClick={() => run("preventive_maintenance")}>🛠 Preventive</button>
      </div>
      <div className="row">
        <button onClick={() => run(m.enabled ? "stop_machine" : "start_machine")}>{m.enabled ? "Stop machine" : "Start machine"}</button>
      </div>
    </section>
  );
}

function Alerts({ events, onAsk }) {
  const shown = events.filter((e) => ["alarm", "failure", "repair_end", "fault_injected", "worker_dispatched"].includes(e.event_type));
  return (
    <section className="panel alerts">
      <h3>Alerts & events</h3>
      {shown.length === 0 && <p className="muted">No event yet.</p>}
      {shown.map((e, k) => (
        <div key={k} className={`event ${e.event_type}`}>
          <b>{e.machine_id}</b> {e.event_type.replace("_", " ")} {e.fault_code ? `· ${e.fault_code}` : ""}
          {e.payload?.explanation && <p>{e.payload.explanation}</p>}
          {e.payload?.root_cause && e.event_type === "alarm" && (
            <p className="muted">Probable root cause: <b>{e.payload.root_cause}</b>{e.payload.is_root_cause ? "" : " (this machine is a consequence)"}</p>)}
          {e.payload?.copilot?.text && <details><summary>Copilot: what to do ({e.payload.copilot.sources.length} sources)</summary><pre>{e.payload.copilot.text}</pre></details>}
          {e.event_type === "alarm" && <button onClick={() => onAsk(e)}>Ask the copilot</button>}
        </div>
      ))}
    </section>
  );
}

function Copilot({ context, notify }) {
  const [q, setQ] = useState("What do I do?");
  const [ans, setAns] = useState(null);
  const ask = () => api("/copilot/ask", {
    question: q, fault_codes: context?.fault_code ? [context.fault_code] : [], alert_text: context?.payload?.explanation,
  }).then(setAns).catch((e) => notify(e.message, true));
  return (
    <section className="panel">
      <h3>Copilot {context ? `· ${context.machine_id}` : ""}</h3>
      <div className="row"><input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()}
                                  aria-label="question" /><button onClick={ask}>Ask</button></div>
      {ans && <div className={`answer ${ans.mode}`}><pre>{ans.text}</pre><div className="muted">{ans.mode} · {ans.sources.join(" ")}</div></div>}
    </section>
  );
}

export default function App() {
  const [mode, setMode] = useState("observer");
  const { snapshot, events, connected } = useLive();
  const [selected, setSelected] = useState(null);
  const [station, setStation] = useState(null);
  const [faults, setFaults] = useState([]);
  const [toast, setToast] = useState(null);
  const [askCtx, setAskCtx] = useState(null);
  useEffect(() => { api("/command/faults").then(setFaults).catch(() => {}); }, []);
  const notify = (text, err) => { setToast({ text, err }); setTimeout(() => setToast(null), 3000); };
  const alarms = useMemo(() => {
    const s = new Set();
    for (const e of events) if (e.event_type === "alarm") s.add(e.machine_id);
    for (const m of snapshot?.machines ?? []) if (m.status !== "down" && m.state === "ok" && !m.faults.length) s.delete(m.id);
    return s;
  }, [events, snapshot]);
  const sel = snapshot?.machines?.find((m) => m.id === selected);
  const select = (id) => { setSelected(id); setStation(id ? +id.slice(1) - 1 : null); };

  return (
    <div className="app">
      <header>
        <h1>RootTwin</h1>
        <nav>
          <button className={mode === "observer" ? "on" : ""} onClick={() => setMode("observer")}>Observer</button>
          <button className={mode === "play" ? "on" : ""} onClick={() => setMode("play")}>Play</button>
        </nav>
        {mode === "observer" && <Kpi k={snapshot?.kpi} />}
        <span className={`conn ${connected ? "ok" : ""}`}>{connected ? `live · t=${snapshot?.t_min ?? 0} min` : "offline"}</span>
      </header>
      {mode === "play" ? <Play /> : (
        <main>
          <aside><ControlPanel snapshot={snapshot} faults={faults} notify={notify} /></aside>
          <div className="scene">
            {!snapshot && <div className="overlay">Waiting for the line… start <code>python scripts/run_line.py</code></div>}
            <Factory3D snapshot={snapshot} selected={selected} onSelect={select} alarms={alarms} station={station} />
            <div className="stations">
              <button onClick={() => select(null)} aria-label="overview">⌂</button>
              {(snapshot?.machines ?? []).map((m) => <button key={m.id} onClick={() => select(m.id)}>{m.id}</button>)}
            </div>
          </div>
          <aside>
            <MachinePanel m={sel} sensors={snapshot?.sensors?.[selected]} notify={notify} />
            <Copilot context={askCtx} notify={notify} />
            <Alerts events={events} onAsk={setAskCtx} />
          </aside>
        </main>
      )}
      {toast && <div className={`toast ${toast.err ? "err" : ""}`} role="status">{toast.text}</div>}
    </div>
  );
}
