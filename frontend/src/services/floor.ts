// Multiplayer factory floor client (/ws/floor): presence of the other workers, machine claims and the shared
// operator action stream. Every client runs the same TwinSim and applies the same actions, so a mistake on one
// screen (overload -> red part -> line stop) happens on all of them. Works offline: actions then apply locally only.
import { MACHINE } from "../twin/registry";
import type { TwinSim } from "../twin/sim";

export type Action =
  | { m: "start" | "stop" | "reset" | "mode"; id: string }
  | { m: "estop"; id?: string }
  | { m: "set"; id: string; key: string; v: number }
  | { m: "repair" | "clear"; id: string; code: string; by?: string }
  | { m: "fault"; id: string; code: string }
  | { m: "claim"; id: string; who: string | null }
  | { m: "line"; state: "RUNNING" | "PAUSED" }
  | { m: "speed"; v: number }
  | { m: "force"; id: string; tag: string; v: number | null; part?: string };   // v null = release

export interface Player { id: string; name: string; role: string; x: number; z: number; yaw: number }

/** Apply one operator action to the local simulation (same code path for local and remote actions). */
export function applyAction(sim: TwinSim, a: Action, from = "you") {
  const byCode = (id: string, code: string) => sim.faults.find((f) => f.machineId === id && f.code === code);
  switch (a.m) {
    case "start":                                   // machine Start also restarts a stopped line (refused while interlocked)
      sim.setMachine(a.id, "RUN");
      if (sim.line.state === "STOPPED" || sim.line.state === "PAUSED") sim.setLine("RUNNING");
      break;
    case "stop": sim.setMachine(a.id, "HOLD"); break;
    case "estop": sim.setLine("ESTOP"); sim.log("fault", `E-stop pressed by ${from}${a.id ? ` at ${a.id}` : ""}`); break;
    case "reset": sim.resetEstop(); for (const f of sim.machineFaults(a.id)) sim.acknowledge(f.id); break;
    case "mode": sim.rt[a.id].manual = !sim.rt[a.id].manual; sim.log("info", `${from}: ${a.id} mode ${sim.rt[a.id].manual ? "MANUAL" : "AUTO"}`); break;
    case "set": sim.setValue(a.id, a.key, a.v); break;
    case "repair": { const f = byCode(a.id, a.code); if (f) sim.startRepair(f.id, a.by ?? from); break; }
    case "clear": { const f = byCode(a.id, a.code); if (f) sim.clearFault(f.id); break; }
    case "fault": sim.injectFault(a.id, a.code); break;             // fault simulator (operator mistakes come from the sim rules)
    case "claim": sim.claim(a.id, a.who); break;
    case "line": sim.setLine(a.state); break;
    case "force": {                                // Factory I/O forcing: a forced sensor of a part with a failure mode = that fault
      if (a.v === null) { delete sim.forced[a.tag]; sim.log("info", `${from}: released ${a.tag}`); break; }
      sim.forced[a.tag] = a.v;
      sim.log("warning", `${from}: forced ${a.tag} = ${a.v}`);
      const spec = a.part ? sim.rt[a.id] && MACHINE[a.id].faults.find((f) => f.partId === a.part) : undefined;
      if (spec) sim.injectFault(a.id, spec.code, "local", `${spec.label} (forced ${a.tag})`);
      break;
    }
    case "speed": sim.line.timeScale = Math.min(4, Math.max(0, a.v)); sim.log("info", `${from}: simulation speed ${sim.line.timeScale}×`); break;
  }
}

export class FloorClient {
  me: Player | null = null;
  players = new Map<string, Player>();             // the others
  connected = false;
  denied = "";
  private ws: WebSocket | null = null;
  private lastPose = 0;

  constructor(private sim: () => TwinSim, private onChange: () => void) {}

  join(name: string, role: string) {
    this.ws?.close();
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/floor`);
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: "hello", name, role }));
    ws.onclose = () => { this.connected = false; this.players.clear(); this.onChange(); };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "welcome") {
        this.connected = true;
        this.me = msg.players.find((p: Player) => p.id === msg.id);
        for (const p of msg.players) if (p.id !== msg.id) this.players.set(p.id, p);
        for (const a of msg.log as Action[]) applyAction(this.sim(), a, "replay");   // late joiner catches up
      } else if (msg.type === "join") this.players.set(msg.player.id, msg.player);
      else if (msg.type === "leave") this.players.delete(msg.id);
      else if (msg.type === "pose") { const p = this.players.get(msg.id); if (p) Object.assign(p, msg); }
      else if (msg.type === "action") applyAction(this.sim(), msg.a, msg.from);
      else if (msg.type === "denied") this.denied = msg.reason;
      this.onChange();
    };
  }

  /** Perform an action: through the server when connected (it checks claims and echoes it to everyone), else locally. */
  act(a: Action) {
    this.denied = "";
    if (this.connected && this.ws) this.ws.send(JSON.stringify({ type: "action", a }));
    else applyAction(this.sim(), a.m === "claim" && a.who ? { ...a, who: "you" } : a);
  }

  pose(x: number, z: number, yaw: number) {
    const now = performance.now();
    if (!this.connected || !this.ws || now - this.lastPose < 100) return;   // 10 Hz is plenty for walking avatars
    this.lastPose = now;
    this.ws.send(JSON.stringify({ type: "pose", x, z, yaw }));
  }

  /** Name shown as owner of a machine claimed by this client. */
  get myName() { return this.connected ? this.me?.name ?? "you" : "you"; }
}
