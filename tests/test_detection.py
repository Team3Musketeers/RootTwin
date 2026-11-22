import numpy as np
import pandas as pd
import pytest

from roottwin.detection.events import alarms, evaluate
from roottwin.detection.iforest import IForestDetector, ZScoreDetector
from roottwin.detection.metrics import report, threshold_for_recall
from roottwin.faults import Scenario
from roottwin.faults.offline import ROLLING_FEATURES, SENSORS, add_rolling_features, simulate


@pytest.fixture(scope="module")
def sim():
    sc = Scenario(scenario_id="T", seed=3, duration_min=300, machines=["M1", "M2"],
                  faults=[{"at_min": 100, "machine_id": "M2", "fault_code": "OVERHEATING"}])
    return add_rolling_features(simulate(sc)).reset_index(drop=True)


def test_offline_simulation_labels_and_states(sim):
    m2 = sim[sim.machine_id == "M2"]
    assert m2.loc[m2.t_min < 100, "label"].eq(0).all()
    assert m2.loc[m2.t_min.between(100, 140), "label"].eq(1).all()
    assert (m2["state"] == "down").any() and sim[sim.machine_id == "M1"]["label"].eq(0).all()
    # repaired 30 min after going down
    down_t = m2.loc[m2.state == "down", "t_min"].min()
    assert m2.loc[m2.t_min > down_t + 31, "label"].eq(0).all()
    assert set(ROLLING_FEATURES) <= set(sim.columns)


def test_threshold_for_recall_and_report():
    y = np.array([0] * 90 + [1] * 10)
    s = np.r_[np.linspace(0, 1, 90), np.linspace(0.95, 2, 10)]
    thr = threshold_for_recall(y, s, 0.9)
    r = report(y, s, thr, samples_per_day=100)
    assert r["recall"] >= 0.9 and r["roc_auc"] > 0.9 and "false_alarms_per_day" in r


def test_persistence_filter_and_event_metrics(sim):
    det = ZScoreDetector(ROLLING_FEATURES).fit(sim[sim.label == 0])
    a = alarms(sim, det.score(sim), 4.0, persist=5)
    raw = det.score(sim) >= 4.0
    assert a.sum() <= raw.sum()                        # debounce only removes alarms
    ev = evaluate(sim, a)
    assert ev["fault_episodes"] == 1 and ev["stopping_faults"] == 1
    assert ev["warned_before_down_rate"] == 1.0 and ev["lead_time_min_median"] > 0


def test_iforest_scores_fault_higher(sim):
    det = IForestDetector(ROLLING_FEATURES, n_estimators=50).fit(sim[sim.label == 0])
    s = det.score(sim)
    assert s[sim.label.to_numpy() == 1].mean() > s[sim.label.to_numpy() == 0].mean()


def test_autoencoder_roundtrip(tmp_path):
    pytest.importorskip("torch")
    from roottwin.detection.autoencoder import AEDetector
    rng = np.random.default_rng(0)
    X = rng.normal(size=(400, 12)).astype(np.float32)
    det = AEDetector(hidden=16, latent=4, epochs=5).fit(X)
    det.threshold = 1.23
    det.save(tmp_path / "ae.pt")
    det2 = AEDetector.load(tmp_path / "ae.pt")
    assert np.allclose(det.score(X[:5]), det2.score(X[:5]), atol=1e-6) and det2.threshold == 1.23
    assert det.score(X[:5] * 10).mean() > det.score(X[:5]).mean()


def test_explainer_points_to_affected_sensor(sim):
    pytest.importorskip("shap")
    from roottwin.detection.explain import AlertExplainer
    det = IForestDetector(ROLLING_FEATURES, n_estimators=50).fit(sim[sim.label == 0])
    exp = AlertExplainer(det, sim[sim.label == 0])
    row = sim[(sim.machine_id == "M2") & (sim.state == "down")].iloc[0]
    e = exp.explain(row, "M2", row.t_min)
    assert next(iter(e.contributions)) == "temperature"
    assert "OVERHEATING" in [c for c, _ in e.candidates]
    assert e.text.startswith("Alert on M2")
