"""T28 - final benchmark: corrective / preventive / condition-based / OR-Tools / PPO on 100 shifts.

    python scripts/benchmark.py            # needs models/ppo_maintenance.zip for the PPO row (train_ppo.py)
-> reports/benchmark.json, reports/figures/benchmark_downtime.png, planning xlsx "Jalons et Démo" table filled
"""
from __future__ import annotations

import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from roottwin.detection import REPORTS, ROOT
from roottwin.rl.benchmark import run_policy, strategies

SEEDS = range(100)          # never used for training (PPO: >= 10_000) nor validation (1000-1011)
LABELS = {"corrective": "Corrective", "preventive": "Preventive", "condition": "Condition-based",
          "ortools": "OR-Tools plan", "ppo": "PPO (RL)"}
XLSX_ROWS = {"corrective": 26, "preventive": 27, "condition": 28, "ortools": 29, "ppo": 30}


def main():
    rows = []
    for name, pol in strategies().items():
        for s in SEEDS:
            rows.append({"strategy": name, **run_policy(pol, s)})
        print(f"  {name:<11} done", flush=True)
    df = pd.DataFrame(rows)
    g = df.groupby("strategy", sort=False)
    summ = g.agg(downtime_min=("downtime_min", "mean"), downtime_std=("downtime_min", "std"),
                 parts_ok=("parts_ok", "mean"), total_cost=("total_cost", "mean"), profit=("profit", "mean"),
                 interventions=("interventions", "mean"))
    base = summ.loc["corrective", "downtime_min"]
    summ["downtime_gain_vs_corrective"] = 1 - summ["downtime_min"] / base
    # paired comparison with the best non-RL strategy on the same seeds
    piv = df.pivot(index="seed", columns="strategy", values="downtime_min")
    print(summ.round(2).to_string())
    out = {"n_shifts": len(SEEDS), "shift_min": 480, "summary": summ.round(3).reset_index().to_dict("records")}
    if "ppo" in piv:
        best_rule = summ.drop(index="ppo")["downtime_min"].idxmin()
        diff = piv["ppo"] - piv[best_rule]
        out["ppo_vs_best_rule"] = {"best_rule": best_rule, "mean_diff_min": float(diff.mean()),
                                   "ppo_better_shifts": int((diff < 0).sum()), "ties": int((diff == 0).sum())}
        print("PPO vs", best_rule, out["ppo_vs_best_rule"])
    (REPORTS / "benchmark.json").write_text(json.dumps(out, indent=1), encoding="utf-8")

    fig, ax = plt.subplots(figsize=(8, 4))
    names = list(summ.index)
    ax.bar([LABELS[n] for n in names], summ["downtime_min"], yerr=summ["downtime_std"] / np.sqrt(len(SEEDS)),
           color=["#999", "#2E6FDB", "#2E9E6B", "#E8892B", "#8E44AD"][:len(names)], capsize=4)
    for i, n in enumerate(names):
        ax.text(i, summ.loc[n, "downtime_min"] + 3, f"{summ.loc[n, 'downtime_min']:.0f}", ha="center")
    ax.set_ylabel("line downtime per 8-h shift (min)")
    ax.set_title(f"Downtime by strategy - {len(SEEDS)} identical shifts (mean ± s.e.)")
    fig.tight_layout(); fig.savefig(REPORTS / "figures" / "benchmark_downtime.png", dpi=110)

    xlsx = ROOT / "docs" / "Planning_Projet_IA_Usine_3D_v2.xlsx"
    if xlsx.exists():
        import openpyxl
        wb = openpyxl.load_workbook(xlsx)
        ws = wb["Jalons et Démo"]
        for n, r in XLSX_ROWS.items():
            if n in summ.index:
                ws.cell(r, 2).value = round(float(summ.loc[n, "downtime_min"]), 1)
                ws.cell(r, 3).value = round(float(summ.loc[n, "parts_ok"]), 1)
        ws["A24"] = (f"RÉSULTATS DU BENCHMARK (T28 : {len(SEEDS)} postes de 8 h identiques, moyennes ; "
                     "modèle de ligne roottwin/line.py)")
        wb.save(xlsx)
        print(f"-> {xlsx.name} benchmark table filled")


if __name__ == "__main__":
    main()
