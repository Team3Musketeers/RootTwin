"""Fault injection (T09): catalogue, fault effects, reproducible scenarios.

Typical use in the simulation (Person A):

    from roottwin.faults import load_catalog, ActiveFault
    cat = load_catalog()
    f = ActiveFault(cat["BEARING_WEAR"], machine_id="M3", start_min=env.now)
    sensors = f.apply(nominal_sensors, now_min=env.now, rng=rng)
    state = f.state(env.now)          # ok | degraded | down
"""
from roottwin.faults.models import (ActiveFault, FaultSpec, SensorEffect, load_catalog,
                                    worst_state)
from roottwin.faults.scenario import (Scenario, ScheduledFault, generate_scenarios,
                                      load_scenario, run_scenario)

__all__ = ["ActiveFault", "FaultSpec", "SensorEffect", "load_catalog", "worst_state",
           "Scenario", "ScheduledFault", "generate_scenarios", "load_scenario", "run_scenario"]
