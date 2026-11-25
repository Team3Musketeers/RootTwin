"""Line layout (T03): machines, conveyors, buffers and the dependency graph.

The layout is data (line1.yaml), so another line is a new YAML file, not new code.
The NetworkX graph is the single description of "who feeds whom":
- the simulation is built from it (one conveyor per edge, one buffer per machine);
- it fills the `machine_links` table (`machine_links_rows`);
- root-cause diagnosis (T15) walks it backwards from the symptoms to the cause:
  a stopped machine STARVES everything downstream and BLOCKS everything upstream.

Version 1 supports serial lines (each machine feeds at most one machine).
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import networkx as nx
import yaml
from pydantic import BaseModel, Field, model_validator

LAYOUT_PATH = Path(__file__).with_name("line1.yaml")


class SensorNominal(BaseModel, extra="forbid"):
    """Healthy behaviour of one machine's 4 sensors (see sensors.py for the equations)."""
    vibration_mm_s: float = Field(gt=0, description="RMS vibration at full load, nominal speed, new machine")
    idle_vibration_ratio: float = Field(default=0.25, ge=0, le=1,
                                        description="share of vibration when the motor turns without load")
    current_full_a: float = Field(gt=0, description="motor current at full load, nominal speed")
    current_idle_a: float = Field(ge=0, description="motor current when idling")
    temp_ambient_c: float = 22.0
    temp_rise_full_c: float = Field(gt=0, description="steady-state rise above ambient at full load")
    thermal_tau_s: float = Field(default=600, gt=0, description="thermal time constant (first-order lag)")
    noise: float = Field(default=0.03, ge=0, description="relative Gaussian noise on vibration and current")
    temp_noise_c: float = Field(default=0.3, ge=0, description="absolute Gaussian noise on temperature")

    @model_validator(mode="after")
    def _idle_below_full(self) -> "SensorNominal":
        if self.current_idle_a >= self.current_full_a:
            raise ValueError("current_idle_a must be below current_full_a")
        return self


class WearModel(BaseModel, extra="forbid"):
    """Natural wear as a gamma process (monotone, random, standard for degradation / RUL).

    Each finished cycle adds Gamma(shape = rate * cycle_s * speed**speed_exp, scale) to the wear.
    Mean working life from new (0) to worn out (1) at nominal speed = life_h.
    """
    life_h: float = Field(default=40, gt=0, description="mean working hours from new to worn out at speed 1")
    scale: float = Field(default=1e-3, gt=0, description="gamma scale: larger = more random wear paths")
    speed_exp: float = Field(default=2.0, ge=0, description="wear rate ~ speed_factor ** speed_exp")
    initial: float = Field(default=0.0, ge=0, lt=1, description="wear at t=0")
    vibration_gain: float = Field(default=0.6, ge=0, description="vibration *= 1 + gain * wear**2")
    temperature_gain_c: float = Field(default=6.0, ge=0, description="temperature += gain * wear**2")
    current_gain: float = Field(default=0.08, ge=0, description="current *= 1 + gain * wear")

    @property
    def rate(self) -> float:
        """Gamma shape per working second at nominal speed."""
        return 1.0 / (self.life_h * 3600.0 * self.scale)


class MachineConfig(BaseModel, extra="forbid"):
    machine_id: str
    name: str
    machine_type: str
    position: int = Field(ge=1)
    cycle_s: float = Field(gt=0, description="processing time per part at speed 1.0")
    cycle_cv: float = Field(default=0.05, ge=0, lt=1, description="coefficient of variation of the cycle")
    input_buffer: int = Field(default=10, ge=0, le=200, description="parts that can wait in front of it")
    sensors: SensorNominal
    wear: WearModel = Field(default_factory=WearModel)


class LinkConfig(BaseModel, extra="forbid"):
    conveyor_id: str
    from_id: str
    to_id: str
    transit_s: float = Field(gt=0, description="seconds for a part to cross the belt")
    slots: int = Field(default=8, ge=1, description="max parts on the belt at once")


class LineLayout(BaseModel, extra="forbid"):
    line_id: str = "line1"
    machines: list[MachineConfig] = Field(min_length=1)
    links: list[LinkConfig] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check(self) -> "LineLayout":
        ids = [m.machine_id for m in self.machines]
        if len(set(ids)) != len(ids):
            raise ValueError("duplicate machine_id in layout")
        if len({l.conveyor_id for l in self.links}) != len(self.links):
            raise ValueError("duplicate conveyor_id in layout")
        for l in self.links:
            for end in (l.from_id, l.to_id):
                if end not in ids:
                    raise ValueError(f"link {l.conveyor_id} refers to unknown machine '{end}'")
        g = build_graph(self)
        if not nx.is_directed_acyclic_graph(g):
            raise ValueError("the line has a loop")
        if any(d > 1 for _, d in g.in_degree()) or any(d > 1 for _, d in g.out_degree()):
            raise ValueError("only serial lines are supported (each machine feeds at most one machine)")
        if len(ids) > 1 and not nx.is_weakly_connected(g):
            raise ValueError("every machine must be connected to the line")
        self.machines.sort(key=lambda m: m.position)
        return self

    def machine(self, machine_id: str) -> MachineConfig:
        return next(m for m in self.machines if m.machine_id == machine_id)

    @property
    def flow_order(self) -> list[str]:
        """Machine ids from the first to the last machine of the flow."""
        return list(nx.topological_sort(build_graph(self)))


@lru_cache(maxsize=8)
def _load(path: str) -> LineLayout:
    return LineLayout.model_validate(yaml.safe_load(Path(path).read_text(encoding="utf-8")))


def load_layout(path: str | Path = LAYOUT_PATH) -> LineLayout:
    """Validated layout (a copy: callers may change it without affecting others)."""
    return _load(str(path)).model_copy(deep=True)


def build_graph(layout: LineLayout) -> nx.DiGraph:
    """Directed dependency graph: node = machine, edge = material flow upstream -> downstream."""
    g = nx.DiGraph(line_id=layout.line_id)
    for m in layout.machines:
        g.add_node(m.machine_id, name=m.name, machine_type=m.machine_type, position=m.position,
                   cycle_s=m.cycle_s, input_buffer=m.input_buffer)
    for l in layout.links:
        g.add_edge(l.from_id, l.to_id, link_type="conveyor", conveyor_id=l.conveyor_id,
                   transit_s=l.transit_s, slots=l.slots)
    return g


def upstream(g: nx.DiGraph, machine_id: str) -> list[str]:
    """Machines feeding `machine_id`, nearest first (they get BLOCKED when it stops)."""
    return sorted(nx.ancestors(g, machine_id), key=lambda n: nx.shortest_path_length(g, n, machine_id))


def downstream(g: nx.DiGraph, machine_id: str) -> list[str]:
    """Machines fed by `machine_id`, nearest first (they get STARVED when it stops)."""
    return sorted(nx.descendants(g, machine_id), key=lambda n: nx.shortest_path_length(g, machine_id, n))


def machine_links_rows(g: nx.DiGraph) -> list[tuple[str, str, str]]:
    """Rows for the `machine_links` table: (upstream_id, downstream_id, link_type)."""
    return [(u, v, d.get("link_type", "conveyor")) for u, v, d in g.edges(data=True)]
