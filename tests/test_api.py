import json
import os

import pytest

os.environ["ROOTTWIN_NO_MQTT"] = "1"
pytest.importorskip("gymnasium")

from fastapi.testclient import TestClient  # noqa: E402

from roottwin.api import app, hub  # noqa: E402
from roottwin.line import Line  # noqa: E402


class Msg:
    def __init__(self, topic, payload):
        self.topic, self.payload = topic, json.dumps(payload).encode()


@pytest.fixture()
def client():
    hub.snapshot, hub.recent = None, []
    with TestClient(app) as c:
        yield c


def test_state_needs_a_snapshot(client):
    assert client.get("/health").json()["snapshot"] is False
    assert client.get("/state").status_code == 503
    snap = Line(seed=0).snapshot()
    hub.on_message(None, None, Msg("twin/line1/snapshot", snap))
    assert client.get("/state").json()["machines"][0]["id"] == "M1"


def test_websocket_pushes_snapshot_and_events(client):
    hub.on_message(None, None, Msg("twin/line1/snapshot", Line(seed=0).snapshot()))
    hub.on_message(None, None, Msg("factory/line1/M3/event", {"event_type": "alarm", "payload": {"explanation": "x"}}))
    with client.websocket_connect("/ws") as ws:
        first, second = ws.receive_json(), ws.receive_json()
    assert first["type"] == "snapshot" and second == {"type": "event",
                                                      "data": {"event_type": "alarm", "payload": {"explanation": "x"},
                                                               "machine_id": "M3"}}


def test_copilot_endpoint(client):
    r = client.post("/copilot/ask", json={"question": "How do I repair it?", "fault_codes": ["OVERHEATING"]})
    assert r.status_code == 200 and r.json()["sources"]
    assert client.post("/copilot/ask", json={"question": ""}).status_code == 422


def test_play_loto_refusal_and_full_shift(client):
    g = client.post("/play/new", json={"seed": 3}).json()
    sid = g["session"]
    assert all(m["faults"] == [] for m in g["snapshot"]["machines"])      # hidden from the player
    r = client.post(f"/play/{sid}/step", json={"action": 7}).json()      # PM without LOTO
    assert r["safety_violations"] == 1 and "lockout" in r["last_message"].lower()
    r = client.post(f"/play/{sid}/step", json={"action": 7, "loto_confirmed": True}).json()
    assert r["safety_violations"] == 1
    while not r["done"]:
        r = client.post(f"/play/{sid}/step", json={"action": 0}).json()
    assert {"corrective", "preventive", "condition", "ortools"} <= set(r["ai"])
    assert client.post("/play/nope/step", json={"action": 0}).status_code == 404
