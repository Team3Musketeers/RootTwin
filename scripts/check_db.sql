-- Quick health check of the data pipeline.
-- docker compose exec -T timescaledb psql -U twin -d twin < scripts/check_db.sql

\echo '--- hypertables'
SELECT hypertable_name FROM timescaledb_information.hypertables ORDER BY 1;

\echo '--- row counts'
SELECT 'sensor_readings' AS tbl, count(*) FROM sensor_readings
UNION ALL SELECT 'events', count(*) FROM events
UNION ALL SELECT 'production', count(*) FROM production
UNION ALL SELECT 'machines', count(*) FROM machines;

\echo '--- latest readings (first 8)'
SELECT machine_id, sensor, round(value::numeric, 2) AS value, time
FROM latest_readings ORDER BY machine_id, sensor LIMIT 8;

\echo '--- last events'
SELECT time, machine_id, event_type, state, fault_code, severity
FROM events ORDER BY time DESC LIMIT 10;
