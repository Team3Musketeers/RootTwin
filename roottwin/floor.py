"""Multiplayer factory floor: worker avatars, machine claims and shared operator actions.

    WS /ws/floor
    client -> {"type": "hello", "name": "Ana", "role": "technician"}
              {"type": "pose", "x": 1.2, "z": -3.4, "yaw": 0.5}
              {"type": "action", "a": {"m": "set", "id": "CNC", "key": "rpm", "v": 9000}}
    server -> {"type": "welcome", "id", "players", "claims", "log"}   (log = recent actions, replayed by late joiners)
              {"type": "join"|"leave"|"pose", ...}, {"type": "action", "a", "from"}, {"type": "denied", "reason"}

The server owns presence and machine claims (one operator per machine); every client runs the same twin
simulation and applies the same action stream, so faults, line stops and repairs happen on every screen.
shortcut: state lives in this API process (one uvicorn worker); move it to Redis/MQTT if the API is scaled out.
"""
from __future__ import annotations

import asyncio
import itertools
import json
import math

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()

ROLES = {"operator", "technician", "maintenance", "supervisor"}
ACTIONS = {"start", "stop", "estop", "reset", "mode", "set", "repair", "claim", "fault", "clear", "line", "speed", "force"}
MAX_MSG, LOG_LEN, OUTBOX = 2000, 400, 256


class Floor:
    def __init__(self):
        self.players: dict[str, dict] = {}            # id -> {id, name, role, x, z, yaw}
        self.queues: dict[str, asyncio.Queue] = {}   # per-client outbox: a slow client never stalls the others
        self.claims: dict[str, str] = {}              # machine id -> player id
        self.log: list[dict] = []
        self._ids = itertools.count(1)

    async def broadcast(self, msg: dict, skip: str | None = None) -> None:
        for pid in list(self.queues):
            if pid != skip:
                await self.reply(pid, msg)

    async def reply(self, pid: str, msg: dict) -> None:
        q = self.queues.get(pid)
        if q is None:
            return
        try:
            q.put_nowait(msg)
        except asyncio.QueueFull:                     # client stopped reading: drop it rather than stall the floor
            self.queues.pop(pid, None)
            q.get_nowait()
            q.put_nowait(None)                        # sentinel: its sender closes the socket

    def check(self, pid: str, a: dict) -> tuple[dict | None, str | None]:
        """Validate an action from player `pid`; returns (action to broadcast, refusal reason)."""
        if not isinstance(a, dict) or a.get("m") not in ACTIONS:
            return None, "unknown action"
        mid = a.get("id")
        if mid is not None and (not isinstance(mid, str) or len(mid) > 16):
            return None, "bad machine id"
        if "v" in a and not (a["v"] is None and a["m"] == "force") and not isinstance(a["v"], (int, float)):
            return None, "bad value"
        if any(not isinstance(a.get(k, ""), str) or len(a.get(k, "")) > 80 for k in ("tag", "part", "key", "code")):
            return None, "bad field"
        owner = self.claims.get(mid) if mid else None
        if a["m"] == "claim":
            if a.get("who") is None:                  # release
                if owner != pid:
                    return None, "not your machine"
                del self.claims[mid]
                return {"m": "claim", "id": mid, "who": None}, None
            if owner and owner != pid:
                return None, f"{mid} is operated by {self.players[owner]['name']}"
            self.claims[mid] = pid
            return {"m": "claim", "id": mid, "who": self.players[pid]["name"]}, None   # never trust the client's name
        if owner and owner != pid and a["m"] not in ("estop", "repair"):              # anyone may hit an E-stop or repair
            return None, f"{mid} is operated by {self.players[owner]['name']}"
        return a, None


floor = Floor()


async def _send_loop(socket: WebSocket, q: asyncio.Queue) -> None:
    try:
        while (msg := await q.get()) is not None:
            await socket.send_json(msg)
        await socket.close(code=1013)                 # 1013 = try again later (too slow)
    except (WebSocketDisconnect, RuntimeError):
        pass


@router.websocket("/ws/floor")
async def ws_floor(socket: WebSocket):
    await socket.accept()
    pid, sender = None, None
    try:
        hello = await socket.receive_json()
        if hello.get("type") != "hello":
            await socket.close(code=1008)
            return
        pid = f"P{next(floor._ids)}"
        name = str(hello.get("name") or pid).strip()[:24] or pid
        role = hello.get("role") if hello.get("role") in ROLES else "operator"
        floor.players[pid] = {"id": pid, "name": name, "role": role, "x": 0.0, "z": 6.0, "yaw": 0.0}
        q: asyncio.Queue = asyncio.Queue(maxsize=OUTBOX)
        floor.queues[pid] = q
        await socket.send_json({"type": "welcome", "id": pid, "players": list(floor.players.values()),
                                "claims": {m: floor.players[p]["name"] for m, p in floor.claims.items()}, "log": floor.log})
        sender = asyncio.create_task(_send_loop(socket, q))
        await floor.broadcast({"type": "join", "player": floor.players[pid]}, skip=pid)
        while True:
            raw = await socket.receive_text()
            if len(raw) > MAX_MSG:
                continue
            msg = json.loads(raw)
            if not isinstance(msg, dict):
                continue
            if msg.get("type") == "pose":
                p = floor.players[pid]
                try:
                    x, z, yaw = float(msg["x"]), float(msg["z"]), float(msg["yaw"])
                except (KeyError, TypeError, ValueError):
                    continue
                if not all(math.isfinite(v) and abs(v) < 1e4 for v in (x, z, yaw)):
                    continue
                p.update(x=x, z=z, yaw=yaw)
                await floor.broadcast({"type": "pose", "id": pid, "x": p["x"], "z": p["z"], "yaw": p["yaw"]}, skip=pid)
            elif msg.get("type") == "action":
                a, why = floor.check(pid, msg.get("a"))
                if why:
                    await floor.reply(pid, {"type": "denied", "reason": why})
                    continue
                floor.log = (floor.log + [a])[-LOG_LEN:]
                await floor.broadcast({"type": "action", "a": a, "from": floor.players[pid]["name"]})   # echo to sender too
    except (WebSocketDisconnect, RuntimeError, json.JSONDecodeError):
        pass
    finally:
        if sender:
            sender.cancel()
        if pid and pid in floor.players:
            floor.queues.pop(pid, None)
            released = [m for m, p in floor.claims.items() if p == pid]
            for m in released:
                del floor.claims[m]
                a = {"m": "claim", "id": m, "who": None}
                floor.log = (floor.log + [a])[-LOG_LEN:]
                await floor.broadcast({"type": "action", "a": a, "from": floor.players[pid]["name"]})
            del floor.players[pid]
            await floor.broadcast({"type": "leave", "id": pid})
