# KPI sheet — 3D factory digital twin (T02, Person B)

One page. These KPIs are what every module is judged on: the simulation must
produce the data to compute them, the AI modules must improve them, the final
benchmark (T28) reports them per strategy. Vocabulary follows ISO 22400
(manufacturing operations KPIs) and the classic OEE definition.

## 1. Business KPIs (the jury cares about these)

| KPI | Definition / formula | Data source (TimescaleDB) | Direction |
|---|---|---|---|
| **Downtime** (min) | Σ time a machine is in state `down` | `events` (`state_change` → `down` … next `ok`) | ↓ |
| **Availability** A | (planned time − downtime) / planned time | `events` | ↑ |
| **Throughput** (parts/h) | Σ `parts_ok` / hours | `production` | ↑ |
| **MTTR** (min) | mean(repair end − repair start) | `intervention_durations` view | ↓ |
| **MTBF** (h) | operating time / number of failures | `events` (`event_type='failure'`) | ↑ |
| **OEE** | A × Performance × Quality; Perf = actual rate / ideal rate (cadence), Quality = ok / (ok + scrap) | `events`, `production`, `sensor_readings(cadence)` | ↑ |
| **Maintenance cost** (€) | Σ intervention cost + downtime × cost per minute of stoppage | `interventions`, `events` | ↓ |

Line-level downtime counts the **bottleneck**: in a serial line, a stopped
upstream machine starves downstream machines (propagation, diagnosed in T15).

## 2. AI KPIs (one per module)

| Module | KPI | Target (to confirm after T13 baseline) |
|---|---|---|
| Detection (T13, T16) | Precision, Recall, F1 on anomalies; **false alarms / day** | Recall ≥ 0.9 with ≤ 1 false alarm/day |
| Early warning | **Lead time** = failure time − first alarm time | > 0 (alarm *before* the stop) |
| Fault type (T20) | Macro-F1 across fault families | beats a majority-class baseline |
| RUL (T20) | RMSE on C-MAPSS FD001 test set (cycles) | compare with published baselines |
| Diagnosis (T15, T19) | Top-1 / Top-3 root-cause accuracy over scenarios | Top-1 ≥ 0.8 on simulated scenarios |
| Decision (T21, T28) | Downtime and cost vs. corrective / preventive / condition-based / OR-Tools | report honestly, even if PPO loses |
| Copilot (T24) | % answers citing a manual passage; % unsupported answers blocked | 100 % cited |

## 3. Benchmark protocol (T28)

Same 100 scenarios (fixed `scenario_id` + random seed) for every strategy;
report mean ± std of downtime, parts produced, cost, and % downtime gain vs.
corrective maintenance. No number is announced before it is measured.

## 4. Reading workshop — what to take from each reference

| Theme (from the planning) | Key idea to keep | Used in |
|---|---|---|
| Digital twin + Bayesian networks | Diagnose at machine level then factory level; probabilities propagate through the dependency graph | T15, T19 |
| RL for maintenance | State = health + resources, actions = repair/replace/wait/dispatch, reward = production − downtime − cost; always compare to rule-based baselines | T17, T18, T21 |
| MathWorks predictive maintenance workflow | Data → condition indicators (features) → detect → diagnose → predict RUL → deploy | T07, T13, T16, T20 |

Datasets (validation on real data): NASA C-MAPSS turbofan run-to-failure (RUL),
CWRU bearing vibration (fault classification), AI4I 2020 (tabular machine failures).
