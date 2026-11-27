// Play mode (T27): you are the maintenance supervisor for one 8-hour shift; the AI plays the same shift.
import { useEffect, useState } from "react";
import { api } from "./api";

const LOTO_STEPS = [
  "Machine stopped and isolator switched OFF",
  "My padlock and tag are on the isolator",
  "Zero energy verified (START pressed, voltage measured)",
];
const STATUS: Record<string, string> = {
  working: "#22c55e", idle: "#64748b", starved: "#ca8a04", blocked: "#ea580c", down: "#ef4444", maintenance: "#3b82f6", stopped: "#475569",
};

interface Game {
  session: string; seed: number; done: boolean; score: number; safety_violations: number; last_message: string;
  loto_required: boolean[]; sensors: Record<string, number>[]; ai?: Record<string, number>;
  snapshot: { t_min: number; kpi: Record<string, number>; machines: { id: string; status: string; wear: number; worker: string | null }[];
    workers: { id: string; skill: string; task: unknown }[] };
}

const btn = "rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-40";

export default function Play() {
  const [g, setG] = useState<Game | null>(null);
  const [seed, setSeed] = useState(7);
  const [pending, setPending] = useState<number | null>(null);
  const [checks, setChecks] = useState<number[]>([]);
  const [auto, setAuto] = useState(false);
  const [err, setErr] = useState("");

  const start = () => api<Game>("/play/new", { seed }).then((r) => { setG(r); setAuto(false); setErr(""); }).catch((e) => setErr(e.message));
  const step = (action: number, loto = false) =>
    g && api<Game>(`/play/${g.session}/step`, { action, loto_confirmed: loto }).then(setG).catch((e) => setErr(e.message));

  useEffect(() => {
    if (!auto || !g || g.done) return;
    const t = setTimeout(() => step(0), 600);
    return () => clearTimeout(t);
  }, [auto, g]);

  const act = (action: number) => {
    if (g?.loto_required[action]) { setPending(action); setChecks([]); return; }
    step(action);
  };

  if (!g) return (
    <div className="mx-auto mt-10 max-w-xl rounded-2xl border border-white/10 bg-slate-900 p-6 text-slate-200">
      <h2 className="mb-2 text-xl font-semibold text-white">Play: run the maintenance of one shift</h2>
      <p className="mb-4 text-sm text-slate-300">Machines wear out and break. Each turn = 5 minutes. Send workers to repair or plan preventive
        maintenance. Every minute of line stop costs money, good parts earn money. Before any locked-out intervention you must confirm the
        lockout/tagout (LOTO) steps. At the end your profit is compared with the AI and the classic strategies on exactly the same shift.</p>
      <label className="mb-4 flex items-center gap-2 text-sm">Shift number
        <input type="number" min={0} max={10000} value={seed} onChange={(e) => setSeed(+e.target.value)}
               className="w-24 rounded border border-white/10 bg-slate-800 px-2 py-1" />
      </label>
      <button onClick={start} className={`${btn} bg-sky-600 text-white hover:bg-sky-500`}>Start the shift</button>
      {err && <p className="mt-3 text-sm text-red-400">{err} — is the API running (docker compose up)?</p>}
    </div>
  );

  const s = g.snapshot;
  return (
    <div className="flex-1 overflow-y-auto p-4 text-slate-200">
      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
        <b>Shift {g.seed}</b><span>{Math.round(s.t_min)} / 480 min</span><span>score <b className="text-white">{g.score} €</b></span>
        <span>parts {s.kpi.parts_ok}</span><span>downtime {Math.round(s.kpi.line_down_min)} min</span>
        {g.safety_violations > 0 && <span className="text-red-400">{g.safety_violations} LOTO violation(s)</span>}
        <span className="flex-1" />
        <button onClick={() => step(0)} disabled={g.done} className={`${btn} bg-slate-700 hover:bg-slate-600`}>⏭ Wait 5 min</button>
        <button onClick={() => setAuto(!auto)} disabled={g.done} className={`${btn} bg-slate-700 hover:bg-slate-600`}>{auto ? "⏸ Pause" : "▶ Auto"}</button>
        <button onClick={() => setG(null)} className={`${btn} bg-sky-600 text-white hover:bg-sky-500`}>New shift</button>
      </div>
      {g.last_message && <div className="mb-3 rounded-lg bg-red-900/60 px-3 py-2 text-sm">{g.last_message}</div>}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
        {s.machines.map((m, i) => (
          <div key={m.id} className="flex flex-col gap-1 rounded-xl border-2 bg-slate-900 p-3" style={{ borderColor: STATUS[m.status] ?? "#64748b" }}>
            <h3 className="flex items-center gap-2 font-semibold"><span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS[m.status] }} />{m.id}</h3>
            <div className="text-sm">{m.status}{m.worker ? ` · ${m.worker}` : ""}</div>
            <div className="text-xs text-slate-400">wear {Math.round(m.wear * 100)}%</div>
            <dl className="font-mono text-xs">{Object.entries(g.sensors[i] ?? {}).map(([k, v]) => (
              <div key={k} className="flex justify-between border-b border-white/5"><dt className="text-slate-500">{k}</dt><dd>{v}</dd></div>))}</dl>
            <button disabled={g.done} onClick={() => act(1 + i)} className={`${btn} mt-1 bg-sky-700 hover:bg-sky-600`}>🔧 Send worker</button>
            <button disabled={g.done} onClick={() => act(7 + i)} className={`${btn} bg-slate-700 hover:bg-slate-600`}>🛠 Preventive</button>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-slate-400">Workers: {s.workers.map((w) => `${w.id} (${w.skill}) ${w.task ? "busy" : "free"}`).join(" · ")}</p>

      {pending !== null && (
        <div role="dialog" aria-modal="true" aria-label="Lockout tagout" className="fixed inset-0 z-20 grid place-items-center bg-black/70 p-4">
          <div className="max-w-md rounded-2xl border border-white/10 bg-slate-900 p-5">
            <h3 className="mb-3 font-semibold text-white">Lockout / tagout required</h3>
            {LOTO_STEPS.map((t, k) => (
              <label key={k} className="mb-2 flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1 accent-emerald-500" checked={checks.includes(k)}
                       onChange={(e) => setChecks(e.target.checked ? [...checks, k] : checks.filter((c) => c !== k))} /> {t}
              </label>
            ))}
            <div className="mt-3 flex flex-wrap gap-2">
              <button disabled={checks.length < LOTO_STEPS.length} onClick={() => { step(pending, true); setPending(null); }}
                      className={`${btn} bg-emerald-600 text-white hover:bg-emerald-500`}>Confirm & intervene</button>
              <button onClick={() => { step(pending, false); setPending(null); }} className={`${btn} bg-red-600 text-white hover:bg-red-500`}>Skip LOTO</button>
              <button onClick={() => setPending(null)} className={`${btn} bg-slate-700 hover:bg-slate-600`}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {g.done && (
        <div className="mt-4 max-w-md rounded-2xl border border-white/10 bg-slate-900 p-4">
          <h2 className="mb-2 text-lg font-semibold text-white">Shift over - your score: {g.score} €</h2>
          <table className="w-full text-sm"><tbody>
            {Object.entries(g.ai ?? {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => <tr key={k}><td className="py-0.5">{k}</td><td className="text-right font-mono">{v} €</td></tr>)}
            <tr className="font-bold text-amber-300"><td>you</td><td className="text-right font-mono">{g.score} €</td></tr>
          </tbody></table>
        </div>
      )}
    </div>
  );
}
