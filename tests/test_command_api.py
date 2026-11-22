import json

from fastapi.testclient import TestClient

from roottwin.command_api import app, get_publisher


class FakePublisher:
    def __init__(self, fail=False):
        self.sent, self.fail = [], fail

    def publish_json(self, topic, body, qos=1, timeout=5.0):
        if self.fail:
            raise ConnectionError("broker down")
        self.sent.append((topic, json.loads(body)))


def client(pub):
    app.dependency_overrides[get_publisher] = lambda: pub
    return TestClient(app)


def test_post_command_publishes():
    pub = FakePublisher()
    r = client(pub).post("/command/line1/M3", json={"command": "set_speed", "params": {"factor": 1.5}})
    assert r.status_code == 202, r.text
    assert r.json()["topic"] == "factory/line1/M3/cmd"
    topic, body = pub.sent[0]
    assert body["command"] == "set_speed" and body["params"] == {"factor": 1.5}


def test_bad_command_422_and_nothing_sent():
    pub = FakePublisher()
    c = client(pub)
    assert c.post("/command/line1/M3", json={"command": "start_line"}).status_code == 422
    assert c.post("/command/line1/M3", json={"command": "set_speed", "params": {"factor": 99}}).status_code == 422
    assert c.post("/command/line1/M3", json={"command": "nope"}).status_code == 422
    assert pub.sent == []


def test_broker_down_503():
    r = client(FakePublisher(fail=True)).post("/command/line1/LINE", json={"command": "start_line"})
    assert r.status_code == 503


def test_inject_fault_checks_catalog():
    pub = FakePublisher()
    c = client(pub)
    assert c.post("/command/line1/M3", json={"command": "inject_fault",
                                             "params": {"fault_code": "NOPE"}}).status_code == 422
    r = c.post("/command/line1/M3", json={"command": "inject_fault", "params": {"fault_code": "OVERHEATING"}})
    assert r.status_code == 202 and len(pub.sent) == 1
    assert len(c.get("/command/faults").json()) == 11


def test_catalog_lists_all_commands():
    cat = client(FakePublisher()).get("/command/catalog").json()
    names = {c["command"] for c in cat}
    assert {"start_line", "inject_fault", "dispatch_worker", "set_time_scale"} <= names
    assert all(c["level"] in ("line", "machine") for c in cat)
