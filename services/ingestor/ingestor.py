"""MQTT -> TimescaleDB ingestor.

Subscribes to factory/#, validates each message (schemas.py), buffers rows and
writes them in batches (every FLUSH_INTERVAL_S seconds or BATCH_SIZE rows).
Bad messages are logged and dropped; they never crash the service.
"""
from __future__ import annotations

import logging
import os
import queue
import signal
import time
from collections import defaultdict

import paho.mqtt.client as mqtt
import psycopg2
from psycopg2.extras import Json, execute_values
from pydantic import ValidationError

from schemas import COLUMNS, to_rows

MQTT_HOST = os.getenv("MQTT_HOST", "localhost")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_TOPIC = os.getenv("MQTT_TOPIC", "factory/#")
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://twin:twin_dev_password@localhost:5432/twin")
FLUSH_INTERVAL_S = float(os.getenv("FLUSH_INTERVAL_S", "1.0"))
BATCH_SIZE = int(os.getenv("BATCH_SIZE", "500"))

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"),
                    format="%(asctime)s %(levelname)s ingestor: %(message)s")
log = logging.getLogger(__name__)

# (table, row, line_id, machine_id)
inbox: "queue.Queue[tuple[str, tuple, str, str]]" = queue.Queue(maxsize=100_000)
running = True


def on_connect(client, userdata, flags, reason_code, properties):
    if reason_code.is_failure:
        log.error("MQTT connect failed: %s", reason_code)
        return
    client.subscribe(MQTT_TOPIC, qos=1)
    log.info("connected to MQTT %s:%s, subscribed to %s", MQTT_HOST, MQTT_PORT, MQTT_TOPIC)


def on_message(client, userdata, msg):
    try:
        table, rows, topic = to_rows(msg.topic, msg.payload)
    except (ValueError, ValidationError) as exc:
        log.warning("dropped message on %s: %s", msg.topic, str(exc).splitlines()[0])
        return
    for row in rows:
        try:
            inbox.put_nowait((table, row, topic.line_id, topic.machine_id))
        except queue.Full:
            log.error("ingest buffer full, dropping data (is the DB down?)")
            return


def connect_db(retries: int = 30):
    for attempt in range(1, retries + 1):
        try:
            conn = psycopg2.connect(DATABASE_URL)
            conn.autocommit = False
            log.info("connected to TimescaleDB")
            return conn
        except psycopg2.OperationalError as exc:
            log.warning("DB not ready (%s/%s): %s", attempt, retries, str(exc).strip())
            time.sleep(2)
    raise RuntimeError("could not connect to TimescaleDB")


def flush(conn, known_machines: set[str]) -> int:
    batch: dict[str, list[tuple]] = defaultdict(list)
    new_machines: set[tuple[str, str]] = set()
    while len(batch) == 0 or sum(map(len, batch.values())) < BATCH_SIZE:
        try:
            table, row, line_id, machine_id = inbox.get_nowait()
        except queue.Empty:
            break
        if table == "events":
            row = (*row[:-1], Json(row[-1]))  # payload dict -> JSONB
        batch[table].append(row)
        if machine_id not in known_machines:
            new_machines.add((machine_id, line_id))
    if not batch:
        return 0

    with conn.cursor() as cur:
        if new_machines:
            execute_values(cur,
                "INSERT INTO machines (machine_id, line_id) VALUES %s ON CONFLICT DO NOTHING",
                list(new_machines))
        for table, rows in batch.items():
            cols = ", ".join(COLUMNS[table])
            execute_values(cur, f"INSERT INTO {table} ({cols}) VALUES %s", rows)
    conn.commit()
    known_machines.update(m for m, _ in new_machines)
    n = sum(map(len, batch.values()))
    log.debug("flushed %s rows", n)
    return n


def stop(*_):
    global running
    running = False


def main():
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    conn = connect_db()
    with conn.cursor() as cur:
        cur.execute("SELECT machine_id FROM machines")
        known = {r[0] for r in cur.fetchall()}
    conn.commit()

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="twin-ingestor")
    client.on_connect = on_connect
    client.on_message = on_message
    client.reconnect_delay_set(min_delay=1, max_delay=30)
    client.connect_async(MQTT_HOST, MQTT_PORT, keepalive=30)
    client.loop_start()

    total = 0
    last_report = time.monotonic()
    while running:
        time.sleep(FLUSH_INTERVAL_S)
        try:
            while (n := flush(conn, known)) > 0:
                total += n
        except psycopg2.Error as exc:
            log.error("DB write failed, reconnecting: %s", exc)
            try:
                conn.close()
            except psycopg2.Error:
                pass
            conn = connect_db()
        if time.monotonic() - last_report > 60:
            log.info("rows written so far: %s (buffer=%s)", total, inbox.qsize())
            last_report = time.monotonic()

    log.info("shutting down, flushing buffer")
    client.loop_stop()
    while flush(conn, known) > 0:
        pass
    conn.close()


if __name__ == "__main__":
    main()
