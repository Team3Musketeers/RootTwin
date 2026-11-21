# Data contracts (MQTT + database)

Owner: Person B (data & infra). Any change must be agreed by the 3 members
(Person A publishes from the simulation, Person C reads from the API).
Code reference: `services/ingestor/schemas.py`.

## MQTT topics

```
factory/{line_id}/{machine_id}/telemetry    sensor values (one message, all sensors)
factory/{line_id}/{machine_id}/event        discrete events (faults, alarms, state changes, repairs)
factory/{line_id}/{machine_id}/production   parts produced since last message
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

Invalid messages are logged and dropped by the ingestor (they never reach the DB).

## Database (TimescaleDB, `postgresql://twin:…@localhost:5432/twin`)

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
