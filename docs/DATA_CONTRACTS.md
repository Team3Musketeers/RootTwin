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

### production
```json
{"ts": "2026-11-24T10:05:00Z", "parts_ok": 3, "parts_scrap": 0}
```

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

### snapshot (for the 3D view, not stored)
Topic `twin/{line_id}/snapshot` (outside `factory/#`, so the ingestor ignores it), ~5 per real second,
published by the line (`scripts/run_line.py`, later Person A's simulation). The API relays it on `WS /ws`.

```json
{"t_min": 125.4, "running": true, "time_scale": 60, "order": {"id": "ORD-1", "left": 340},
 "machines": [{"id": "M3", "status": "working", "state": "degraded", "speed": 1.0, "enabled": true,
               "wear": 0.31, "worker": null, "faults": ["BEARING_WEAR"], "down_min": 12.0}],
 "buffers": [{"index": 0, "level": 3, "capacity": 5}],
 "workers": [{"id": "W1", "skill": "mechanic", "pos": 2.4, "task": {"machine": 2, "kind": "repair", "phase": "walk"}}],
 "parts": [{"id": 812, "where": "machine", "index": 2, "progress": 0.4},
           {"id": 813, "where": "buffer", "index": 1, "slot": 0}],
 "sensors": {"M3": {"vibration": 3.1, "temperature": 47.2, "current": 12.4, "cadence": 29.5}},
 "kpi": {"parts_ok": 105, "parts_scrap": 2, "throughput_per_h": 50.2, "availability": 0.91,
         "line_down_min": 11.0, "mttr_min": 18.0, "total_cost": 900.0, "profit": 1200.0}}
```
`status`: working · idle · starved · blocked · down · maintenance · stopped. `state` (ok/degraded/down)
is the ground-truth health from the fault model; the UI may show it, the AI agents never see it.

### alarm event (live detector)
`factory/{line}/{M}/event` with `event_type = "alarm"`, `fault_code` = best candidate, and `payload`
`{score, threshold, explanation, contributions, candidates, root_cause, is_root_cause, copilot}`.

### Fault catalogue (T09)
`roottwin/faults/catalog.yaml` — 11 faults in 5 families (mechanical, electrical, thermal, sensor,
process) with their sensor signature, onset, time to failure, repair skill/time/cost and LOTO flag.
The simulation applies them with `ActiveFault.apply()` / `.state()`; see `roottwin/line.py` (`Machine.faults`, `Line.sensors`)
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
