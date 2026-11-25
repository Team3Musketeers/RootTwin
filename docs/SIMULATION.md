# Factory simulation (Person A: T01 snapshot contract, T03 SimPy line, T06 sensors)

Code: [`roottwin/sim/`](../roottwin/sim/) · layout: [`roottwin/sim/line1.yaml`](../roottwin/sim/line1.yaml) ·
tests: `tests/test_sim_*.py`

## What it is

A discrete-event model of the 6-machine line, built with SimPy, that you can **drive**:

```
orders ─► feeder ─► [raw 3] M1 ─C1─► [10] M2 ─C2─► [10] M3 ─C3─► [10] M4 ─C4─► [10] M5 ─C5─► [10] M6 ─► out
          Feeder          CNC milling   Drilling   Welding robot   Quality ctrl   Packaging
          1.8 s           2.0 s         1.9 s      2.1 s (bottleneck)  1.6 s      1.9 s
```

- **Parts are tracked entities** (id, order, route, defect origin). They wait in buffers, ride
  accumulating conveyors (positions published for the 3D), and leave at the end of the line.
- **Orders**: nothing is produced until an order exists (`create_order`). Scrapped parts are
  replaced automatically until the order has its quantity of good parts.
- **Propagation is real, not scripted**: a stopped machine starves everything downstream and
  blocks everything upstream once the buffers fill. That is exactly what root-cause diagnosis
  (T15) has to see through: symptoms everywhere, one cause.
- **Faults** come from B's catalogue (`roottwin/faults/catalog.yaml`) through `ActiveFault`:
  the sensor signature and the ok → degraded → down timeline are B's; the simulation turns
  `down` into a stopped machine. `CONVEYOR_JAM` also freezes the machine's outgoing belt.
  Defective parts (TOOL_WEAR) are removed at quality control (M5).
- **Speed couples to wear**: `set_speed` changes the cycle time *and* the wear rate (∝ speed²),
  and with `--spontaneous-faults` the hazard of random faults grows with wear and speed.
- **Same model, two clocks**: real time (`simpy.rt`, speed changeable while running, pause
  freezes the clock) for the demo, or as fast as possible for datasets (8 h of line ≈ 2 s).

## Run it

```powershell
docker compose up -d --build                              # broker + DB + ingestor + command API (B);
                                                          # --build: the ingestor must know the snapshot topic
python -m roottwin.sim live --time-scale 60 --order 500   # 1 simulated minute per real second
```
Drive it with the same commands as the UI and the RL agent (T33 relay, Swagger on :8001/docs):
```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:8001/command/line1/M3 -ContentType "application/json" -Body '{"command":"inject_fault","params":{"fault_code":"BEARING_WEAR"}}'
Invoke-RestMethod -Method Post -Uri http://localhost:8001/command/line1/M3 -ContentType "application/json" -Body '{"command":"repair"}'
Invoke-RestMethod -Method Post -Uri http://localhost:8001/command/line1/LINE -ContentType "application/json" -Body '{"command":"set_time_scale","params":{"scale":5}}'
```
Other modes:
```powershell
python -m roottwin.sim live --scenario scenarios/demo_bearing_M3.yaml --order 5000   # scenario faults at their sim times
python -m roottwin.sim live --no-mqtt --seconds 20 --order 200                       # no broker: status lines only
python -m roottwin.sim live --auto-repair --spontaneous-faults 0.05                  # free play: faults happen by themselves
python -m roottwin.sim dataset --generate 200 --seed 42 --jobs 4 --out data/scenarios/sim_v1.parquet
python -m roottwin.sim --help
```

Time scale: x60 suits fault progression (BEARING_WEAR takes 2 real minutes to stop M3). At x60 a
part crosses a belt in 0.2 real seconds, too fast to follow by eye: switch to x1–x5 with
`set_time_scale` when the 3D shows the part flow.

Start the simulation **before** sending commands (wait for `connected to MQTT` in its log):
commands published while it is not connected are lost. This is on purpose (no persistent MQTT
session): a restarted line must not replay yesterday's fault injections.

Checked end to end (25 Nov, Docker): commands through the API on :8001 → simulation → MQTT →
ingestor → TimescaleDB; BEARING_WEAR on M3 went degraded/down at the catalogue times, vibration
rose before the stop, M1–M2 blocked and M4–M6 starved; `dispatch_worker` arrived after 2 min of
travel; the retained snapshot was readable and the ingestor logged no warning.

## What it publishes (contracts in [DATA_CONTRACTS.md](DATA_CONTRACTS.md))

| Topic | When | Content |
|---|---|---|
| `factory/line1/{M}/telemetry` | every telemetry period | 4 sensors (+ `sim_s`, ignored by the ingestor) |
| `factory/line1/{M}/production` | same period, if parts were made | `parts_ok` = processed without creating a defect, `parts_scrap` = defects made **by this machine** |
| `factory/line1/{M}/event` | on change | see below |
| `factory/line1/LINE/snapshot` | 2 per real second, QoS 0, retained | the whole line for the 3D (not stored) |

Telemetry period: about one message per machine per **real** second (= `time_scale` simulated
seconds, clamped to 1–60 s); 60 s in dataset mode (same step as B's offline stand-in).
Timestamps: wall clock in live mode; `2026-01-05T06:00Z + simulated time` in dataset mode.

Events (all with `payload.sim_s`):

| `event_type` | State / fault | Payload |
|---|---|---|
| `fault_injected` | fault_code, severity (command's or 3) | `injected_by` (ui, scenario, rl, spontaneous…), `ramp_min`, `command_id` |
| `state_change` | new state ok / degraded / down / maintenance, dominant fault | `previous` |
| `failure` | down | — (MTBF in the KPI sheet) |
| `repair_start`, `repair_end` | maintenance → ok | `action`, `minutes`, `cost_eur`, `fault_codes`, `decided_by`, `worker_id` |
| `inspection` | — | `found` (ground truth: fault, progress, state), `health` |
| `fault_cleared` | — | `fault_codes` |
| `order_started` (M1), `order_completed` (M6) | — | order id, quantity, completed, scrap, `lead_time_s` |
| `command_rejected` | — | command, params, `reason` |

## How each command behaves

| Command | Effect in the simulation |
|---|---|
| `start_line` / `stop_line` | machines and belts run / stop (motors off, temperatures cool down); a planned stop is not downtime |
| `pause_line` | live: the simulated clock freezes (nothing moves, no telemetry) |
| `create_order` | the feeder releases parts for it, FIFO across orders |
| `set_time_scale` | live: speed changes at once, without a catch-up burst |
| `start_machine` / `stop_machine` | operator stop (state stays ok, activity `stopped`) |
| `set_speed` | cycle time ÷ factor; wear ×factor²; vibration, current and heat rise |
| `set_buffer` | capacity of the buffer **after** the machine (0 = direct hand-over); rejected on M6 |
| `inject_fault` | catalogue fault from now (`ramp_min` overrides the onset); the same fault twice is rejected |
| `clear_fault` | removes the faults at once (teacher / debug) |
| `repair` | maintenance now, for the longest catalogue repair time of the active faults (10 min if none); faults cleared; wear ×0.5, or 0 if the catalogue says *replace* |
| `preventive_maintenance` | 20 min (or longer if a fault needs more), wear back to 0, faults cleared |
| `dispatch_worker` | **stand-in until T12**: 2 min travel, then `inspect` (5 min, reports the truth), `repair`, `replace` or `preventive_maintenance` |

## Sensor and wear model (T06)

One equation per sensor, each term explainable (`sensors.py`). u = share of the period the machine
was processing, s = speed factor, w = wear (0 new → 1 worn out):

- vibration = V0 · s · (0.25 + 0.75·u) · (1 + 0.6·w²) when the motor runs; 5 % of V0 when it is off
- current = (I_idle + (I_full − I_idle)·u·s^0.8) · (1 + 0.08·w); 0.2 A when off
- temperature → first-order lag (τ = 10 min) towards T_amb + ΔT·√s·(0.3 + 0.7·u) + 6·w²; ambient when off
- cadence = parts finished during the last minute
- then noise (3 % on vibration/current, ±0.3 °C), then the catalogue faults on top.

Wear is a **gamma process** (monotone, random, the usual choice for degradation and RUL): each
cycle adds Gamma(shape ∝ cycle time · speed², scale 1e-3); the mean working life is 40 h. The w²
terms keep signals flat for a long time, then accelerating, the shape B saw in C-MAPSS. All values
are first guesses in `line1.yaml`, to be **calibrated in T14**.

Healthy ranges (tested): vibration 0.9–2.4 mm/s, temperature 33–49 °C, current 5–15 A, cadence ≈ 28.6
parts/min, close to what B's first detectors were trained on.

## For the team

**C (3D / API)**: subscribe to `factory/line1/LINE/snapshot` (retained, so you get the state at once;
over WebSocket on `ws://localhost:9001`) or forward it from the API. Each snapshot has, in line order,
every machine (`state` for the colour, `activity`, `cycle_progress`, `current_part`, buffer level,
sensors, faults) and every conveyor with its parts' `pos` (0 → 1, head first). Interpolate positions
between two snapshots with `sim_time_s` and `time_scale`. Schema: `roottwin.contracts.Snapshot`.

**B (detection / RL / benchmark)**: `roottwin.sim.simulate_scenario(sc)` / `simulate_many(scs, jobs=4)`
return the same columns as `roottwin.faults.offline.simulate` (+ `activity`, `health`, `speed_factor`),
so the training scripts can switch to the real simulation as is. New in this data: starved machines go
quiet (cadence 0, idle vibration) while their `label` stays 0, because only the root-cause machine is
labelled. The RL environment (T17) can wrap `Factory` on a plain `simpy.Environment`: actions are
`apply_command(...)`, the state is `snapshot()`, time advances with `env.run(until=...)`.

**Diagnosis (A, T15)**: `build_graph(layout)` is the NetworkX dependency graph;
`upstream(g, m)` / `downstream(g, m)` give who is blocked / starved by `m`; `machine_links_rows(g)`
matches the `machine_links` table (tested against the SQL seed).

## Limits and next steps

- Serial lines only (each machine feeds at most one machine); parallel stations later if needed.
- `dispatch_worker` has no real workers yet → **T12**: worker agents (skills, positions, queue) and dataset v1 in the DB.
- Natural wear does not stop a machine by itself: failures come from catalogue faults (injected,
  or spontaneous with a wear/speed-dependent hazard), so every failure has a ground-truth code.
- Parameters are guesses → **T14** calibration on C-MAPSS / CWRU.
- Inspections always find the fault (perfect inspection).
