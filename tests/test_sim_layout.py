"""T03: line layout and dependency graph (Person A)."""
import re
from pathlib import Path

import networkx as nx
import pytest
from pydantic import ValidationError

from roottwin.sim.layout import (LineLayout, build_graph, downstream, load_layout, machine_links_rows,
                                 upstream)

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = (ROOT / "infra/timescaledb/init/01_schema.sql").read_text(encoding="utf-8")


def test_layout_matches_database_seed():
    """Machines and links of the simulation = rows seeded in TimescaleDB (machines, machine_links)."""
    seeded = re.findall(r"\('(M\d)', 'line1', '([^']+)',\s*'([^']+)',\s*(\d)\)", SCHEMA)
    layout = load_layout()
    assert [(m.machine_id, m.name, m.machine_type, str(m.position)) for m in layout.machines] == seeded
    seeded_links = set(re.findall(r"\('(M\d)','(M\d)'\)", SCHEMA))
    g = build_graph(layout)
    assert {(u, v) for u, v, _ in machine_links_rows(g)} == seeded_links


def test_graph_is_a_serial_line():
    g = build_graph(load_layout())
    assert nx.is_directed_acyclic_graph(g)
    assert list(nx.topological_sort(g)) == ["M1", "M2", "M3", "M4", "M5", "M6"]
    assert all(d["link_type"] == "conveyor" for *_, d in g.edges(data=True))
    assert g.edges["M3", "M4"]["conveyor_id"] == "C3"


def test_bottleneck_is_the_slowest_machine():
    layout = load_layout()
    assert max(layout.machines, key=lambda m: m.cycle_s).machine_id == "M4"


def test_upstream_downstream_nearest_first():
    g = build_graph(load_layout())
    assert upstream(g, "M4") == ["M3", "M2", "M1"]      # blocked when M4 stops
    assert downstream(g, "M4") == ["M5", "M6"]          # starved when M4 stops
    assert upstream(g, "M1") == [] and downstream(g, "M6") == []


def _raw():
    return load_layout().model_dump()


def test_rejects_duplicate_machine():
    raw = _raw()
    raw["machines"][1]["machine_id"] = "M1"
    with pytest.raises(ValidationError, match="duplicate machine_id"):
        LineLayout.model_validate(raw)


def test_rejects_link_to_unknown_machine():
    raw = _raw()
    raw["links"][0]["to_id"] = "M9"
    with pytest.raises(ValidationError, match="unknown machine"):
        LineLayout.model_validate(raw)


def test_rejects_branching_line():
    raw = _raw()
    raw["links"].append({"conveyor_id": "C9", "from_id": "M1", "to_id": "M3", "transit_s": 5})
    with pytest.raises(ValidationError, match="serial"):
        LineLayout.model_validate(raw)


def test_load_layout_returns_independent_copies():
    a = load_layout()
    a.machines[0].cycle_s = 99
    assert load_layout().machines[0].cycle_s != 99
