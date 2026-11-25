# RootTwin — 3D factory digital twin: AI fault detection, diagnosis & guided repair

Capgemini hackathon · team of 3 · 13 working days (23 Nov → 9 Dec 2026).

A simulated 6-machine production line streams sensor data over MQTT. You **run the production from a
3D factory** (orders, speed, buffers, workers, faults) while AI modules detect anomalies, find the root
cause, decide which worker repairs what (RL), and an LLM copilot explains *why* and *what to do*.

```
                ┌──────────── commands (cmd topic) ◄── command API :8001 ◄── 3D UI / RL agent / scenarios
                ▼
SimPy simulation ──MQTT telemetry/event/production──► Mosquitto ──► ingestor ──► TimescaleDB ◄── FastAPI ──► React Three Fiber
 (Person A)                                            (B)          (B)          (B)             (C)          (C)
                                                                                    ▲
                     public datasets (AI4I, C-MAPSS, CWRU) ── loaders (B) ──────────┤
                                                  Detection / Diagnosis / RL / Copilot (A, B, C)
```

Planning: [docs/Planning_Projet_IA_Usine_3D_v2.xlsx](docs/Planning_Projet_IA_Usine_3D_v2.xlsx) (v2 = interactive production, see below).

## Team

| | Learning path |
|---|---|
| **A** | Simulation → data calibration → diagnosis (graph, Bayesian, SHAP) → diagnosis UI, MLOps |
| **B** | Data & infra → fault injection → ML/DL detection → LLM copilot → RL benchmark |
| **C** | API & 3D → RL environment & PPO → Play mode → integration & demo |

## What is done (Person A)

| Task | Deliverable | Where |
|---|---|---|
| **T01** Snapshot contract | Real-time state of the whole line for the 3D (`factory/line1/LINE/snapshot`, retained, not stored): machines (state, activity, cycle progress, buffer, sensors), parts on each conveyor with their position, orders, line KPIs (throughput, availability, OEE) | [roottwin/contracts.py](roottwin/contracts.py) (`Snapshot`), [docs/DATA_CONTRACTS.md](docs/DATA_CONTRACTS.md) |
| **T03** SimPy line | Real-time (`simpy.rt`, speed changeable live, pause) **and** fast mode; 6 machines, 5 accumulating conveyors, resizable buffers, tracked parts, production orders, the 14 T33 commands, B's catalogue faults, maintenance, speed ↔ wear coupling; stops propagate (starved downstream, blocked upstream); NetworkX dependency graph = `machine_links` | [roottwin/sim/](roottwin/sim/), [docs/SIMULATION.md](docs/SIMULATION.md) |
| **T06** Sensors | 4 sensors per machine from load, speed and wear (gamma-process wear, thermal lag, noise) + catalogue fault signatures, published on MQTT | [roottwin/sim/sensors.py](roottwin/sim/sensors.py) |
| Dataset mode | `simulate_many(generate_scenarios(200))`: same columns as `faults/offline.py`, 8 h of line in ~2 s (200 scenarios ≈ 6 min, or `--jobs 4`) | `python -m roottwin.sim dataset` |
| Tests | 42 tests: layout = DB seed, flow, bottleneck rate, propagation, every fault/maintenance path, every command, every message accepted by the ingestor, determinism, real-time speed/pause | `tests/test_sim_*.py` |

Run: `python -m roottwin.sim live --time-scale 60 --order 500` (after `docker compose up -d`), then
drive it through the command API. Without Docker: `python -m roottwin.sim live --no-mqtt --seconds 20 --order 200`.

## What is done (Person B)

### Days 1–2
| Task | Deliverable | Where |
|---|---|---|
| **T02** KPI workshop | One-page KPI sheet: business KPIs (downtime, availability, throughput, MTTR, MTBF, OEE, cost), one KPI per AI module, benchmark protocol | [docs/KPI.md](docs/KPI.md) |
| **T04** Data infra | `docker compose up` → Mosquitto (MQTT + WebSocket) + TimescaleDB (hypertables, 1-min aggregate, compression, KPI views) + ingestor | [docker-compose.yml](docker-compose.yml), [infra/](infra/), [services/ingestor/](services/ingestor/) |
| Planning v2 | Interactive production: T32–T35 added, T26 postponed, loads rebalanced (A 92 %, B 98 %, C 100 %) | [docs/Planning_Projet_IA_Usine_3D_v2.xlsx](docs/Planning_Projet_IA_Usine_3D_v2.xlsx) |

### Days 3–6
| Task | Deliverable | Where |
|---|---|---|
| **T07** Real datasets | Download script; clean loaders for AI4I 2020, NASA C-MAPSS FD001 (RUL computed, 14 informative sensors), CWRU bearings (2048-sample windows + 7 condition indicators); data loaded into TimescaleDB (`source = ai4i / cmapss / cwru`, 523 k readings) and `data/processed/*.parquet` | [roottwin/datasets/](roottwin/datasets/), [scripts/download_datasets.py](scripts/download_datasets.py), [scripts/load_datasets.py](scripts/load_datasets.py) |
| T07 EDA | 3 executed notebooks with plots and takeaways for the detectors | [notebooks/](notebooks/) |
| **T33** Command channel | `Command` contract (14 commands, line vs machine level, strict params); `factory/{line}/{target}/cmd` topic; HTTP → MQTT relay with Swagger (`:8001/docs`), command & fault catalogues; every command logged in `events` | [roottwin/contracts.py](roottwin/contracts.py), [roottwin/command_api.py](roottwin/command_api.py) |
| **T09** Fault injection | Catalogue of **11 faults in 5 families** (sensor signature, onset, time to failure, repair skill/time/cost, LOTO); `ActiveFault` the simulation can call; reproducible YAML scenarios + generator (200 scenarios / 310 faults from one seed) + real-time runner | [roottwin/faults/](roottwin/faults/), [scenarios/](scenarios/), [scripts/run_scenario.py](scripts/run_scenario.py) |
| Stand-in line | Fake 6-machine line that obeys commands and applies catalogue faults (lets C build the 3D before A's simulation is done; shows A how to integrate faults) | [scripts/publish_fake_data.py](scripts/publish_fake_data.py) |
| Ingestor hardening | Rows of a failed DB write are retried (tested: DB restarted mid-stream, 480/480 rows kept); `LINE` target never registered as a machine | [services/ingestor/ingestor.py](services/ingestor/ingestor.py) |
| Tests | 41 unit tests at that point (contracts, commands, API, faults, scenarios) | [tests/](tests/) |

### Done ahead of schedule (planned J6–J13, own tasks that need nobody else)
| Task | Deliverable | Where |
|---|---|---|
| **T13** Baseline detectors | z-score thresholds + Isolation Forest, fitted on normal data only; point-wise and **event-level** evaluation (5-min persistence, threshold for ≤ 1 false alarm per machine-day, lead time before the stop) on AI4I, CWRU and 200 simulated scenarios | [roottwin/detection/](roottwin/detection/), [scripts/train_detector.py](scripts/train_detector.py), [reports/detection_baseline.json](reports/detection_baseline.json) |
| Offline scenario simulator | Labelled telemetry from fault scenarios (stand-in for dataset v1 until A's T12) | [roottwin/faults/offline.py](roottwin/faults/offline.py) |
| **T16** Autoencoder | PyTorch dense autoencoder: spectrum view (CWRU) and 30-min sequence view (simulation); ROC/PR curves vs Isolation Forest | [roottwin/detection/autoencoder.py](roottwin/detection/autoencoder.py), [scripts/train_autoencoder.py](scripts/train_autoencoder.py) |
| **T20** LSTM / TCN | Remaining useful life on C-MAPSS FD001 + fault-type classification (11 faults + healthy) on simulated windows | [roottwin/detection/temporal.py](roottwin/detection/temporal.py), [scripts/train_temporal.py](scripts/train_temporal.py) |
| **T22** SHAP explanations | Per-alert text: sensors driving the anomaly (SHAP), deviation from normal, candidate faults (signature match re-ranked by the T20 classifier); accuracy of the explanations measured | [roottwin/detection/explain.py](roottwin/detection/explain.py), [scripts/explain_alerts.py](scripts/explain_alerts.py) |
| **T24** Copilot + RAG | 11 fictional repair manuals (symptoms, diagnosis, LOTO, procedure, restart, parts); BM25 retrieval; Claude Opus 5.5 answers with mandatory citations, or offline extractive mode; guardrail "no source, no answer" | [docs/manuals/](docs/manuals/), [roottwin/copilot.py](roottwin/copilot.py), [scripts/eval_copilot.py](scripts/eval_copilot.py) |
| **T29** Business model (draft) | 3 offers, measured claims vs claims still to measure, competition, jury Q&A, pitch outline — prices left as placeholders | [docs/BUSINESS_MODEL.md](docs/BUSINESS_MODEL.md) |
| Tests | 53 unit tests | [tests/](tests/) |

### Model results (test splits never used for training or thresholds)
**Detection on the simulated line** (40 test scenarios, threshold set on validation for ≤ 1 false alarm per machine-day):

| Detector | Fault episodes caught | Stopping faults warned **before** the stop | Median lead time | False alarms / machine-day |
|---|---|---|---|---|
| z-score thresholds | 82 % | 97 % | 31 min | 1.17 |
| **Isolation Forest** (kept) | **97 %** | **97 %** | **29 min** | **0.98** |
| Autoencoder | 83 % | 97 % | 30.5 min | 1.02 |

Blind spots: z-score and autoencoder miss SENSOR_STUCK (a frozen signal looks "too normal"); a jam is sudden, so it cannot be warned before the stop. → **KPI "recall ≥ 0.9 with ≤ 1 false alarm/day" met by Isolation Forest.**

| Other results | Value | Baseline |
|---|---|---|
| CWRU bearings (autoencoder, spectrum) | ROC-AUC 1.00, F1 0.96 (ball faults: 75 % caught at the chosen threshold) | — |
| AI4I (unsupervised, best F1) | Isolation Forest ROC-AUC 0.87 but F1 only 0.24 | expected: failures here are not all "unusual" points; a supervised model is the next step |
| **RUL C-MAPSS FD001** (100 test engines) | **LSTM RMSE 13.5 cycles**, TCN 14.2 (NASA score 293 / 317) | predict-the-mean 40.5 |
| Fault type (simulation, 12 classes) | TCN macro-F1 0.92, LSTM 0.89 — faults ≈ 1.0 except SENSOR_STUCK (0.5–0.67) | majority class 0.03 |
| SHAP explanations (157 alerts on real faults) | top sensor in the fault's signature 93 %; true fault top-1 **78 %**, top-3 91 % | signature only: top-1 41 % |
| Copilot (offline mode) | right manual 11/11 with fault code, 10/11 from a free-text question; LOTO first 11/11; off-topic blocked 3/3 | — |

Figures in [reports/figures/](reports/figures/): ROC/PR curves, an alarm-before-stop example, RUL predictions, confusion matrix, SHAP summary.

Copilot with Claude: set `ANTHROPIC_API_KEY` (or log in with `ant auth login`), `pip install -e ".[llm]"`, then
`python scripts/eval_copilot.py --ask "M3 vibration keeps rising, what do I do?" --fault BEARING_WEAR`.
It uses `claude-opus-5-5` with server-side refusal fallback; every call is billed, so it was **not run** here (no key on this machine) — the offline mode was.

### Key numbers from the EDA
| Dataset | Finding | Consequence |
|---|---|---|
| AI4I 2020 | 339 failures / 10 000 (3.4 %); HDF 115, PWF 91, OSF 78, TWF 46, RNF 18 | Use precision/recall/F1, stratified splits; engineered `power_w` and `temp_diff_k` separate PWF/HDF |
| C-MAPSS FD001 | 100 + 100 engines; 7 flat sensors dropped; naive baseline RMSE **41.5 cycles** (RUL capped at 125) | T20 must beat 41.5; degradation is flat then accelerates → shape for the simulator (T14) |
| CWRU | 4 classes separable with RMS + kurtosis (kurtosis 2.8 normal vs 7.6 outer race) | Autoencoder (T16) should be near-perfect here; real test = simulation |

## Quick start

Prerequisites: Docker Desktop (running), Python 3.11+.

```powershell
copy .env.example .env                          # optional, defaults work
docker compose up -d --build                    # broker + DB + ingestor + command API
pip install -e ".[dev]"                         # roottwin package + notebook/test tools
python -m pytest -q                             # 95 tests (53 B + 42 A)

python scripts/download_datasets.py             # ~23 MB into data/raw (git-ignored)
python scripts/load_datasets.py                 # clean + load into TimescaleDB + data/processed

pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -e ".[ml]"
python scripts/train_detector.py                # T13, ~1 min (creates data/processed/sim_v0.parquet)
python scripts/train_autoencoder.py             # T16, ~3 min
python scripts/train_temporal.py                # T20, ~20 min on CPU
python scripts/explain_alerts.py                # T22
python scripts/eval_copilot.py                  # T24 (offline)
```
Trained weights go to `models/` (git-ignored, rebuilt by the scripts); metrics and figures to `reports/` (committed).

Run the stand-in line and drive it (two terminals):
```powershell
python scripts/publish_fake_data.py --seconds 120 --time-scale 60
```
```powershell
python scripts/run_scenario.py scenarios/demo_bearing_M3.yaml --time-scale 60
Invoke-RestMethod -Method Post -Uri http://localhost:8001/command/line1/M3 -ContentType "application/json" -Body '{"command":"repair"}'
```

Check: `Get-Content scripts/check_db.sql | docker compose exec -T timescaledb psql -U twin -d twin`
· Swagger: http://localhost:8001/docs · MQTT live: `docker compose exec mosquitto mosquitto_sub -t "factory/#" -v`
· DB: `postgresql://twin:twin_dev_password@localhost:5433/twin` (**port 5433**, so it never clashes with a local PostgreSQL)
· Reset everything: `docker compose down -v`.

## Project layout

```
docker-compose.yml           broker + DB + ingestor + command API
infra/                       Mosquitto config, TimescaleDB schema
roottwin/                    shared Python package
  contracts.py               MQTT payloads + commands + snapshot (single source of truth)
  sim/                       SimPy factory (A): layout + graph, machines/conveyors/orders, sensors & wear, live runner, CLI
  command_api.py             HTTP -> MQTT command relay (router mountable in C's API)
  mqtt.py                    publisher helper
  faults/                    fault catalogue (YAML), ActiveFault, scenarios, runner
  datasets/                  AI4I, C-MAPSS, CWRU loaders
  detection/                 metrics, event-level evaluation, Isolation Forest, autoencoder, LSTM/TCN, SHAP
  copilot.py                 RAG copilot over docs/manuals (Claude or offline)
reports/                     metrics (JSON) and figures of every model
services/                    Dockerfiles: ingestor, command_api
scenarios/                   hand-written fault scenarios (demo, cascade, false alarm)
scripts/                     download/load datasets, run scenarios, stand-in line, DB check
notebooks/                   EDA (executed, with plots)
docs/                        KPI sheet, data contracts, planning v2
tests/                       unit tests
```

## For the team

- **Person A (simulation)**: done: `python -m roottwin.sim live` replaces `scripts/publish_fake_data.py`
  (same topics and commands). Next: T12 workers + dataset v1, T14 calibration, T15 diagnosis on `build_graph()`.
- **Person B (detection)**: train on the real simulation with `roottwin.sim.simulate_many(generate_scenarios(200, seed=42), jobs=4)`
  (same columns as `faults/offline.py`). See [docs/SIMULATION.md](docs/SIMULATION.md#for-the-team).
- **Person C (API / 3D)**: mount the relay: `from roottwin.command_api import router; app.include_router(router)`.
  `GET /command/catalog` and `GET /command/faults` feed the control panel dropdowns. The 3D reads the
  retained snapshot `factory/line1/LINE/snapshot` (schema `roottwin.contracts.Snapshot`).
- **Everyone**: contracts are in [docs/DATA_CONTRACTS.md](docs/DATA_CONTRACTS.md); change them only together.

## Next steps

### Person B
| Day | Task | To do |
|---|---|---|
| J5 | T10 teach-back | 20-min walkthrough of data pipeline, commands, faults, detectors; J1 milestone demo with the stand-in line |
| J6–J9 (pair) | T11, T14, T15, T17, T18 | Control panel ↔ `/command`; calibrate `catalog.yaml` ramps on C-MAPSS curves; plug the propagation path (T15) into `explain(..., propagation_path=...)`; RL env + baselines for T28 |
| When A's simulation exists | Retrain on real sim data | Re-run `train_detector.py` / `train_temporal.py` on dataset v1 (T12) instead of `faults/offline.py` |
| J8–J10 | **Live detector service** | Subscribe to telemetry, score with Isolation Forest, publish `alarm` events with the SHAP text, so alerts appear in the 3D view (J10 milestone) |
| J9–J11 | T24 with Claude | Get an API key for the team, run the copilot in LLM mode on the 11 faults, compare to extractive mode; expose it in the API |
| Improvements | T16 / T20 / AI4I | Train the fault classifier on early windows too (BEARING_WEAR top-1 at first alarm is weak); add a rolling-std feature for SENSOR_STUCK to the autoencoder; supervised model on AI4I |
| J12 | **T30** tests | Feature freeze, end-to-end tests |
| J12–J13 | **T28** benchmark | Corrective / preventive / condition-based / OR-Tools / PPO on 100 generated scenarios (needs C's T18/T21) |
| J13 | **T29** final | Review the draft with A and C, verify competitor facts, insert T28 numbers |

### Infra improvements (when needed)
- Security before any real machine: `allow_anonymous false` + password file + TLS on Mosquitto; real DB password via `.env`.
- Persist the fault catalogue in a DB table if the UI needs to edit it.
- Retention policy on raw readings if dataset generation (T12) fills the disk.
- CI (GitHub Actions) running `pytest` on every pull request.

## Learning resources (Person B path)

### Books
- *Designing Data-Intensive Applications* — Martin Kleppmann (data systems, streams, storage).
- *Hands-On Machine Learning with Scikit-Learn, Keras & TensorFlow* — Aurélien Géron (Isolation Forest, autoencoders).
- *Deep Learning with PyTorch* — Stevens, Antiga, Viehmann.
- *Interpretable Machine Learning* — Christoph Molnar (free: christophm.github.io/interpretable-ml-book) — SHAP for T22.
- *Reinforcement Learning: An Introduction* (2nd ed.) — Sutton & Barto (free: incompleteideas.net/book/the-book.html).
- *Designing Machine Learning Systems* and *AI Engineering* — Chip Huyen (MLOps, LLM apps, RAG evaluation).
- *Docker Deep Dive* — Nigel Poulton.
- New for days 3–6: *Python for Data Analysis* (3rd ed.) — Wes McKinney (pandas, free online: wesmckinney.com/book); *Vibration-based Condition Monitoring* — Robert B. Randall (bearing fault signatures, for CWRU).

- New for the ML work: *Practical Deep Learning for Coders* (fast.ai, free course + book); *Anomaly Detection Principles and Algorithms* — Mehrotra, Mohan, Huang; *Time Series Forecasting in Python* — Marco Peixeiro.

### YouTube
- **TechWorld with Nana** — Docker & Docker Compose.
- **HiveMQ** + their written *MQTT Essentials* series (QoS, topics — used for the cmd channel).
- **Timescale** — hypertables, continuous aggregates.
- **StatQuest with Josh Starmer** — precision/recall, ROC, PCA, Isolation Forest intuition.
- **3Blue1Brown** — *Neural Networks* series.
- **Andrej Karpathy** — *Neural Networks: Zero to Hero*.
- **Steve Brunton** — data-driven engineering, time series, FFT.
- **ArjanCodes** — clean Python, Pydantic, project structure.
- **DeepMind x UCL RL lectures (David Silver)** — RL foundations.
- **DeepLearning.AI** short courses — RAG, embeddings, LLM apps.

### Official documentation
- Mosquitto: https://mosquitto.org/documentation/ · Paho Python: https://eclipse.dev/paho/files/paho.mqtt.python/html/
- TimescaleDB: https://docs.timescale.com/ · PostgreSQL `COPY`: https://www.postgresql.org/docs/current/sql-copy.html
- Docker Compose: https://docs.docker.com/compose/
- Pydantic (validators, discriminated models): https://docs.pydantic.dev/ · FastAPI (routers, testing): https://fastapi.tiangolo.com/
- pandas: https://pandas.pydata.org/docs/ · SciPy signal processing: https://docs.scipy.org/doc/scipy/tutorial/signal.html
- scikit-learn outlier detection: https://scikit-learn.org/stable/modules/outlier_detection.html
- PyTorch tutorials: https://pytorch.org/tutorials/ · SHAP: https://shap.readthedocs.io/
- Gymnasium: https://gymnasium.farama.org/ · Stable-Baselines3: https://stable-baselines3.readthedocs.io/ · OR-Tools: https://developers.google.com/optimization
- MathWorks Predictive Maintenance Toolbox (condition indicators, RUL): https://www.mathworks.com/help/predmaint/
- OSHA lockout/tagout (for the LOTO steps in manuals): https://www.osha.gov/control-hazardous-energy
- Claude API (Messages, citations, refusals): https://platform.claude.com/docs · BM25 explained: https://en.wikipedia.org/wiki/Okapi_BM25
- Isolation Forest paper: Liu, Ting, Zhou, *Isolation Forest* (ICDM 2008) · TCN: Bai, Kolter, Koltun, *An Empirical Evaluation of Generic Convolutional and Recurrent Networks for Sequence Modeling* (2018) · SHAP: Lundberg & Lee, *A Unified Approach to Interpreting Model Predictions* (NeurIPS 2017)

### Datasets
- AI4I 2020 Predictive Maintenance Dataset — UCI ML Repository #601 (Matzka, 2020).
- NASA C-MAPSS turbofan degradation — NASA Prognostics Center of Excellence (Saxena et al., PHM 2008).
- CWRU Bearing Data Center — Case Western Reserve University.
