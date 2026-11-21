# 3D Factory Digital Twin — AI fault detection, diagnosis & guided repair

Capgemini hackathon · team of 3 · 13 working days (23 Nov → 9 Dec 2026).

A simulated 6-machine production line streams sensor data over MQTT. AI modules
detect anomalies, find the root cause, decide which worker repairs what (RL),
and an LLM copilot explains *why* and *what to do*. Everything is shown in a 3D
factory in the browser.

```
SimPy simulation ──MQTT──► Mosquitto ──► ingestor ──► TimescaleDB ◄── FastAPI ──► React Three Fiber (3D)
 (Person A)                 (B)          (B)          (B)              (C)           (C)
                                                         ▲
                                     Detection / Diagnosis / RL / Copilot (A, B, C)
```

## Team

| | Learning path |
|---|---|
| **A** | Simulation → data calibration → diagnosis (graph, Bayesian, SHAP) → diagnosis UI, MLOps |
| **B** | Data & infra → fault injection → ML/DL detection → LLM copilot → RL benchmark |
| **C** | API & 3D → RL environment & PPO → Play mode → integration & demo |

## What is done (days 1–2, Person B)

| Task | Deliverable | Where |
|---|---|---|
| **T02** KPI workshop | One-page KPI sheet: business KPIs (downtime, availability, throughput, MTTR, MTBF, OEE, cost), one KPI per AI module, benchmark protocol, reading notes | [docs/KPI.md](docs/KPI.md) |
| **T04** Data infra | `docker compose up` starts Mosquitto (MQTT + WebSocket) and TimescaleDB with the full schema | [docker-compose.yml](docker-compose.yml), [infra/](infra/) |
| T04 schema | Hypertables `sensor_readings`, `events`, `production`, `interventions`; reference tables `machines`, `machine_links`, `sensor_types`; 1-min continuous aggregate; compression policy; KPI views | [infra/timescaledb/init/01_schema.sql](infra/timescaledb/init/01_schema.sql) |
| T04 ingestion | MQTT → TimescaleDB ingestor: validates messages (Pydantic), batches inserts, drops bad messages, auto-registers new machines | [services/ingestor/](services/ingestor/) |
| Contracts | MQTT topics + JSON payloads + DB tables, shared with A (publisher) and C (API) | [docs/DATA_CONTRACTS.md](docs/DATA_CONTRACTS.md) |
| Tests | 11 unit tests on message validation; fake publisher + SQL health check for end-to-end | [tests/](tests/), [scripts/](scripts/) |

## Quick start

Prerequisites: Docker Desktop (running), Python 3.11+.

```powershell
copy .env.example .env                       # optional, defaults work
docker compose up -d --build                 # broker + database + ingestor
docker compose ps                            # all 3 services "healthy"/"running"

pip install paho-mqtt pytest pydantic
python scripts/publish_fake_data.py --seconds 15 --fault M3   # fake data, M3 degrades
Get-Content scripts/check_db.sql | docker compose exec -T timescaledb psql -U twin -d twin

python -m pytest -q tests                    # unit tests
```

Connect to the DB with any SQL client: `postgresql://twin:twin_dev_password@localhost:5432/twin`.
Watch MQTT live: `docker compose exec mosquitto mosquitto_sub -t "factory/#" -v`.
Reset everything (deletes data): `docker compose down -v`.

## Project layout

```
docker-compose.yml           broker + DB + ingestor
infra/mosquitto/             broker config
infra/timescaledb/init/      SQL schema (runs on first start)
services/ingestor/           MQTT -> TimescaleDB service
scripts/                     fake publisher, DB health check
docs/                        KPI sheet, data contracts
tests/                       unit tests
```

## Next steps

### Person B (me)
| Day | Task | To do |
|---|---|---|
| J3–J4 | **T07** real datasets | Download NASA C-MAPSS, CWRU, AI4I 2020 into `data/raw/` (git-ignored); one EDA notebook each; load cleaned data into `sensor_readings` with `source='cmapss'/'cwru'/'ai4i'` |
| J1–J2 (binôme) | T05 API (with C) | Review C's FastAPI; plug `/state` on `latest_readings` + last `state` from `events` |
| J4–J5 (binôme) | T06 sensors (with A) | Make the simulation publish with the topics/payloads of `docs/DATA_CONTRACTS.md` |
| J5–J6 | **T09** fault injection | 11 faults in 5 families, YAML scenarios with seed + `scenario_id`, publish `fault_injected` events |
| J5 | T10 teach-back | 20-min explanation of the data pipeline; MVP milestone J1 |
| J6–J7 | **T13** Isolation Forest baseline | precision / recall / F1 on real data |
| J8–J10 | **T16** PyTorch autoencoder | ROC/PR curves, CWRU then simulation |
| J9–J11 | **T24** LLM copilot + RAG | answers only from repair manuals, cites sources |
| J10–J12 | **T20** LSTM/TCN | fault type + RUL (RMSE on C-MAPSS) |
| J11 | **T22** SHAP | explanation for every alert |
| J12–J13 | **T28** benchmark, **T30** tests, **T29** business model | |

### Infra improvements (when needed, not now)
- Security before any real machine (T26): `allow_anonymous false` + password file + TLS on Mosquitto; real DB password via `.env`.
- Add an `intervention` MQTT topic if the RL agent publishes decisions instead of writing to the DB.
- Fault catalogue table once T09 fixes the 11 fault codes.
- Retention policy on raw readings if the dataset generation (T12, 200+ scenarios) fills the disk.

## Learning resources (Person B path)

### Books
- *Designing Data-Intensive Applications* — Martin Kleppmann (data systems, streams, storage). 2nd edition in progress at O'Reilly.
- *Hands-On Machine Learning with Scikit-Learn, Keras & TensorFlow* — Aurélien Géron (ML fundamentals, Isolation Forest, autoencoders). A PyTorch edition is also announced.
- *Deep Learning with PyTorch* — Stevens, Antiga, Viehmann (free PDF from the PyTorch site).
- *Interpretable Machine Learning* — Christoph Molnar (free online: christophm.github.io/interpretable-ml-book) — SHAP chapter for T22.
- *Reinforcement Learning: An Introduction* (2nd ed.) — Sutton & Barto (free: incompleteideas.net/book/the-book.html) — for T28 benchmark.
- *Designing Machine Learning Systems* and *AI Engineering* — Chip Huyen (MLOps, LLM apps, RAG evaluation).
- *Docker Deep Dive* — Nigel Poulton.

### YouTube
- **TechWorld with Nana** — Docker & Docker Compose full tutorials.
- **HiveMQ** channel + their written series *MQTT Essentials* (hivemq.com/mqtt) — best MQTT intro.
- **Timescale** channel — hypertables, continuous aggregates.
- **StatQuest with Josh Starmer** — metrics (precision/recall, ROC), trees, PCA, intuition for ML.
- **3Blue1Brown** — *Neural Networks* series (intuition for backprop, transformers).
- **Andrej Karpathy** — *Neural Networks: Zero to Hero* (PyTorch from scratch, LLMs).
- **Steve Brunton** — data-driven engineering, time series, control.
- **DeepMind x UCL RL lectures (David Silver)** — RL foundations.
- **DeepLearning.AI** short courses — RAG, embeddings, LLM apps (free).

### Official documentation
- Mosquitto: https://mosquitto.org/documentation/ · Paho Python: https://eclipse.dev/paho/files/paho.mqtt.python/html/
- TimescaleDB: https://docs.timescale.com/ · PostgreSQL: https://www.postgresql.org/docs/
- Docker Compose: https://docs.docker.com/compose/
- Pydantic: https://docs.pydantic.dev/ · FastAPI: https://fastapi.tiangolo.com/
- pandas: https://pandas.pydata.org/docs/ · scikit-learn User Guide (outlier detection): https://scikit-learn.org/stable/modules/outlier_detection.html
- PyTorch tutorials: https://pytorch.org/tutorials/
- SHAP: https://shap.readthedocs.io/
- Gymnasium: https://gymnasium.farama.org/ · Stable-Baselines3: https://stable-baselines3.readthedocs.io/ · OR-Tools: https://developers.google.com/optimization
- Hugging Face Deep RL course: https://huggingface.co/learn/deep-rl-course
- MathWorks Predictive Maintenance Toolbox (workflow & concepts): https://www.mathworks.com/help/predmaint/

### Datasets (T07)
- NASA C-MAPSS turbofan degradation — NASA Prognostics Center of Excellence data repository (Saxena et al., PHM 2008).
- CWRU Bearing Data Center — Case Western Reserve University.
- AI4I 2020 Predictive Maintenance Dataset — UCI Machine Learning Repository (Matzka, 2020).
