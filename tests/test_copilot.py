import pytest

from roottwin.copilot import Copilot, load_chunks
from roottwin.faults import load_catalog


@pytest.fixture(scope="module")
def cop():
    return Copilot(use_llm=False)


def test_one_manual_per_fault():
    assert {c.fault_code for c in load_chunks()} == set(load_catalog())


def test_repair_answer_starts_with_loto_and_cites(cop):
    a = cop.ask("How do I repair it?", ["BEARING_WEAR"])
    assert a.mode == "extractive"
    assert a.text.startswith("Safety") and "padlock" in a.text
    assert all(s.startswith("[BEARING_WEAR §") for s in a.sources)


def test_sensor_fault_says_no_loto(cop):
    a = cop.ask("What do I do?", ["SENSOR_DRIFT"])
    assert "NOT required" in a.text


def test_why_question_returns_symptoms(cop):
    a = cop.ask("Why is this alert raised?", ["CONVEYOR_JAM"])
    assert "Symptoms" in a.text and "[CONVEYOR_JAM §Symptoms]" in a.sources


def test_off_topic_blocked(cop):
    assert cop.ask("What is the capital of France?").mode == "blocked"


def test_guard_blocks_uncited_or_foreign_citations(cop):
    allowed = ["[OVERHEATING §Repair procedure]"]
    assert cop._guard("Just restart it.", allowed, "llm").mode == "blocked"
    assert cop._guard("Replace motor [MOTOR_OVERCURRENT §Repair procedure]", allowed, "llm").mode == "blocked"
    ok = cop._guard("Clean the grids [OVERHEATING §Repair procedure]", allowed, "llm")
    assert ok.mode == "llm" and ok.sources == allowed
