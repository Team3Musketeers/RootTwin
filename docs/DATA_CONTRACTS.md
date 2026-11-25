# Data contracts (MQTT + database)

Owner: Person B (data & infra). Any change must be agreed by the 3 members
(Person A publishes from the simulation, Person C reads from the API).
Code reference: `services/ingestor/schemas.py`.

## MQTT topics

```
factory/{line_id}/{machine_id}/telemetry    sensor values (one message, all sensors)
factory/{line_id}/{machine_id}/event        discrete events (faults, alarms, state changes, repairs)
factory/{line_id}/{machine_id}/production   parts produced since last message
factory/{line_id}/{machine_id|LINE}/cmd     commands to the simulation (UI, RL agent, scenarios) — T33
factory/{line_id}/LINE/snapshot             whole-line state for the 3D, 2×/real s, retained, NOT stored — T01/T03
```

- Broker: `localhost:1883` (MQTT) or `ws://localhost:9001` (WebSocket). In Docker: `mosquitto:1883`.
- QoS 1. Payload = JSON, UTF-8.
- `ts`: ISO-8601 (`2026-11-24T10:00:00Z`) or epoch seconds. No timezone = UTC. Optional (default = reception time).
- `source`: `sim` (default) | `cmapss` | `cwru` | `ai4i` | `enterprise`.
- `scenario_id`: optional, set by the simulation / fault injection (T09) to replay and label runs.

### telemetry
```json
{"ts": "2026-11-24T10:00:00Z", "scenario_id": "S042",
 "sensors": {"vibration": 2.31, "temperature": 46.8, "current": 12.1, "cadence": 29.5}}
```
Units: vibration mm/s, temperature °C, current A, cadence parts/min (table `sensor_types`).

### event
```json
{"ts": "2026-11-24T10:05:12Z", "scenario_id": "S042",
 "event_type": "state_change", "state": "degraded", "fault_code": "BEARING_WEAR",
 "severity": 3, "payload": {"injected_by": "T09"}}
```
- `event_type`: `fault_injected`, `alarm`, `failure`, `state_change`, `repair_start`, `repair_end`, …
- `state`: `ok` | `degraded` | `down` → green / orange / red in the 3D scene.
- `severity`: 1 (info) … 5 (critical).

Events published by the simulation (Person A, details in [SIMULATION.md](SIMULATION.md)):
`fault_injected`, `state_change` (also `maintenance`), `failure`, `repair_start`, `repair_end`,
`inspection`, `fault_cleared`, `order_started`, `order_completed`, `command_rejected`; every
payload carries `sim_s` (simulated seconds).

### production
```json
{"ts": "2026-11-24T10:05:00Z", "parts_ok": 3, "parts_scrap": 0}
```
From the simulation: `parts_ok` = parts the machine processed without creating a defect,
`parts_scrap` = defects created **by this machine** (removed later at quality control M5).
Good parts out of the line = `parts_ok` of the last machine (M6).

### snapshot (T01/T03, Person A)
Live state of the whole line for the 3D scene (T08/T32) and the API, published by the simulation
on `factory/{line}/LINE/snapshot` twice per real second, **QoS 0, retained** (a new subscriber
gets the latest one at once). The ingestor validates it but does **not** store it.
Schema: `roottwin/contracts.py` (`Snapshot`). Abridged:
```json
{"ts": "2026-11-25T10:00:00Z", "source": "sim", "line_id": "line1", "seq": 812,
 "sim_time_s": 24360.0, "time_scale": 60.0, "status": "running",
 "machines": [{"machine_id": "M3", "name": "Drilling", "machine_type": "drill", "position": 3,
               "state": "degraded", "activity": "working", "speed_factor": 1.0, "health": 0.93,
               "sensors": {"vibration": 4.1, "temperature": 47.2, "current": 12.3, "cadence": 28.0},
               "active_faults": ["BEARING_WEAR"], "current_part": "P0001234", "cycle_progress": 0.4,
               "buffer_in": 10, "buffer_in_capacity": 10, "parts_ok": 11870, "parts_scrap": 0,
               "downtime_s": 0.0}, "…"],
 "conveyors": [{"conveyor_id": "C3", "from_id": "M3", "to_id": "M4", "moving": true, "transit_s": 12,
                "parts": [{"part_id": "P0001230", "order_id": "ORD-0001", "pos": 0.92, "defect": false}]}, "…"],
 "orders": [{"order_id": "ORD-0001", "product": "A", "quantity": 20000, "released": 11950,
             "completed": 11800, "scrap": 0, "status": "in_progress"}],
 "kpis": {"parts_ok": 11800, "parts_scrap": 0, "wip": 150, "throughput_per_h": 1702.0,
          "availability": 1.0, "performance": 0.99, "quality": 1.0, "oee": 0.99, "line_downtime_s": 0.0}}
```
- `state` → colour (ok green, degraded orange, down red, maintenance blue);
  `activity` = working | starved | blocked | stopped | down | maintenance.
- `pos` 0 → 1 along the belt, head first; interpolate between snapshots with `sim_time_s`.
- `active_faults` is simulation ground truth: show it in teacher/debug views only, never feed it to the AI.

### cmd (T33)
The UI, the RL agent and the scenario runner drive the simulation through the **same** commands,
so a human and the AI are comparable and every run is replayable. The simulation subscribes to
`factory/{line}/+/cmd`; the ingestor logs every command in `events` (`event_type = 'command'`).

```json
{"command_id": "5b50…", "ts": "2026-11-24T10:05:00Z", "command": "inject_fault",
 "params": {"fault_code": "BEARING_WEAR", "ramp_min": 30}, "issued_by": "ui", "scenario_id": "S042"}
```

| Level (target) | Command | Params |
|---|---|---|
| line (`LINE`) | `start_line`, `stop_line`, `pause_line` | — |
| line (`LINE`) | `create_order` | `quantity` (≥1), `product` (default `A`), `order_id` (auto) |
| line (`LINE`) | `set_time_scale` | `scale` 0.1–600 (sim seconds per real second) |
| machine | `start_machine`, `stop_machine`, `repair`, `clear_fault`, `preventive_maintenance` | — |
| machine | `set_speed` | `factor` 0.1–3.0 (1 = nominal, higher = faster wear) |
| machine | `set_buffer` | `capacity` 0–200 parts |
| machine | `inject_fault` | `fault_code` (catalogue), optional `ramp_min`, `severity` 1–5 |
| machine | `dispatch_worker` | `action` inspect/repair/replace/preventive_maintenance, optional `worker_id` |

`issued_by`: `ui` · `rl` · `scenario` · `script` · `human` · `baseline`. Unknown params are rejected.
Schema: `roottwin/contracts.py` (`Command`). HTTP relay: `POST /command/{line}/{target}` on
`http://localhost:8001` (Swagger at `/docs`), `GET /command/catalog`, `GET /command/faults`.

### Fault catalogue (T09)
`roottwin/faults/catalog.yaml` — 11 faults in 5 families (mechanical, electrical, thermal, sensor,
process) with their sensor signature, onset, time to failure, repair skill/time/cost and LOTO flag.
The simulation applies them with `ActiveFault.apply()` / `.state()`; see `scripts/publish_fake_data.py`
for a working example.

Invalid messages are logged and dropped by the ingestor (they never reach the DB).

## Database (TimescaleDB, `postgresql://twin:…@localhost:5433/twin`)

| Table / view | Kind | Content |
|---|---|---|
| `machines`, `machine_links` | table | machines and dependency graph (upstream → downstream) |
| `sensor_types` | table | sensor names + units |
| `sensor_readings` | hypertable | one row per (time, machine, sensor) — narrow format |
| `events` | hypertable | events above; `payload` is JSONB |
| `production` | hypertable | production counters |
| `interventions` | hypertable | maintenance actions (written by RL / API, not by MQTT) |
| `sensor_readings_1m` | continuous aggregate | 1-min avg/min/max per machine & sensor |
| `latest_readings` | view | last value of every sensor (for API `/state`) |
| `intervention_durations` | view | repair duration in minutes (MTTR) |

Useful queries for the API (T05):
```sql
-- current state of each machine
SELECT DISTINCT ON (machine_id) machine_id, state, time
FROM events WHERE state IS NOT NULL ORDER BY machine_id, time DESC;

-- last 10 minutes of vibration for M3
SELECT time, value FROM sensor_readings
WHERE machine_id = 'M3' AND sensor = 'vibration' AND time > now() - INTERVAL '10 minutes'
ORDER BY time;
```
