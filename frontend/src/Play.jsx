// T27 - Play mode: you are the maintenance supervisor for one 8-hour shift; the AI plays the same shift.
import { useEffect, useState } from "react";
import { api, machineColor } from "./api.js";

const LOTO_STEPS = [
  "Machine stopped and isolator switched OFF",
  "My padlock and tag are on the isolator",
  "Zero energy verified (START pressed, voltage measured)",
];

export default function Play() {
  const [g, setG] = useState(null);
  const [seed, setSeed] = useState(7);
  const [pending, setPending] = useState(null);      // action waiting for LOTO confirmation
  const [checks, setChecks] = useState([]);
  const [auto, setAuto] = useState(false);
  const [err, setErr] = useState("");

  const start = () => api("/play/new", { seed }).then((r) => { setG(r); setAuto(false); setErr(""); }).catch((e) => setErr(e.message));
  const step = (action, loto = false) =>
    api(`/play/${g.session}/step`, { action, loto_confirmed: loto }).then(setG).catch((e) => setErr(e.message));

  useEffect(() => {
    if (!auto || !g || g.done) return;
    const t = setTimeout(() => step(0), 600);
    return () => clearTimeout(t);
  }, [auto, g]);

  const act = (action) => {
    if (g.loto_required[action]) { setPending(action); setChecks([]); return; }
    step(action);
  };

  if (!g) return (
    <div className="play-start panel">
      <h2>Play: run the maintenance of one shift</h2>
      <p>Machines wear out and break. Each turn = 5 minutes. Send workers to repair, or plan preventive maintenance.
        Every minute of line stop costs money; good parts earn money. Before any locked-out intervention you must
        confirm the lockout/tagout (LOTO) steps. At the end, your profit is compared with the AI (PPO) and the classic
        strategies on exactly the same shift.</p>
      <label>Shift number (seed) <input type="number" min={0} max={10000} value={seed} onChange={(e) => setSeed(+e.target.value)} /></label>
      <button onClick={start}>Start the shift</button>
      {err && <p className="error">{err}</p>}
    </div>
  );

  const s = g.snapshot;
  return (
    <div className="play">
      <div className="play-head">
        <b>Shift {g.seed}</b> · {Math.round(s.t_min)} / 480 min · score <b>{g.score} €</b>
        · parts {s.kpi.parts_ok} · downtime {Math.round(s.kpi.line_down_min)} min
        {g.safety_violations > 0 && <span className="error"> · {g.safety_violations} LOTO violation(s)</span>}
        <span className="spacer" />
        <button onClick={() => step(0)} disabled={g.done}>⏭ Wait 5 min</button>
        <button onClick={() => setAuto(!auto)} disabled={g.done}>{auto ? "⏸ Pause" : "▶ Auto"}</button>
        <button onClick={() => setG(null)}>New shift</button>
      </div>
      {g.last_message && <div className="toast-inline">{g.last_message}</div>}
      <div className="play-grid">
        {s.machines.map((m, i) => (
          <div key={m.id} className="play-machine" style={{ borderColor: machineColor(m) }}>
            <h3><span className="dot" style={{ background: machineColor(m) }} /> {m.id}</h3>
            <div>{m.status}{m.worker ? ` · ${m.worker}` : ""}</div>
            <div className="muted">wear {Math.round(m.wear * 100)}%</div>
            {g.sensors && <table className="sensors"><tbody>{Object.entries(g.sensors[i]).map(([k, v]) =>
              <tr key={k}><td>{k}</td><td>{v}</td></tr>)}</tbody></table>}
            <button disabled={g.done} onClick={() => act(1 + i)}>🔧 Send worker</button>
            <button disabled={g.done} onClick={() => act(7 + i)}>🛠 Preventive</button>
          </div>
        ))}
      </div>
      <div className="muted">Workers: {s.workers.map((w) => `${w.id} (${w.skill}) ${w.task ? "busy" : "free"}`).join(" · ")}</div>

      {pending != null && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Lockout tagout">
          <div className="panel">
            <h3>Lockout / tagout required</h3>
            {LOTO_STEPS.map((t, k) => (
              <label key={k} className="check"><input type="checkbox" checked={checks.includes(k)}
                onChange={(e) => setChecks(e.target.checked ? [...checks, k] : checks.filter((c) => c !== k))} /> {t}</label>
            ))}
            <div className="row">
              <button disabled={checks.length < LOTO_STEPS.length} onClick={() => { step(pending, true); setPending(null); }}>Confirm & intervene</button>
              <button onClick={() => { step(pending, false); setPending(null); }} className="danger">Skip LOTO</button>
              <button onClick={() => setPending(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {g.done && (
        <div className="panel result">
          <h2>Shift over - your score: {g.score} €</h2>
          <table><tbody>
            {Object.entries(g.ai ?? {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => <tr key={k}><td>{k}</td><td>{v} €</td></tr>)}
            <tr className="you"><td>you</td><td>{g.score} €</td></tr>
          </tbody></table>
        </div>
      )}
    </div>
  );
}
