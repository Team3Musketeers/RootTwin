"""Multiplayer floor: presence, one operator per machine, actions shared, claims released on leave, slow clients dropped."""
import json
import socket
import threading
import time

import uvicorn
from websockets.sync.client import connect

from roottwin.api import app
from roottwin.floor import floor


def _server():
    """Real uvicorn (one event loop, like production); TestClient runs each socket in its own loop."""
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    srv = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", lifespan="off"))
    threading.Thread(target=srv.run, daemon=True).start()
    while not srv.started:
        time.sleep(0.05)
    return srv, f"ws://127.0.0.1:{port}/ws/floor"


def test_floor_claims_and_actions():
    floor.__init__()
    srv, url = _server()
    try:
        with connect(url) as a, connect(url) as b:
            rx = lambda ws: json.loads(ws.recv(timeout=5))      # noqa: E731
            a.send(json.dumps({"type": "hello", "name": "Ana", "role": "technician"}))
            assert rx(a)["type"] == "welcome"
            b.send(json.dumps({"type": "hello", "name": "Bo", "role": "hacker"}))
            wb = rx(b)
            assert [p["role"] for p in wb["players"]] == ["technician", "operator"]       # unknown role -> operator
            assert rx(a)["type"] == "join"

            a.send(json.dumps({"type": "action", "a": {"m": "claim", "id": "CNC", "who": "Mallory"}}))
            for ws in (a, b):
                assert rx(ws)["a"] == {"m": "claim", "id": "CNC", "who": "Ana"}          # name from the server
            b.send(json.dumps({"type": "action", "a": {"m": "set", "id": "CNC", "key": "rpm", "v": 11000}}))
            assert rx(b) == {"type": "denied", "reason": "CNC is operated by Ana"}
            b.send(json.dumps({"type": "pose", "x": float("nan"), "z": 0, "yaw": 0}))  # ignored, never broadcast
            b.send(json.dumps({"type": "action", "a": {"m": "estop", "id": "CNC"}}))   # E-stop always allowed
            assert rx(a)["a"]["m"] == "estop"
            assert rx(b)["a"]["m"] == "estop"
        for _ in range(50):
            if not floor.players:
                break
            time.sleep(0.05)
        assert floor.claims == {} and floor.players == {}                                # both left: claims released
    finally:
        srv.should_exit = True


def test_slow_client_is_dropped_not_waited_for():
    import asyncio

    from roottwin.floor import OUTBOX, Floor

    f = Floor()
    slow, fast = asyncio.Queue(maxsize=OUTBOX), asyncio.Queue(maxsize=OUTBOX)
    f.queues = {"P1": slow, "P2": fast}

    async def run():
        for i in range(OUTBOX + 1):                                    # slow never drains its outbox
            await f.broadcast({"i": i})
            fast.get_nowait()
    asyncio.run(run())
    assert list(f.queues) == ["P2"]                                    # slow dropped, fast kept
    items = [slow.get_nowait() for _ in range(slow.qsize())]
    assert items[-1] is None                                           # sentinel tells its sender to close
