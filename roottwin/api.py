"""Main API (T05): REST + WebSocket for the 3D front-end.

    uvicorn roottwin.api:app --port 8000        # Swagger: http://localhost:8000/docs

- GET  /state              latest full snapshot (parts, machines, buffers, workers, KPI)
- GET  /events?limit=50    recent events and alarms from TimescaleDB
- GET  /machines/{id}/history?sensor=vibration&minutes=30
- POST /copilot/ask        {"question", "fault_codes"} -> cited answer from the manuals
- POST /command/{line}/{target}, GET /command/catalog, GET /command/faults   (T33 relay)
- /play/...                Play mode (T27)
- WS   /ws                 pushes {"type": "snapshot"|"event", "data": ...} in real time
- WS   /ws/floor           multiplayer floor: worker avatars, machine claims, shared operator actions
- GET  /                   the built front-end (frontend/dist) when present
"""
from __future__ import annotations

import asyncio
import json
import os
import threading
from contextlib import asynccontextmanager
from pathlib import Path

import paho.mqtt.client as mqtt
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from roottwin.command_api import router as command_router

LINE_ID = os.getenv("LINE_ID", "line1")
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://twin:twin_dev_password@localhost:5433/twin")
DIST = Path(__file__).resolve().parents[1] / "frontend" / "dist"


class Hub:
    """Keeps the latest snapshot from MQTT and fans messages out to WebSocket clients."""

    def __init__(self):
        self.snapshot: dict | None = None
        self.recent: list[dict] = []           # last alarms / events for new clients
        self.clients: set[asyncio.Queue] = set()
        self.loop: asyncio.AbstractEventLoop | None = None
        self._client: mqtt.Client | None = None

    def publish(self, msg: dict) -> None:
        """Thread-safe: called from the MQTT thread."""
        if self.loop is None:
            return
        for q in list(self.clients):
            self.loop.call_soon_threadsafe(_put_latest, q, msg)

    def on_message(self, _c, _u, m):
        try:
            data = json.loads(m.payload)
        except ValueError:
            return
        if m.topic.endswith("/snapshot"):
            self.snapshot = data
            self.publish({"type": "snapshot", "data": data})
        else:
            _, line, machine, _ = m.topic.split("/")
            data["machine_id"] = machine
            if data.get("event_type") in ("alarm", "failure", "repair_end", "fault_injected", "worker_dispatched",
                                          "state_change"):
                self.recent = (self.recent + [data])[-50:]
                self.publish({"type": "event", "data": data})

    def start(self, host: str, port: int) -> None:
        c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="roottwin-api")
        c.on_connect = lambda cl, *_: (cl.subscribe(f"twin/{LINE_ID}/snapshot"),
                                       cl.subscribe(f"factory/{LINE_ID}/+/event"))
        c.on_message = self.on_message
        c.reconnect_delay_set(1, 10)
        c.connect_async(host, port)
        c.loop_start()
        self._client = c

    def stop(self) -> None:
        if self._client:
            self._client.loop_stop()


def _put_latest(q: asyncio.Queue, msg: dict) -> None:
    if q.full():                               # slow client: drop the oldest, keep the newest
        q.get_nowait()
    q.put_nowait(msg)


hub = Hub()


@asynccontextmanager
async def lifespan(_: FastAPI):
    hub.loop = asyncio.get_running_loop()
    if os.getenv("ROOTTWIN_NO_MQTT") != "1":
        hub.start(os.getenv("MQTT_HOST", "localhost"), int(os.getenv("MQTT_PORT", "1883")))
    yield
    hub.stop()


app = FastAPI(title="RootTwin API", version="0.3.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"])
app.include_router(command_router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "snapshot": hub.snapshot is not None}


@app.get("/state")
def state() -> dict:
    if hub.snapshot is None:
        raise HTTPException(503, "no snapshot yet: is scripts/run_line.py (or the simulation) running?")
    return hub.snapshot


def _db():
    import psycopg2
    try:
        return psycopg2.connect(DATABASE_URL, connect_timeout=3)
    except psycopg2.OperationalError as exc:
        raise HTTPException(503, "database unavailable") from exc


@app.get("/events")
def events(limit: int = 50, event_type: str | None = None) -> list[dict]:
    limit = max(1, min(limit, 500))
    sql = ("SELECT time, machine_id, event_type, state, fault_code, severity, payload FROM events "
           "WHERE source IN ('sim','ui','rl','scenario','script') AND (%s IS NULL OR event_type = %s) "
           "ORDER BY time DESC LIMIT %s")
    with _db() as conn, conn.cursor() as cur:
        cur.execute(sql, (event_type, event_type, limit))
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]


@app.get("/machines/{machine_id}/history")
def history(machine_id: str, sensor: str = "vibration", minutes: int = 30) -> list[dict]:
    minutes = max(1, min(minutes, 24 * 60))
    with _db() as conn, conn.cursor() as cur:
        cur.execute("SELECT time, value FROM sensor_readings WHERE machine_id = %s AND sensor = %s "
                    "AND time > now() - make_interval(mins => %s) ORDER BY time", (machine_id, sensor, minutes))
        return [{"time": t, "value": v} for t, v in cur.fetchall()]


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    fault_codes: list[str] = Field(default_factory=list, max_length=5)
    alert_text: str | None = Field(default=None, max_length=2000)


_copilot = None


@app.post("/copilot/ask")
def copilot_ask(req: AskRequest) -> dict:
    global _copilot
    from roottwin.copilot import Copilot
    _copilot = _copilot or Copilot()
    return _copilot.ask(req.question, req.fault_codes or None, req.alert_text).to_dict()


@app.websocket("/ws")
async def ws(socket: WebSocket):
    await socket.accept()
    q: asyncio.Queue = asyncio.Queue(maxsize=20)
    hub.clients.add(q)
    try:
        if hub.snapshot:
            await socket.send_json({"type": "snapshot", "data": hub.snapshot})
        for ev in hub.recent[-20:]:
            await socket.send_json({"type": "event", "data": ev})
        while True:
            await socket.send_json(await q.get())
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        hub.clients.discard(q)


from roottwin.play import router as play_router  # noqa: E402  (after app: avoids a heavy import cycle)

app.include_router(play_router)

from roottwin.floor import router as floor_router  # noqa: E402

app.include_router(floor_router)

if DIST.exists():
    app.mount("/", StaticFiles(directory=DIST, html=True), name="frontend")
