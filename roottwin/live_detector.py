"""Live detection service: telemetry in, explained alarms out (J10 milestone: "the AI is visible").

    python -m roottwin.live_detector

1. At start-up, trains an Isolation Forest on healthy runs of the line engine
   (incl. operator stops, so an idle machine is "normal") and sets the threshold
   for <= 1 false alarm per machine-day (same protocol as T13). ~20 s, no files needed.
2. Subscribes to factory/<line>/+/telemetry, keeps 10-min rolling features per machine.
3. Score above threshold for 5 consecutive minutes -> publishes an `alarm` event on
   factory/<line>/<M>/event with: SHAP explanation (T22), candidate faults, probable
   root cause (most upstream machine in alarm), copilot advice from the manuals (T24).
   The ingestor stores it; the API pushes it to the 3D view.
"""
from __future__ import annotations

import json
import os
import time
from collections import deque
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import paho.mqtt.client as mqtt

from roottwin.components import component_for
from roottwin.diagnosis import bayes
from roottwin.diagnosis.graph import diagnose as graph_diagnose, line_graph
from roottwin.diagnosis.symptoms import SYMPTOMS, symptoms
from roottwin.copilot import Copilot
from roottwin.detection.events import threshold_for_false_alarms
from roottwin.detection.explain import AlertExplainer
from roottwin.detection.iforest import IForestDetector
from roottwin.faults.offline import ROLLING_FEATURES, SENSORS, add_rolling_features
from roottwin.line import NOMINAL, Line

LINE_ID = os.getenv("LINE_ID", "line1")
WINDOW, PERSIST, CLEAR_AFTER, WARMUP = 10, 5, 10, 20


def healthy_run(minutes: int, seed: int) -> pd.DataFrame:
    """Fault-free running line telemetry (1 row / machine / minute). Stops are not scored live."""
    line = Line(seed=seed)
    line.command("LINE", "start_line")
    rows = []
    for t in range(minutes):
        line.step(1.0)
        for i, m in enumerate(line.machines):
            rows.append({"scenario_id": f"H{seed}", "machine_id": m.id, "t_min": float(t), **line.sensors(i),
                         "state": "ok", "label": 0, "fault_code": None})
    return add_rolling_features(pd.DataFrame(rows))


def train(minutes: int = 1440) -> tuple[IForestDetector, pd.DataFrame]:
    tr, va = healthy_run(minutes, 101), healthy_run(2 * minutes, 202)
    det = IForestDetector(ROLLING_FEATURES, n_estimators=200).fit(tr)
    det.threshold = threshold_for_false_alarms(va, det.score(va), max_per_day=1.0, persist=PERSIST)
    det.model_.n_jobs = 1          # live scoring is one row at a time: thread start-up would dominate
    return det, tr


def is_idle(last: dict) -> bool:
    """Latest reading looks blocked/starved: no output, low current, low vibration -> a consequence, not a cause."""
    return (last["cadence"] < 0.2 * NOMINAL["cadence"] and last["current"] < 0.6 * NOMINAL["current"]
            and last["vibration"] < 0.7 * NOMINAL["vibration"])


def features(buf: deque) -> pd.Series:
    df = pd.DataFrame(list(buf))
    f = {}
    for s in SENSORS:
        f[f"{s}_mean"] = df[s].mean()
        f[f"{s}_std"] = df[s].std() if len(df) > 1 else 0.0
    return pd.Series(f)


class LiveDetector:
    def __init__(self, det: IForestDetector, normal: pd.DataFrame, machines: list[str]):
        self.det, self.exp, self.copilot = det, AlertExplainer(det, normal), Copilot()
        self.machines = machines
        self.buf = {m: deque(maxlen=WINDOW) for m in machines}
        self.above = {m: 0 for m in machines}
        self.below = {m: 0 for m in machines}
        self.alarmed: set[str] = set()
        self.idle: dict[str, bool] = {}
        self.seen = {m: 0 for m in machines}
        self.running = True
        self.graph = line_graph(machines)

    def set_running(self, running: bool) -> None:
        """Line stopped by the operator: stop scoring and forget the windows (no alarm on a planned stop)."""
        if self.running and not running:
            for b in self.buf.values():
                b.clear()
            self.seen = {m: 0 for m in self.machines}
        self.running = running

    def diagnose(self) -> dict:
        """T15 propagation graph over the current alarms + T19 Bayesian posteriors (when trained)."""
        sym = {m: symptoms({s: float(np.mean([r[s] for r in b])) for s in SENSORS}) for m, b in self.buf.items() if b}
        sym = {m: sym.get(m, {k: False for k in SYMPTOMS}) for m in self.machines}
        d = graph_diagnose(self.graph, set(self.alarmed), sym).to_dict()
        nets = bayes.load()
        if nets:
            post = nets["factory"].posterior(bayes.factory_evidence(sym))
            d["bayes_root"] = sorted(([k, round(v, 3)] for k, v in post.items()), key=lambda kv: -kv[1])[:3]
            if d["root"]:
                fam = nets["machine"].posterior({k: v for k, v in sym[d["root"]].items() if k in bayes.MACHINE_SYMPTOMS})
                d["family"] = sorted(([k, round(v, 3)] for k, v in fam.items()), key=lambda kv: -kv[1])[:3]
        return d

    def on_telemetry(self, machine: str, sensors: dict) -> dict | None:
        """Returns an alarm payload when a new alarm starts, else None."""
        if machine not in self.buf or not self.running:
            return None
        self.buf[machine].append(sensors)
        self.seen[machine] += 1
        if self.seen[machine] < WARMUP:          # line filling up after a start: downstream machines look starved
            return None
        row = features(self.buf[machine])
        score = float(self.det.score(row.to_frame().T)[0])
        if score >= self.det.threshold:
            self.above[machine] += 1
            self.below[machine] = 0
        else:
            self.below[machine] += 1
            self.above[machine] = 0
            if self.below[machine] >= CLEAR_AFTER:
                self.alarmed.discard(machine)
        if self.above[machine] < PERSIST or machine in self.alarmed:
            return None
        self.alarmed.add(machine)
        self.idle[machine] = is_idle(self.buf[machine][-1])
        e = self.exp.explain(row, machine)
        diag = self.diagnose()
        root = diag["root"]
        codes = [c for c, m in e.candidates if m > 0]
        advice = self.copilot.ask("What do I do?", codes[:1] or None, e.text).to_dict() if root == machine else None
        return {"event_type": "alarm", "severity": 4, "fault_code": codes[0] if codes else None,
                "payload": {"score": round(score, 4), "threshold": round(self.det.threshold, 4),
                            "explanation": e.text, "contributions": e.contributions,
                            "candidates": [{"fault_code": c, "match": m} for c, m in e.candidates],
                            "root_cause": root, "is_root_cause": root == machine, "diagnosis": diag,
                            "component": component_for(machine, codes[0]) if codes else None,   # suspected part (3D locate)
                            "copilot": advice}}


def main():
    host, port = os.getenv("MQTT_HOST", "localhost"), int(os.getenv("MQTT_PORT", "1883"))
    t0 = time.time()
    det, normal = train()
    print(f"detector trained in {time.time() - t0:.0f}s, threshold {det.threshold:.4f}", flush=True)
    live = LiveDetector(det, normal, [f"M{i}" for i in range(1, 7)])
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="roottwin-detector")

    def on_message(c, _u, msg):
        if msg.topic.endswith("/snapshot"):
            try:
                live.set_running(bool(json.loads(msg.payload).get("running", True)))
            except ValueError:
                pass
            return
        machine = msg.topic.split("/")[2]
        try:
            sensors = json.loads(msg.payload)["sensors"]
        except (ValueError, KeyError, TypeError):
            return
        alarm = live.on_telemetry(machine, sensors)
        if alarm:
            alarm["ts"] = datetime.now(timezone.utc).isoformat()
            c.publish(f"factory/{LINE_ID}/{machine}/event", json.dumps(alarm), qos=1)
            print(f"ALARM {machine}: {alarm['payload']['explanation']}", flush=True)

    client.on_connect = lambda c, *_: (c.subscribe(f"factory/{LINE_ID}/+/telemetry", qos=0),
                                       c.subscribe(f"twin/{LINE_ID}/snapshot", qos=0))
    client.on_message = on_message
    client.connect(host, port)
    client.loop_forever()


if __name__ == "__main__":
    main()
