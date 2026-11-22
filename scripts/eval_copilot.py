"""T24 - evaluate the copilot retrieval + guardrail (offline, no API cost).

    python scripts/eval_copilot.py                 # extractive mode
    python scripts/eval_copilot.py --ask "M3 vibration is rising, what do I do?" --fault BEARING_WEAR

Checks per fault: the right manual comes first; repair answers start with LOTO when
the manual requires it; off-topic questions are blocked.
"""
from __future__ import annotations

import argparse
import json

from roottwin.copilot import Copilot
from roottwin.detection import REPORTS
from roottwin.faults import load_catalog

QUESTIONS = {
    "repair": "How do I repair it?",
    "why": "Why is this alert raised, what are the symptoms?",
}
NATURAL = {  # question phrased like a technician, WITHOUT the fault code
    "BEARING_WEAR": "vibration rising slowly then bearing temperature, grinding noise near spindle",
    "MISALIGNMENT": "black rubber dust on the coupling and vibration a bit high",
    "BELT_SLIP": "cadence dropped but the motor still runs, smell of hot rubber, squeal",
    "MOTOR_OVERCURRENT": "motor current way above nominal, drive trips on overload",
    "PHASE_IMBALANCE": "current unstable and lights flicker on the same supply",
    "OVERHEATING": "temperature climbing, gearbox oil level low",
    "COOLING_FAILURE": "cooling fan silent, temperature jumped suddenly",
    "SENSOR_DRIFT": "temperature reading drifts but infrared thermometer says normal",
    "SENSOR_STUCK": "vibration signal perfectly flat for minutes",
    "CONVEYOR_JAM": "parts stopped flowing, part stuck at the transfer point",
    "TOOL_WEAR": "scrap rate increasing, poor surface finish on parts",
}
OFF_TOPIC = ["What is the capital of France?", "Write me a poem about cats", "How do I bake bread?"]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--ask")
    p.add_argument("--fault", action="append")
    a = p.parse_args()
    cop = Copilot()
    if a.ask:
        ans = cop.ask(a.ask, a.fault)
        print(f"[{ans.mode}] sources: {ans.sources}\n\n{ans.text}")
        return

    cat = load_catalog()
    res = {"mode": "llm" if cop.use_llm else "extractive", "by_fault": {}}
    ok_top, ok_nat, ok_loto, n = 0, 0, 0, 0
    for code, spec in cat.items():
        n += 1
        top = cop.retrieve(QUESTIONS["repair"], [code])[0].fault_code == code
        nat = cop.retrieve(NATURAL[code])[0].fault_code == code
        ans = cop.ask(QUESTIONS["repair"], [code])
        # LOTO faults: safety section first; others: the answer must say lockout is NOT required
        loto_first = (ans.text.lstrip().startswith("Safety") and "padlock" in ans.text) \
            if spec.repair.loto_required else "NOT required" in ans.text
        ok_top += top; ok_nat += nat; ok_loto += loto_first
        res["by_fault"][code] = {"right_manual_with_code": top, "right_manual_natural_question": nat,
                                 "loto_handling_ok": bool(loto_first), "mode": ans.mode, "sources": ans.sources}
    blocked = [cop.ask(q).mode == "blocked" for q in OFF_TOPIC]
    res["summary"] = {"right_manual_given_fault_code": f"{ok_top}/{n}",
                      "right_manual_from_natural_question": f"{ok_nat}/{n}",
                      "loto_first_when_required": f"{ok_loto}/{n}",
                      "off_topic_blocked": f"{sum(blocked)}/{len(blocked)}"}
    print(json.dumps(res["summary"], indent=1))
    miss = [c for c, r in res["by_fault"].items() if not r["right_manual_natural_question"]]
    if miss:
        print("natural-question misses:", miss)
    ex = cop.ask("What do I do?", ["BEARING_WEAR"])
    print("\nExample (BEARING_WEAR, 'What do I do?'):\n" + ex.text[:700] + " ...")
    (REPORTS / "copilot_eval.json").write_text(json.dumps(res, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
