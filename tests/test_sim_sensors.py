"""T06: simulated sensors and natural wear (Person A)."""
import math

import numpy as np
import pytest
import simpy

from roottwin.sim import Factory, MemorySink, SensorModel, Wear
from roottwin.sim.layout import SensorNominal, WearModel, load_layout

NOMINAL = SensorNominal(vibration_mm_s=2.0, current_full_a=12.0, current_idle_a=3.0, temp_rise_full_c=25,
                        noise=0.0, temp_noise_c=0.0)


def test_healthy_line_stays_in_the_detectors_training_ranges():
    """B's first detectors saw vibration ~2, temperature ~45, current ~12, cadence ~30 (offline stand-in)."""
    sink = MemorySink()
    f = Factory(simpy.Environment(), seed=2, sink=sink)
    f.create_order(100_000)
    f.env.run(until=3 * 3600)
    for m in f.machines.values():
        rows = [t["sensors"] for t in sink.of_kind("telemetry", m.id)][30:]      # after 30 min
        mean = {k: float(np.mean([r[k] for r in rows])) for k in rows[0]}
        assert 0.7 < mean["vibration"] < 3.0, (m.id, mean)
        assert 30 < mean["temperature"] < 55, (m.id, mean)
        assert 4 < mean["current"] < 16, (m.id, mean)
        assert 26 < mean["cadence"] < 31, (m.id, mean)                      # bottleneck rate 28.6
        assert np.std([r["vibration"] for r in rows]) > 0                      # noisy, not constant


def test_wear_is_a_monotone_gamma_process_with_the_configured_life():
    model = WearModel(life_h=10)
    finals = []
    for seed in range(200):
        w = Wear(model, np.random.default_rng(seed))
        path = []
        for _ in range(10):
            w.advance(3600)
            path.append(w.value)
        assert path == sorted(path)                                            # never decreases
        finals.append(w.value)
    assert np.mean(finals) == pytest.approx(1.0, rel=0.05)                     # worn out after life_h
    assert np.std(finals) > 0


def test_wear_rate_grows_with_speed_squared():
    model = WearModel(life_h=1, scale=1e-6)                                    # almost deterministic
    slow, fast = Wear(model, np.random.default_rng(0)), Wear(model, np.random.default_rng(0))
    slow.advance(600, speed=1.0)
    fast.advance(600, speed=2.0)
    assert fast.value / slow.value == pytest.approx(4.0, rel=0.01)
    fast.reset(keep=0.5)
    assert fast.value == pytest.approx(2 * slow.value, rel=0.01)
    assert Wear(WearModel(initial=0.3), np.random.default_rng(0)).health == pytest.approx(0.7)


def test_wear_raises_vibration_temperature_and_current():
    wear = WearModel()
    new = SensorModel(NOMINAL, wear, np.random.default_rng(0))
    old = SensorModel(NOMINAL, wear, np.random.default_rng(0))
    a = new.sample(3600 * 10, load=1.0, speed=1.0, wear=0.0, motor_on=True, cadence=30)
    b = old.sample(3600 * 10, load=1.0, speed=1.0, wear=0.9, motor_on=True, cadence=30)
    assert b["vibration"] / a["vibration"] == pytest.approx(1 + 0.6 * 0.81)
    assert b["temperature"] - a["temperature"] == pytest.approx(6.0 * 0.81, abs=0.01)
    assert b["current"] / a["current"] == pytest.approx(1 + 0.08 * 0.9)
    assert a["vibration"] == pytest.approx(2.0) and a["current"] == pytest.approx(12.0)
    assert a["temperature"] == pytest.approx(22 + 25, abs=0.01)


def test_temperature_follows_a_first_order_lag():
    s = SensorModel(NOMINAL, WearModel(), np.random.default_rng(0), warm_load=1.0)
    s.sample(10 * 3600, load=0.0, speed=1.0, wear=0.0, motor_on=False, cadence=0)    # cools to ambient
    assert s.temperature == pytest.approx(22, abs=0.01)
    s.sample(NOMINAL.thermal_tau_s, load=1.0, speed=1.0, wear=0.0, motor_on=True, cadence=30)
    assert s.temperature == pytest.approx(22 + 25 * (1 - math.exp(-1)), abs=0.01)     # 63 % after tau


def test_idle_and_motor_off_signals():
    s = SensorModel(NOMINAL, WearModel(), np.random.default_rng(0))
    idle = s.sample(60, load=0.0, speed=1.0, wear=0.0, motor_on=True, cadence=0)
    off = s.sample(60, load=0.0, speed=1.0, wear=0.0, motor_on=False, cadence=0)
    assert idle["vibration"] == pytest.approx(0.25 * 2.0) and idle["current"] == pytest.approx(3.0)
    assert off["vibration"] == pytest.approx(0.05 * 2.0) and off["current"] == pytest.approx(0.2)


def test_layout_sensor_parameters_are_valid():
    for m in load_layout().machines:
        assert m.sensors.current_idle_a < m.sensors.current_full_a
    with pytest.raises(ValueError):
        SensorNominal(vibration_mm_s=1, current_full_a=3, current_idle_a=5, temp_rise_full_c=10)
