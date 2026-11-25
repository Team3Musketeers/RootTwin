"""T03: SimPy factory — orders, parts, buffers, propagation, faults, maintenance, commands (Person A)."""
import json

import pytest
import simpy

from roottwin.contracts import COMMAND_PARAMS, LINE_TARGET, Command, Snapshot, snapshot_topic, to_rows
from roottwin.sim import Factory, MemorySink

MACHINES = ["M1", "M2", "M3", "M4", "M5", "M6"]
BIG = 100_000


def make(seed: int = 0, **kw):
    sink = MemorySink()
    return Factory(simpy.Environment(), seed=seed, sink=sink, **kw), sink


def cmd(name: str, **params) -> Command:
    return Command(command=name, params=params)


def run_for(f: Factory, seconds: float) -> None:
    f.env.run(until=f.env.now + seconds)


def activities(f: Factory) -> dict[str, str]:
    return {m.id: m.activity for m in f.machines.values()}


# ---------------------------------------------------------------- orders and flow
def test_no_order_no_production():
    f, s = make()
    run_for(f, 630)
    assert f.released == f.parts_ok == 0
    assert set(activities(f).values()) == {"starved"}
    assert s.of_kind("production") == []
    assert len(s.of_kind("telemetry")) == 6 * 10          # one message per machine per simulated minute


def test_order_flows_through_every_machine():
    f, s = make()
    assert f.create_order(40, order_id="ORD-T") is None
    run_for(f, 900)
    o = f.orders["ORD-T"]
    assert o.status == "done" and o.completed == o.released == 40
    assert f.parts_ok == 40 and f.wip == 0
    assert [m.processed for m in f.machines.values()] == [40] * 6
    assert [e["event_type"] for e in s.events() if e["event_type"].startswith("order")] == \
        ["order_started", "order_completed"]
    assert sum(p["parts_ok"] for p in s.of_kind("production", "M6")) == 40
    assert s.events("order_completed")[0]["payload"]["lead_time_s"] > 60   # 5 belts + 6 cycles + queue
    assert f.create_order(5, order_id="ORD-T") is not None                 # duplicate id rejected


def test_bottleneck_sets_the_line_rate():
    f, _ = make()
    f.create_order(BIG)
    run_for(f, 2 * 3600)
    k = f.kpis()
    ideal_per_h = 3600 / 2.1                               # M4 welding, 2.1 s/part
    assert 0.93 * ideal_per_h < k.throughput_per_h <= 1.01 * ideal_per_h
    util = {m.id: m.work_s / f.env.now for m in f.machines.values()}
    assert max(util, key=util.get) == "M4" and util["M4"] > 0.97
    assert k.availability == 1.0 and k.quality == 1.0 and k.oee > 0.9


def test_stopped_machine_blocks_upstream_and_starves_downstream():
    """The propagation pattern root-cause diagnosis (T15) must see through."""
    f, s = make()
    f.create_order(BIG)
    run_for(f, 600)
    assert f.apply_command("M3", cmd("stop_machine")) is None
    run_for(f, 900)
    act = activities(f)
    assert act["M3"] == "stopped"
    assert act["M1"] == act["M2"] == "blocked"
    assert act["M4"] == act["M5"] == act["M6"] == "starved"
    m3 = f.machines["M3"]
    assert len(m3.inp) == m3.inp.capacity                 # buffer full, never above
    assert len(f.conveyors["C2"].entries) == f.conveyors["C2"].cfg.slots
    assert s.of_kind("telemetry", "M6")[-1]["sensors"]["cadence"] == 0
    f.apply_command("M3", cmd("start_machine"))
    run_for(f, 600)
    assert f.machines["M6"].cadence() > 20


def test_stop_and_start_line():
    f, s = make()
    f.create_order(BIG)
    run_for(f, 600)
    ok = f.parts_ok
    assert f.apply_command(LINE_TARGET, cmd("stop_line")) is None
    run_for(f, 600)
    assert f.parts_ok == ok
    assert set(activities(f).values()) == {"stopped"}
    assert not any(c.moving for c in f.conveyors.values())
    assert s.of_kind("telemetry", "M2")[-1]["sensors"]["current"] < 1.0     # motors off
    f.apply_command(LINE_TARGET, cmd("start_line"))
    run_for(f, 600)
    assert f.parts_ok > ok + 200
    assert f.kpis().availability == 1.0                    # a planned stop is not downtime


def test_set_buffer_changes_the_next_buffer_and_zero_still_flows():
    f, _ = make()
    assert f.apply_command("M3", cmd("set_buffer", capacity=0)) is None
    assert f.machines["M4"].inp.capacity == 0
    f.create_order(200, order_id="B0")
    run_for(f, 1800)
    assert f.orders["B0"].status == "done"
    assert f.apply_command("M6", cmd("set_buffer", capacity=5)) is not None   # nothing after M6


def test_speed_up_raises_output_and_wear():
    def one_hour(speed: float) -> Factory:
        f, _ = make(seed=3)
        f.create_order(BIG)
        for m in MACHINES:
            f.apply_command(m, cmd("set_speed", factor=speed))
        run_for(f, 3600)
        return f

    slow, fast = one_hour(1.0), one_hour(1.5)
    assert fast.parts_ok > 1.3 * slow.parts_ok
    assert fast.machines["M4"].wear.value > 1.5 * slow.machines["M4"].wear.value   # ~ speed^2


# ---------------------------------------------------------------- faults and maintenance
def test_bearing_wear_degrades_then_stops_the_machine():
    f, s = make()
    f.create_order(BIG)
    run_for(f, 600)
    t0 = f.env.now
    assert f.apply_command("M3", cmd("inject_fault", fault_code="BEARING_WEAR", severity=4)) is None
    m3 = f.machines["M3"]
    for t, state in [(0.4 * 7200 - 30, "ok"), (0.4 * 7200 + 30, "degraded"),
                     (7200 - 30, "degraded"), (7200 + 30, "down")]:
        f.env.run(until=t0 + t)
        assert m3.state == state, t
    events = s.events(machine_id="M3")
    assert [e["event_type"] for e in events] == ["fault_injected", "state_change", "state_change", "failure"]
    assert events[0]["fault_code"] == "BEARING_WEAR" and events[0]["severity"] == 4
    assert [e["state"] for e in events[1:]] == ["degraded", "down", "down"]

    vib = [(m["sim_s"], m["sensors"]["vibration"]) for m in s.of_kind("telemetry", "M3")]
    before = [v for t, v in vib if t <= t0]
    just_before_stop = [v for t, v in vib if t0 + 7000 < t <= t0 + 7200]
    assert sum(just_before_stop) / len(just_before_stop) > 2.5 * sum(before) / len(before)

    run_for(f, 600)                                       # the stop propagates
    act = activities(f)
    assert act["M3"] == "down" and act["M1"] == act["M2"] == "blocked"
    assert act["M4"] == act["M5"] == act["M6"] == "starved"
    assert f.kpis().availability < 1.0


def test_repair_takes_the_catalogue_time_and_resets_the_machine():
    f, s = make()
    f.create_order(BIG)
    f.apply_command("M3", cmd("inject_fault", fault_code="BEARING_WEAR", ramp_min=5))
    run_for(f, 6 * 60)
    assert f.machines["M3"].state == "down"
    assert f.apply_command("M3", cmd("repair")) is None
    run_for(f, 60)
    m3 = f.machines["M3"]
    assert m3.state == m3.activity == "maintenance"
    assert f.apply_command("M3", cmd("repair")) is not None          # already in maintenance
    assert s.events("command_rejected", "M3")
    run_for(f, 45 * 60)                                               # catalogue: 45 min, 350 EUR, replace
    assert m3.state == "ok" and m3.faults == [] and m3.wear.health > 0.999   # replaced, ~1 min of work since
    start, end = s.events("repair_start", "M3")[0], s.events("repair_end", "M3")[0]
    assert start["payload"]["minutes"] == 45 and start["payload"]["cost_eur"] == 350
    assert end["payload"]["sim_s"] - start["payload"]["sim_s"] == pytest.approx(45 * 60)
    run_for(f, 300)
    assert m3.activity in ("working", "blocked", "starved")


def test_auto_repair_corrective_policy():
    f, s = make(auto_repair=True, repair_response_min=10)
    f.create_order(BIG)
    f.apply_command("M2", cmd("inject_fault", fault_code="CONVEYOR_JAM"))   # down after 1 min
    f.env.run(until=60 + 600 + 30)
    assert f.machines["M2"].state == "maintenance"
    assert s.events("repair_start", "M2")[0]["payload"]["decided_by"] == "baseline"
    f.env.run(until=60 + 600 + 600 + 30)                                    # jam repair: 10 min
    assert f.machines["M2"].state == "ok"


def test_jam_freezes_the_outgoing_conveyor():
    f, _ = make()
    f.create_order(BIG)
    run_for(f, 300)
    f.apply_command("M2", cmd("inject_fault", fault_code="CONVEYOR_JAM"))
    assert not f.conveyors["C2"].moving and f.conveyors["C1"].moving
    run_for(f, 60)
    frozen = f.conveyors["C2"].snapshot().parts
    run_for(f, 120)
    assert f.conveyors["C2"].snapshot().parts == frozen
    f.apply_command("M2", cmd("clear_fault"))
    assert f.conveyors["C2"].moving and f.machines["M2"].state == "ok"


def test_tool_wear_scrap_is_removed_at_quality_control_and_replaced():
    f, s = make()
    f.create_order(500, order_id="Q")
    f.apply_command("M2", cmd("inject_fault", fault_code="TOOL_WEAR", ramp_min=10))
    run_for(f, 3600)
    o = f.orders["Q"]
    assert o.status == "done" and o.completed == 500
    assert f.parts_scrap > 0 and o.scrap == f.parts_scrap and o.released >= 500 + o.scrap
    assert f.machines["M6"].processed == f.parts_ok                  # no defect reaches packaging
    assert sum(p["parts_scrap"] for p in s.of_kind("production", "M2")) == f.machines["M2"].scrap_made
    assert f.kpis().quality < 1.0


def test_sensor_drift_changes_the_reading_not_the_machine():
    f, s = make()
    f.create_order(BIG)
    f.apply_command("M4", cmd("inject_fault", fault_code="SENSOR_DRIFT"))
    run_for(f, 200 * 60)
    m4 = f.machines["M4"]
    assert m4.state == "degraded" and m4.activity == "working"
    temps = [m["sensors"]["temperature"] for m in s.of_kind("telemetry", "M4")]
    assert temps[-1] - temps[5] > 12                                   # +15 degC offset at the end


def test_inspection_reports_the_active_fault_without_stopping():
    f, s = make()
    f.create_order(BIG)
    f.apply_command("M3", cmd("inject_fault", fault_code="BEARING_WEAR"))
    assert f.apply_command("M3", cmd("dispatch_worker", action="inspect", worker_id="W1")) is None
    run_for(f, 8 * 60)
    ev = s.events("inspection", "M3")[0]
    assert ev["payload"]["found"][0]["fault_code"] == "BEARING_WEAR"
    assert ev["payload"]["worker_id"] == "W1"
    assert f.machines["M3"].state == "ok"


def test_dispatch_worker_replace_after_travel_and_preventive_maintenance():
    f, s = make()
    f.create_order(BIG)
    run_for(f, 2 * 3600)
    assert f.machines["M4"].wear.value > 0
    assert f.apply_command("M4", cmd("dispatch_worker", action="replace", worker_id="W2")) is None
    run_for(f, 60)
    assert f.machines["M4"].state == "ok"                              # worker still walking
    run_for(f, 2 * 60)
    assert f.machines["M4"].state == "maintenance"
    assert s.events("repair_start", "M4")[0]["payload"]["worker_id"] == "W2"
    worn = f.machines["M4"].wear.value
    run_for(f, 15 * 60)                                                # 10 min replacement, then 5 min of work
    assert f.machines["M4"].state == "ok" and f.machines["M4"].wear.value < worn / 10
    run_for(f, 3600)
    worn = f.machines["M2"].wear.value
    assert f.apply_command("M2", cmd("preventive_maintenance")) is None
    run_for(f, 21 * 60)
    assert f.machines["M2"].wear.value < worn / 10
    assert s.events("repair_end", "M2")[0]["payload"]["action"] == "preventive_maintenance"


def test_spontaneous_faults_when_enabled():
    f, s = make(seed=5, spontaneous_faults_per_h=3.0)
    f.create_order(BIG)
    run_for(f, 2 * 3600)
    spont = [e for e in s.events("fault_injected") if e["payload"]["injected_by"] == "spontaneous"]
    assert spont
    quiet, s2 = make(seed=5)
    quiet.create_order(BIG)
    run_for(quiet, 2 * 3600)
    assert s2.events("fault_injected") == []


# ---------------------------------------------------------------- commands and contracts
VALID_PARAMS = {"set_speed": {"factor": 1.2}, "set_buffer": {"capacity": 5},
                "inject_fault": {"fault_code": "OVERHEATING"}, "create_order": {"quantity": 10},
                "set_time_scale": {"scale": 10}, "dispatch_worker": {"action": "inspect"}}


def test_every_contract_command_is_understood():
    f, _ = make()
    for name in COMMAND_PARAMS:
        c = Command(command=name, params=VALID_PARAMS.get(name, {}))
        err = f.apply_command(LINE_TARGET if c.is_line_command else "M2", c)
        assert err is None or ("unsupported" not in err and "not a machine command" not in err), (name, err)
        run_for(f, 60)
    assert f.time_scale == 10


def test_bad_targets_and_unknown_faults_are_rejected():
    f, s = make()
    assert "unknown machine" in f.apply_command("M9", cmd("stop_machine"))
    assert "line command" in f.apply_command("M1", cmd("start_line"))
    assert "unknown fault_code" in f.apply_command("M1", cmd("inject_fault", fault_code="NOPE"))
    assert s.events("command_rejected", "M1")[0]["payload"]["command"] == "inject_fault"
    f.apply_command("M1", cmd("inject_fault", fault_code="OVERHEATING"))
    assert "already active" in f.apply_command("M1", cmd("inject_fault", fault_code="OVERHEATING"))


def test_every_message_passes_the_ingestor():
    """What the simulation publishes is exactly what B's ingestor accepts (contracts.to_rows)."""
    f, s = make(scenario_id="T-CONTRACT", auto_repair=True)
    f.create_order(BIG)
    f.apply_command("M5", cmd("inject_fault", fault_code="OVERHEATING", ramp_min=10))
    f.apply_command("M2", cmd("inject_fault", fault_code="TOOL_WEAR", ramp_min=5))
    run_for(f, 2 * 3600)
    kinds = set()
    for topic, body in s.messages:
        table, rows, t = to_rows(topic, json.dumps(body))
        assert rows and t.line_id == "line1" and t.machine_id in MACHINES
        kinds.add(t.kind)
    assert kinds == {"telemetry", "event", "production"}
    assert {"failure", "repair_start", "repair_end", "state_change"} <= {e["event_type"] for e in s.events()}
    assert all(b.get("scenario_id") == "T-CONTRACT" and b["source"] == "sim" for _, b in s.messages)
    table, rows, _ = to_rows(snapshot_topic("line1"), f.snapshot().model_dump_json())
    assert table == "snapshot" and rows == []                         # validated, not stored


def test_snapshot_describes_the_line_for_the_3d():
    f, _ = make()
    f.create_order(500)
    run_for(f, 300)
    snap = f.snapshot()
    assert [m.machine_id for m in snap.machines] == MACHINES
    assert [m.position for m in snap.machines] == [1, 2, 3, 4, 5, 6]
    assert snap.status == "running" and snap.sim_time_s == 300 and snap.line_id == "line1"
    assert [c.conveyor_id for c in snap.conveyors] == ["C1", "C2", "C3", "C4", "C5"]
    for c in snap.conveyors:
        pos = [p.pos for p in c.parts]
        assert all(0 <= p <= 1 for p in pos) and pos == sorted(pos, reverse=True)
    counted = (sum(m.buffer_in for m in snap.machines) + sum(len(c.parts) for c in snap.conveyors)
               + sum(m.current_part is not None for m in snap.machines))
    assert 0 <= snap.kpis.wip - counted <= 1                          # + the part the feeder holds
    assert snap.orders[0].status == "in_progress"
    assert all(set(m.sensors) == {"vibration", "temperature", "current", "cadence"} for m in snap.machines)
    assert f.snapshot().seq == snap.seq + 1
    assert Snapshot.model_validate_json(snap.model_dump_json()) == snap


def test_same_seed_same_data():
    def run(seed: int):
        f, s = make(seed=seed)
        f.create_order(1000)
        f.apply_command("M2", Command(command="inject_fault", params={"fault_code": "TOOL_WEAR", "ramp_min": 5},
                                      command_id="fixed"))
        run_for(f, 1800)
        return s.messages

    assert run(7) == run(7)
    assert run(7) != run(8)
