# RootTwin — 3D factory digital twin: AI fault detection, diagnosis & guided repair

Capgemini hackathon · team of 3 · 13 working days (23 Nov → 9 Dec 2026).

A simulated 6-machine production line streams sensor data over MQTT. You **run the production from a
3D factory** (orders, speed, buffers, workers, faults) while AI modules detect anomalies, find the root
cause, decide which worker repairs what (RL), and an LLM copilot explains *why* and *what to do*.

```
            ┌──────────── commands (cmd topic) ◄────────── API :8000 ◄── 3D UI (Observer / Play) · RL agent · scenarios
            ▼                                                  ▲  WebSocket /ws (snapshot ~5/s + alarms)
line engine (run_line.py) ──MQTT telemetry/event/snapshot──► Mosquitto ──► ingestor ──► TimescaleDB
 stand-in for A's SimPy                                         │
                                                                └──► live detector ──► explained alarms (event topic)
                     public datasets (AI4I, C-MAPSS, CWRU) ── loaders ──► TimescaleDB / data/processed
```

## Run the whole product

```powershell
docker compose up -d --build        # broker, DB, ingestor, API + 3D app, line, live detector
```
Open **http://localhost:8000** → **Digital twin** (3D production line) and **Play** (run one shift's maintenance
yourself, LOTO checklist included, score compared with the AI and the classic strategies on the same shift).
Swagger: http://localhost:8000/docs. If port 5433 is taken on your machine: `$env:POSTGRES_PORT=5434; docker compose up -d`.

Front-end development with hot reload: `cd frontend; npm install; npm run dev` → http://localhost:5173 (proxies the API on :8000).
Checks: `npm run typecheck` · `npm test` (vitest).

## 3D production-line digital twin (front-end, 27/11)

A full Industry 4.0 hall: dark reflective epoxy floor (procedural wear and tyre scuffs, yellow walkways, hazard-striped
keep-out zones, AGV guide path), open-top steel columns (no roof trusses, so the camera is never blocked), LED
high-bays, cable trays, catwalk with stairs, high-bay racks, safety fencing, and **8 machine types / 11 machines** working
as one synchronised line:

| # | Machine | Moving parts & kinematics | Backend link |
|---|---|---|---|
| 1 | Raw material high-bay rack & **pallet dispenser** | lift plate, pneumatic pusher, magazine | — |
| 2 | **AGV / AMR fleet** (×3) | drive wheels, lifting deck; loop path, keeps distance, delivers raw carriers, picks full pallets, stores them in the rack | — |
| 3 | **Infeed vision & laser portal** | reject diverter flap, light curtain | M1 |
| 4 | **CNC machining centre** | sliding door, Z head on ball screw, spindle (rpm), tool carousel, rotary table | M2 |
| 5 | **Gearbox drive & hydraulic press** | motor → coupling → 2-stage gear train at true ratios (z16/32/40), ram stroke | M3 |
| 6 | **Dual-robot welding cell** | two 6-axis arms (J1–J6) driven by inverse kinematics along the seam, clamps, arc light | M4 |
| 7 | **Palletizing robot & outfeed** | heavy 6-axis arm with vacuum gripper, IK pick & place, 3 × 3 pallet pattern | M5 |
| 8 | **PLC & electrical cabinet bank** | doors, PLC rack, I/O, inverters, breakers, 24 V PSU, roof fans | — |
| + | Main-line conveyors (5 drives) | accumulating belts, rollers, per-segment drive & tension sensor | M6 |

**What you can do**
- **4 levels of detail**: factory overview → zone presets → *Isolate machine* (others ghosted, hall hidden) → *Exploded view (vue éclatée)*.
- **Exploded view**: every part has a part number, category, material, description, maintenance notes, `explodeVector`,
  `explodeOrder` (outer housings first, shafts and bearings last) and assembly axis. Slider 0–100 %, quick 0/50/100 %,
  *animate assembly sequence*, dashed axis guide lines, floating callouts, BOM table.
- **Faults**: red pulsing beacon on the machine in the factory view, the exact faulty component turns red, faults bubble
  up the hierarchy tree; **Locate & auto-explode** (button, top banner or `F`) flies to the machine, isolates it, explodes
  it and frames the red internal part (e.g. *Gearbox input bearing*). Diagnostics: active faults (ID, machine, component,
  code, severity, time, Locate / Acknowledge / Clear), fault simulator for every component listed per machine, event log.
- **Controls** (context aware): whole line (Start, Pause, E-stop / Reset, Step, Reset; master speed 0–150 %, belt speed,
  AGV fleet speed, spawn interval, lighting, X-ray opacity; scenario presets) or one machine (Run, Hold, Stop, Home axes,
  Step cycle, Isolate, Exploded; J1–J6 + gripper/tool speed/power for robots, rpm/force/pressure/temperature for CNC
  and press, speed/current/load/voltage for conveyors and AGVs). Sliders and exact numeric inputs are two-way synced.
- **Component card**: what the part does, live telemetry (e.g. bearing temperature and vibration rise under a fault),
  maintenance notes, and **Ask the maintenance copilot** (backend RAG over the repair manuals).
- **KPIs**: line status pill (Running / Warning / Fault-Stopped / E-stop), OEE = A × P × Q, parts/h, good parts, pallets.
- **Live backend**: when the API is reachable, a backend machine that goes down or an AI alarm becomes a fault on the
  mapped component; injecting / clearing a fault in the twin is mirrored on the line (`/command`).
- Keyboard: `Space` run/pause · `E` exploded · `X` X-ray · `I` isolate · `F` locate fault · `R` reset camera · `Esc` back.

**CAD-grade visual layer (27/11, v3)** - no box placeholders any more:
- **Geometry kernel** (`scene3d/cad.ts`): rounded/filleted housings, true **involute helical gears**, finned motors with fan
  cover and terminal box, **tapered roller bearings**, bolt circles, corrugated hoses and cables (`TubeGeometry`), helical
  springs/chains, T-slot aluminium profiles, extruded outlines with bevels, lathe (revolved) parts; merged and cached.
- **PBR material library** (`scene3d/materials.ts`, 31 presets on `MeshPhysicalMaterial`): robot orange/yellow paint with
  clear-coat, brushed aluminium, chrome, cast iron, copper, rubber, glass with transmission, smoked polycarbonate,
  perforated sheet, chevron belt (texture scrolls with belt speed), emissive LEDs, laser beams, HMI screens.
- **Machines**: 6-axis robots with cast base, harmonic reducers, servo motors, counterbalance and dress pack; CNC with glass
  sliding door, ball screws, finned spindle, 16-tool ATC, T-slot table, vise, coolant nozzles, chip auger; gearbox press
  with ribbed housing, sight glass, breather, jaw coupling, helical gear train, chrome rod; T-slot conveyors with drive
  drums, worm reducers, guards, photo-eyes and laser beams; vision portal with camera, ring light, laser line profiler,
  light curtains, reject pusher; AMRs with LiDAR windows and LED strips; Euro pallets and machined workpiece blanks.
  Every machine has **15-42 parts** (checked by a test: ≥ 15 parts, < 60 % primitives, an X-ray housing).
- **X-ray / cutaway** (`X` or button): every part flagged `housing` turns to blue glass so the internals stay visible
  while the machine runs; combines with isolate and exploded view.
- **Faulty part = vivid crimson emissive** (> 1, picked up by bloom); when a part is selected, the other parts of the
  machine are ghosted *and desaturated* so only the faulty / selected part carries colour. Engineering card: part number,
  material, tolerance, health %, live telemetry (backend when connected), maintenance notes, copilot.
- **Rendering**: HDRI + 4 Lightformer softboxes (highlight streaks on paint and chrome), contact shadows, post-processing
  chain **N8AO (ambient occlusion) → Bloom (threshold 1: only LEDs, lasers, arcs and faults glow) → ACES Filmic tone
  mapping → SMAA**. `HQ` toggle switches reflections/post-processing off on weak GPUs.

**Component-level backend** (`roottwin/components.py`, `roottwin/faults/components.yaml`): the backend now knows the
physical components of M1-M6 (24 components, ids = the CAD part ids of the 3D model, checked by `tests/test_components.py`).
Each fault code is located on one component; the live snapshot carries `components` (per-part health %, local channels
like bearing temperature, winding current, belt tension, laser power) and AI alarms carry `payload.component`, so the twin
turns the exact part red. **New dataset `components_v1`** (`python scripts/make_component_dataset.py`): 391,680 rows,
204 scenarios (6 machines × every fault code + healthy runs × 4 seeds × 240 min), labelled with the root-cause component -
training data for "which part is failing", not only "which machine".

**How it is built** (`frontend/src/`): `twin/` is pure TypeScript and tested — data model (`types.ts`), one file per
machine family (`machines/*.ts` = component trees as data), 6-axis FK/IK (`kinematics.ts`), the simulation
(`sim.ts`: flow, station cycles, robot programs, AGVs, faults, OEE); the backend bridge is `services/productionBridge.ts`.
`scene3d/` has one generic `MachineView` that turns any component tree into a 3D kinematic chain with explode / ghost /
fault / selection / X-ray behaviour, plus the hall (instanced columns, racks, fences, lights), the flow (instanced
workpiece blanks, Euro pallets, AGVs, welding arcs) and the camera rig. Animations run in `useFrame` on refs (no React state per
frame); the HUD refreshes at 5 Hz. Stack: React 18, TypeScript, Vite, Tailwind 4, three.js r170, React Three Fiber,
drei, postprocessing (N8AO, bloom, ACES, SMAA).

**3D resources researched**: no free (CC0) industrial robot model with separate, rigged joints exists (CGTrader /
TurboSquid ones are paid or editorial-only), and an exploded view needs per-part metadata that downloaded meshes do not
carry, so machines are built procedurally from data. The only external asset is the CC0 HDRI
*Industrial Pipe and Valve 01* from [Poly Haven](https://polyhaven.com) (`frontend/public/hdri/`, shipped locally, works
offline). [Kenney's Conveyor / Factory kits](https://kenney.nl/assets/conveyor-kit) (CC0) are a good option for extra
low-poly decoration if wanted.

Planning: [docs/Planning_Projet_IA_Usine_3D_v2.xlsx](docs/Planning_Projet_IA_Usine_3D_v2.xlsx) (v2 = interactive production, see below).

## Team

| | Learning path |
|---|---|
| **A** | Simulation → data calibration → diagnosis (graph, Bayesian, SHAP) → diagnosis UI, MLOps |
| **B** | Data & infra → fault injection → ML/DL detection → LLM copilot → RL benchmark |
| **C** | API & 3D → RL environment & PPO → Play mode → integration & demo |

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
| Stand-in line | First fake line (replaced on 27/11 by the line engine below) | — |
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

## What is done (Person C's tasks + the rest of B's, 27/11)

| Task | Deliverable | Where |
|---|---|---|
| Line engine (stand-in for A's T03/T06/T12) | One model of the line used by the live demo, the RL env, the benchmark and Play: parts flow through 6 machines and 5 buffers, blocking/starvation, 3 workers with skills who walk, lock out and repair, wear-driven random faults, planned vs breakdown repair, KPIs | [roottwin/line.py](roottwin/line.py), [scripts/run_line.py](scripts/run_line.py) |
| **T05** API | REST (`/state`, `/events`, `/machines/{id}/history`, `/copilot/ask`, `/command/...`), WebSocket `/ws` relaying the snapshot and alarms, serves the built 3D app | [roottwin/api.py](roottwin/api.py) |
| **T08 / T11** 3D + controls | Replaced on 27/11 by the full production-line digital twin (see the section above) | [frontend/src/](frontend/src/) |
| Live detector (J10 milestone) | Isolation Forest trained at start-up on the line engine, persistence filter, SHAP explanation, root cause (most upstream machine in alarm that is not merely blocked/starved), copilot advice, published as `alarm` events | [roottwin/live_detector.py](roottwin/live_detector.py) |
| **T17** Gymnasium env | 8-hour shift, decision every 5 min, observation = what a supervisor sees (no hidden fault labels), actions = the same commands as the UI; passes `check_env` | [roottwin/rl/env.py](roottwin/rl/env.py) |
| **T18** Baselines | Corrective, preventive (wear limit), condition-based (sensor thresholds), and an **OR-Tools CP-SAT** planner that schedules one preventive slot per machine (no overlap) + reacts like condition-based | [roottwin/rl/policies.py](roottwin/rl/policies.py) |
| **T21** PPO | Stable-Baselines3 PPO, 375 k steps, best model chosen on 12 validation shifts | [scripts/train_ppo.py](scripts/train_ppo.py), [reports/ppo_training.json](reports/ppo_training.json) |
| **T28** Benchmark | 5 strategies × 100 identical shifts never used in training; table also written into the planning xlsx | [scripts/benchmark.py](scripts/benchmark.py), [reports/benchmark.json](reports/benchmark.json), [reports/figures/benchmark_downtime.png](reports/figures/benchmark_downtime.png) |
| **T27** Play mode | You play the same shift as the AI: send workers / preventive, LOTO checklist required (skipping it is refused and costs 500 €), final score vs every strategy | [roottwin/play.py](roottwin/play.py), [frontend/src/Play.jsx](frontend/src/Play.jsx) |
| **T30** Tests | 65 unit/integration tests (engine, env, baselines, OR-Tools plan, API incl. WebSocket and Play, live detector: no false alarm on a healthy line, alarm before the stop with the right root cause) + manual end-to-end run in the browser | [tests/](tests/) |
| Docker | One image (`services/app/Dockerfile`, front-end built inside) runs API, line and detector | [docker-compose.yml](docker-compose.yml) |

### T28 benchmark - 100 identical 8-h shifts (seeds 0-99, never seen in training)

| Strategy | Line downtime (min) | Good parts | Profit (€, placeholder costs) | Downtime vs corrective |
|---|---|---|---|---|
| Corrective | 159.6 | 304 | −2 650 | — |
| Preventive (wear limit) | 158.5 | 317 | −2 320 | −1 % |
| **Condition-based** | **157.0** | **328** | **−1 955** | **−2 %** |
| OR-Tools plan | 181.9 | 320 | −3 509 | +14 % |
| PPO (RL) | 181.7 | 287 | −4 093 | +14 % |

**Honest reading** (as the planning asks): on this line model the simple condition-based rule is best and the
gains over corrective are small. **PPO does not beat the rules**: its best validation score (12 shifts) did not
hold on 100 unseen shifts (better than condition-based on 41 of them). The OR-Tools plan schedules too many
preventive stops for a serial line where every stop halts production. Costs (50 €/min of stop, 20 €/part) are
placeholders, so profits are illustrative; downtime minutes are the robust comparison.
Next steps for the RL: action masking (MaskablePPO), more training (only ~375 k steps on a slow CPU), a larger
validation set, and observations closer to the detector's output.

### Live demo check (27/11, browser)
Fault BEARING_WEAR injected on M3 from the UI → M3 alarm **before** it went down, explanation "vibration 1.71× normal…",
candidates incl. BEARING_WEAR, root cause M3; M1, M2, M4–M6 alarms labelled "consequence" with root cause M3.
Play: LOTO dialog blocks the intervention until the 3 steps are ticked; end-of-shift table compares the player with all strategies.

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
python -m pytest -q                             # 65 tests

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

Run the line, the detector and the API outside Docker (three terminals, broker + DB from compose):
```powershell
python scripts/run_line.py --start
```
```powershell
python -m roottwin.live_detector
```
```powershell
uvicorn roottwin.api:app --port 8000
```
Drive it from the UI, or with a scenario: `python scripts/run_scenario.py scenarios/demo_bearing_M3.yaml --time-scale 60`.

RL (T17-T28): `pip install gymnasium stable-baselines3 ortools`, then `python scripts/train_ppo.py --steps 400000`
(continue with `--resume`) and `python scripts/benchmark.py`.

Check: `Get-Content scripts/check_db.sql | docker compose exec -T timescaledb psql -U twin -d twin`
· Swagger: http://localhost:8001/docs · MQTT live: `docker compose exec mosquitto mosquitto_sub -t "factory/#" -v`
· DB: `postgresql://twin:twin_dev_password@localhost:5433/twin` (**port 5433**, so it never clashes with a local PostgreSQL)
· Reset everything: `docker compose down -v`.

## Project layout

```
docker-compose.yml           broker + DB + ingestor + command API + API/3D + line + live detector
infra/                       Mosquitto config, TimescaleDB schema
roottwin/                    shared Python package
  contracts.py               MQTT payloads + commands (single source of truth)
  command_api.py             HTTP -> MQTT command relay (router mountable in C's API)
  mqtt.py                    publisher helper
  faults/                    fault catalogue (YAML), ActiveFault, scenarios, runner
  datasets/                  AI4I, C-MAPSS, CWRU loaders
  detection/                 metrics, event-level evaluation, Isolation Forest, autoencoder, LSTM/TCN, SHAP
  copilot.py                 RAG copilot over docs/manuals (Claude or offline)
  line.py                    production line engine (parts, buffers, workers, wear, faults, KPIs)
  api.py, play.py            main API + WebSocket, Play mode
  live_detector.py           live alarms with explanation and root cause
  rl/                        Gymnasium env, baselines + OR-Tools planner, benchmark runner
frontend/                    React Three Fiber + TypeScript app (3D digital twin + Play)
reports/                     metrics (JSON) and figures of every model
services/                    Dockerfiles: ingestor, command_api, app (API + 3D + line + detector)
scenarios/                   hand-written fault scenarios (demo, cascade, false alarm)
scripts/                     datasets, scenarios, run_line, training (detectors, PPO), benchmark, DB check
notebooks/                   EDA (executed, with plots)
docs/                        KPI sheet, data contracts, planning v2
tests/                       unit tests
```

## For the team

- **Person A (simulation)**: `roottwin/line.py` + `scripts/run_line.py` already publish everything the UI,
  detector and RL need (telemetry, events, snapshot, commands). Your SimPy model (T03/T06/T12) can either
  replace the engine behind `run_line.py` (same snapshot/topics) or calibrate its parameters (cycle times,
  wear rate, repair times, T14). Still yours: T15 graph propagation (plug it into `live_detector.py` where the
  `shortcut:` root-cause line is), T19 Bayesian network, T23 diagnosis UI, T25 MLflow, T34 visual polish.
- **Person C (API / 3D)**: the API, 3D Observer, Play, RL env, baselines and PPO exist; please review them
  (cross-review rule) and own them from here: visual polish with real assets (Kenney/Quaternius), PPO
  improvements, demo rehearsals (T31).
- **Everyone**: contracts are in [docs/DATA_CONTRACTS.md](docs/DATA_CONTRACTS.md); change them only together.

## Next steps

### Person B
| Day | Task | To do |
|---|---|---|
| J5 | T10 teach-back | Demo the full loop in the browser (order → parts flow → fault → alarm before stop → repair); explain every module to A and C |
| J6–J9 (pair) | T14, T15 with A | Calibrate `catalog.yaml` / `line.py` wear on C-MAPSS curves; replace the root-cause shortcut by A's graph propagation |
| When A's simulation exists | Retrain on real sim data | Re-run `train_detector.py` / `train_temporal.py` / `train_ppo.py` on dataset v1 (T12) |
| J9–J11 | T24 with Claude | Get an API key for the team, run the copilot in LLM mode on the 11 faults, compare to extractive mode |
| Improvements | PPO / detectors | MaskablePPO + longer training + 50 validation shifts; fault classifier on early windows; SENSOR_STUCK feature for the autoencoder |
| J12 | **T30** tests | Feature freeze; each person tests another person's module (65 automated tests already) |
| J13 | **T29** final | Review the draft with A and C, verify competitor facts, insert the T28 numbers (done in the xlsx) |

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
