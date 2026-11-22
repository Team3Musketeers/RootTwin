"""Command relay (T33): HTTP -> MQTT.

Person C's main API can mount `router` (app.include_router(router)); until
then it runs standalone:  uvicorn roottwin.command_api:app --port 8001

    POST /command/{line_id}/{target}   body: {"command": "...", "params": {...}}
    GET  /command/catalog              list of commands, level and params schema
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any

from fastapi import APIRouter, Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field, ValidationError

from roottwin.contracts import (COMMAND_PARAMS, LINE_COMMANDS, LINE_TARGET, Command,
                                IssuedBy, command_topic)
from roottwin.faults.models import load_catalog
from roottwin.mqtt import MqttPublisher

router = APIRouter(prefix="/command", tags=["commands"])
_publisher: MqttPublisher | None = None


def get_publisher() -> MqttPublisher:
    global _publisher
    if _publisher is None:
        _publisher = MqttPublisher(client_id="roottwin-command-api").start()
    return _publisher


class CommandRequest(BaseModel):
    command: str
    params: dict[str, Any] = Field(default_factory=dict)
    issued_by: IssuedBy = "ui"
    scenario_id: str | None = None


class CommandAccepted(BaseModel):
    command_id: str
    topic: str
    command: str
    params: dict[str, Any]


@router.get("/catalog")
def catalog() -> list[dict]:
    return [{"command": name,
             "level": "line" if name in LINE_COMMANDS else "machine",
             "target": LINE_TARGET if name in LINE_COMMANDS else "<machine_id>",
             "params_schema": model.model_json_schema()}
            for name, model in COMMAND_PARAMS.items()]


@router.get("/faults")
def fault_catalog() -> list[dict]:
    """Fault codes usable with inject_fault (for the UI dropdown)."""
    return [{"fault_code": f.code, "family": f.family, "description": f.description,
             "onset": f.onset, "stops_machine": f.stops_machine, "loto_required": f.repair.loto_required}
            for f in load_catalog().values()]


@router.post("/{line_id}/{target}", status_code=202, response_model=CommandAccepted)
def send_command(line_id: str, target: str, req: CommandRequest,
                 pub: MqttPublisher = Depends(get_publisher)) -> CommandAccepted:
    try:
        cmd = Command.model_validate(req.model_dump())
        topic = command_topic(line_id, target, cmd)
        if cmd.command == "inject_fault" and cmd.params["fault_code"] not in load_catalog():
            raise ValueError(f"unknown fault_code '{cmd.params['fault_code']}' "
                             f"(see GET /command/faults)")
    except ValidationError as exc:
        raise HTTPException(422, exc.errors(include_url=False, include_context=False)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    try:
        pub.publish_json(topic, cmd.model_dump_json())
    except (ConnectionError, OSError) as exc:
        raise HTTPException(503, f"MQTT broker unavailable: {exc}") from exc
    return CommandAccepted(command_id=cmd.command_id, topic=topic, command=cmd.command, params=cmd.params)


@asynccontextmanager
async def _lifespan(_: FastAPI):
    yield
    if _publisher is not None:
        _publisher.stop()


app = FastAPI(title="RootTwin command relay", version="0.1.0", lifespan=_lifespan)
app.include_router(router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
