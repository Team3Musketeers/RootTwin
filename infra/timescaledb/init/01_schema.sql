-- =====================================================================
-- Factory digital twin - TimescaleDB schema (task T04 - Person B)
-- Runs automatically the FIRST time the timescaledb container starts
-- (empty volume). To re-run: docker compose down -v && docker compose up -d
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ---------------------------------------------------------------------
-- 1. Reference data
-- ---------------------------------------------------------------------

-- Machines of the factory (6 machines in line for the simulation, T03).
-- Unknown machines seen on MQTT are auto-registered by the ingestor.
CREATE TABLE IF NOT EXISTS machines (
    machine_id      TEXT PRIMARY KEY,               -- e.g. 'M1'
    line_id         TEXT NOT NULL DEFAULT 'line1',
    name            TEXT,
    machine_type    TEXT,
    position        INT,                            -- order in the line (1..n)
    source          TEXT NOT NULL DEFAULT 'sim',    -- sim | enterprise
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Directed dependency graph between machines (upstream -> downstream).
-- Mirrors the NetworkX graph of the simulation; used by root-cause diagnosis (T15).
CREATE TABLE IF NOT EXISTS machine_links (
    upstream_id     TEXT NOT NULL REFERENCES machines(machine_id),
    downstream_id   TEXT NOT NULL REFERENCES machines(machine_id),
    link_type       TEXT NOT NULL DEFAULT 'conveyor', -- conveyor | buffer | utility
    PRIMARY KEY (upstream_id, downstream_id)
);

-- Sensors catalogue (4 sensors per machine for T06).
CREATE TABLE IF NOT EXISTS sensor_types (
    sensor          TEXT PRIMARY KEY,
    unit            TEXT NOT NULL,
    description     TEXT
);

INSERT INTO sensor_types (sensor, unit, description) VALUES
    ('vibration',   'mm/s',     'RMS vibration velocity'),
    ('temperature', 'degC',     'Bearing / motor temperature'),
    ('current',     'A',        'Motor current draw'),
    ('cadence',     'parts/min','Instantaneous production rate')
ON CONFLICT (sensor) DO NOTHING;

INSERT INTO machines (machine_id, line_id, name, machine_type, position) VALUES
    ('M1', 'line1', 'Feeder',          'feeder',     1),
    ('M2', 'line1', 'CNC milling',     'cnc',        2),
    ('M3', 'line1', 'Drilling',        'drill',      3),
    ('M4', 'line1', 'Welding robot',   'robot',      4),
    ('M5', 'line1', 'Quality control', 'inspection', 5),
    ('M6', 'line1', 'Packaging',       'packaging',  6)
ON CONFLICT (machine_id) DO NOTHING;

INSERT INTO machine_links (upstream_id, downstream_id) VALUES
    ('M1','M2'), ('M2','M3'), ('M3','M4'), ('M4','M5'), ('M5','M6')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------
-- 2. Time series (hypertables)
-- ---------------------------------------------------------------------

-- Sensor readings, long/narrow format: one row = one sensor value.
-- Narrow format lets us add sensors (or enterprise machines) without migrations.
CREATE TABLE IF NOT EXISTS sensor_readings (
    time            TIMESTAMPTZ      NOT NULL,
    machine_id      TEXT             NOT NULL,
    sensor          TEXT             NOT NULL,
    value           DOUBLE PRECISION NOT NULL,
    source          TEXT             NOT NULL DEFAULT 'sim',  -- sim | cmapss | cwru | ai4i | enterprise
    scenario_id     TEXT                                       -- simulation scenario (NULL for real data)
);
SELECT create_hypertable('sensor_readings', by_range('time', INTERVAL '1 day'), if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_readings_machine_sensor_time
    ON sensor_readings (machine_id, sensor, time DESC);
CREATE INDEX IF NOT EXISTS idx_readings_scenario
    ON sensor_readings (scenario_id, time DESC) WHERE scenario_id IS NOT NULL;

-- Discrete events: fault injections, alarms, failures, repairs, state changes...
CREATE TABLE IF NOT EXISTS events (
    time            TIMESTAMPTZ NOT NULL,
    machine_id      TEXT        NOT NULL,
    event_type      TEXT        NOT NULL,   -- fault_injected | alarm | failure | state_change | repair_start | repair_end | ...
    state           TEXT,                   -- ok | degraded | down  (green / orange / red in the 3D scene)
    fault_code      TEXT,                   -- from the fault catalogue (T09)
    severity        SMALLINT,               -- 1 (info) .. 5 (critical)
    source          TEXT        NOT NULL DEFAULT 'sim',
    scenario_id     TEXT,
    payload         JSONB       NOT NULL DEFAULT '{}'::jsonb
);
SELECT create_hypertable('events', by_range('time', INTERVAL '7 days'), if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_events_machine_time ON events (machine_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_events_type_time    ON events (event_type, time DESC);

-- Production counters (throughput / quality KPIs).
CREATE TABLE IF NOT EXISTS production (
    time            TIMESTAMPTZ NOT NULL,
    machine_id      TEXT        NOT NULL,
    parts_ok        INT         NOT NULL DEFAULT 0,
    parts_scrap     INT         NOT NULL DEFAULT 0,
    source          TEXT        NOT NULL DEFAULT 'sim',
    scenario_id     TEXT
);
SELECT create_hypertable('production', by_range('time', INTERVAL '7 days'), if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_production_machine_time ON production (machine_id, time DESC);

-- Maintenance interventions (MTTR, cost, worker / RL agent decisions).
CREATE TABLE IF NOT EXISTS interventions (
    intervention_id BIGSERIAL,
    time_start      TIMESTAMPTZ NOT NULL,
    time_end        TIMESTAMPTZ,
    machine_id      TEXT        NOT NULL,
    worker_id       TEXT,
    action          TEXT        NOT NULL,   -- inspect | repair | replace | wait
    fault_code      TEXT,
    decided_by      TEXT,                   -- corrective | preventive | condition | ortools | ppo | human
    cost_eur        NUMERIC(10,2),
    scenario_id     TEXT,
    PRIMARY KEY (intervention_id, time_start)
);
SELECT create_hypertable('interventions', by_range('time_start', INTERVAL '7 days'), if_not_exists => TRUE);

-- ---------------------------------------------------------------------
-- 3. Aggregates & policies
-- ---------------------------------------------------------------------

-- 1-minute averages for dashboards and ML features.
CREATE MATERIALIZED VIEW IF NOT EXISTS sensor_readings_1m
WITH (timescaledb.continuous) AS
SELECT time_bucket(INTERVAL '1 minute', time) AS bucket,
       machine_id, sensor,
       avg(value) AS avg_value,
       min(value) AS min_value,
       max(value) AS max_value,
       count(*)   AS n
FROM sensor_readings
GROUP BY bucket, machine_id, sensor
WITH NO DATA;

SELECT add_continuous_aggregate_policy('sensor_readings_1m',
    start_offset      => INTERVAL '1 hour',
    end_offset        => INTERVAL '1 minute',
    schedule_interval => INTERVAL '1 minute',
    if_not_exists     => TRUE);

-- Compress raw readings older than 7 days (big disk savings, still queryable).
ALTER TABLE sensor_readings SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'machine_id, sensor',
    timescaledb.compress_orderby   = 'time DESC'
);
SELECT add_compression_policy('sensor_readings', INTERVAL '7 days', if_not_exists => TRUE);

-- ---------------------------------------------------------------------
-- 4. KPI helper views (see docs/KPI.md)
-- ---------------------------------------------------------------------

-- Latest value of every sensor of every machine (used by API /state).
CREATE OR REPLACE VIEW latest_readings AS
SELECT DISTINCT ON (machine_id, sensor)
       machine_id, sensor, value, time, source, scenario_id
FROM sensor_readings
ORDER BY machine_id, sensor, time DESC;

-- Repair duration per finished intervention (MTTR = avg of repair_minutes).
CREATE OR REPLACE VIEW intervention_durations AS
SELECT intervention_id, machine_id, action, decided_by, scenario_id,
       time_start, time_end,
       EXTRACT(EPOCH FROM (time_end - time_start)) / 60.0 AS repair_minutes,
       cost_eur
FROM interventions
WHERE time_end IS NOT NULL;
