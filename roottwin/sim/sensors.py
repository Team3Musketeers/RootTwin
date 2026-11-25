"""Simulated sensors and natural wear (T06, Person A).

Four sensors per machine, published as one telemetry message per period:
    vibration (mm/s RMS) · temperature (degC) · current (A) · cadence (parts/min)

The physics is deliberately simple: one equation per sensor, each term explainable.
    u   = load: share of the last period the machine was processing a part (0..1)
    s   = speed factor (set_speed command, 1 = nominal)
    w   = wear (0 = new, 1 = worn out), see Wear

    vibration   = V0 * s * (r_idle + (1 - r_idle) * u) * (1 + g_v * w^2)          motor on
    current     = (I_idle + (I_full - I_idle) * u * s^0.8) * (1 + g_i * w)          motor on
    temperature -> first-order lag (tau) towards
                  T_amb + dT_full * s^0.5 * (0.3 + 0.7 * u) + g_T * w^2             motor on
                  T_amb                                                             motor off
    cadence     = parts finished in the last 60 s (parts/min), computed by the machine

then Gaussian noise (relative on vibration/current, absolute on temperature), then the
catalogue faults on top (roottwin.faults.ActiveFault.apply). Motor off = machine down,
stopped or in maintenance (lock-out): vibration and current fall to standby values.

Why these shapes: wear acts through w^2 so signals stay flat for a long time and then
accelerate, as seen on C-MAPSS run-to-failure curves (B's EDA); T14 calibrates the gains.
"""
from __future__ import annotations

import math

import numpy as np

from roottwin.sim.layout import SensorNominal, WearModel

SENSORS = ("vibration", "temperature", "current", "cadence")
IDLE_HEAT = 0.3            # share of the full-load heating when the motor turns without load
STANDBY_VIBRATION = 0.05   # share of V0 felt when the motor is off (neighbouring machines)
STANDBY_CURRENT_A = 0.2    # control electronics when the motor is off


class Wear:
    """Natural wear as a gamma process: monotone, random, speed-dependent.

    Each working interval dt adds Gamma(shape = rate * dt * speed**speed_exp, scale).
    Mean increment = dt * speed**speed_exp / (life_h * 3600): faster = wears faster.
    """

    def __init__(self, model: WearModel, rng: np.random.Generator):
        self.model = model
        self.rng = rng
        self.value = float(model.initial)

    def advance(self, working_s: float, speed: float = 1.0) -> None:
        if working_s <= 0:
            return
        shape = self.model.rate * working_s * speed ** self.model.speed_exp
        self.value += float(self.rng.gamma(shape, self.model.scale))

    def reset(self, keep: float = 0.0) -> None:
        """Maintenance: keep a share of the wear (0 = like new after a replacement)."""
        self.value *= keep

    @property
    def health(self) -> float:
        return max(0.0, 1.0 - self.value)


class SensorModel:
    """Healthy sensor values of one machine; keeps the thermal state between samples."""

    def __init__(self, nominal: SensorNominal, wear: WearModel, rng: np.random.Generator,
                 warm_load: float = 0.9):
        self.c = nominal
        self.g = wear
        self.rng = rng
        # warm start: a production line is not cold when a scenario starts
        self.temperature = self.temperature_target(warm_load, 1.0, wear.initial, motor_on=True)

    def temperature_target(self, load: float, speed: float, wear: float, motor_on: bool) -> float:
        c = self.c
        if not motor_on:
            return c.temp_ambient_c
        heat = c.temp_rise_full_c * math.sqrt(speed) * (IDLE_HEAT + (1 - IDLE_HEAT) * load)
        return c.temp_ambient_c + heat + self.g.temperature_gain_c * wear ** 2

    def sample(self, dt: float, load: float, speed: float, wear: float, motor_on: bool,
               cadence: float) -> dict[str, float]:
        """Sensor values after `dt` simulated seconds at average `load` (before faults)."""
        c, g = self.c, self.g
        load = min(max(load, 0.0), 1.0)
        target = self.temperature_target(load, speed, wear, motor_on)
        if dt > 0:
            self.temperature += (target - self.temperature) * (1.0 - math.exp(-dt / c.thermal_tau_s))
        if motor_on:
            vib = (c.vibration_mm_s * speed * (c.idle_vibration_ratio + (1 - c.idle_vibration_ratio) * load)
                   * (1 + g.vibration_gain * wear ** 2))
            cur = ((c.current_idle_a + (c.current_full_a - c.current_idle_a) * load * speed ** 0.8)
                   * (1 + g.current_gain * wear))
        else:
            vib = STANDBY_VIBRATION * c.vibration_mm_s
            cur = STANDBY_CURRENT_A
        n_vib, n_cur = self.rng.normal(1.0, c.noise, size=2)
        return {
            "vibration": max(vib * n_vib, 0.0),
            "temperature": self.temperature + float(self.rng.normal(0.0, c.temp_noise_c)),
            "current": max(cur * n_cur, 0.0),
            "cadence": max(cadence, 0.0),
        }
