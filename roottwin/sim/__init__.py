"""Factory simulation (Person A): SimPy line (T03) + simulated sensors and wear (T06).

Live line driven by the same MQTT commands as the UI and the RL agent:

    python -m roottwin.sim live --time-scale 60 --order 500

In Python (fast, no MQTT):

    import simpy
    from roottwin.sim import Factory, MemorySink
    f = Factory(simpy.Environment(), seed=1, sink=MemorySink())
    f.create_order(100)
    f.env.run(until=3600)            # one simulated hour
    f.snapshot()                     # roottwin.contracts.Snapshot (what the 3D receives)

Labelled dataset from B's fault scenarios (drop-in for roottwin.faults.offline.simulate):

    from roottwin.faults import generate_scenarios
    from roottwin.sim import simulate_many
    df = simulate_many(generate_scenarios(200, seed=42), jobs=4)

See docs/SIMULATION.md.
"""
from roottwin.sim.factory import Conveyor, Factory, Machine, Order, Part
from roottwin.sim.layout import (LineLayout, build_graph, downstream, load_layout, machine_links_rows,
                                 upstream)
from roottwin.sim.runner import LiveRunner, ScalableRealtimeEnvironment, simulate_many, simulate_scenario
from roottwin.sim.sensors import SENSORS, SensorModel, Wear
from roottwin.sim.sinks import MemorySink, MqttSink, NullSink, Recorder

__all__ = ["Factory", "Machine", "Conveyor", "Order", "Part", "LineLayout", "load_layout", "build_graph",
           "upstream", "downstream", "machine_links_rows", "LiveRunner", "ScalableRealtimeEnvironment",
           "simulate_scenario", "simulate_many", "SENSORS", "SensorModel", "Wear", "MemorySink", "MqttSink",
           "NullSink", "Recorder"]
