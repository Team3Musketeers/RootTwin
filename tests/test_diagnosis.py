"""T15 propagation graph and T19 Bayesian network."""
from roottwin.diagnosis import bayes
from roottwin.diagnosis.bayes import BayesNet
from roottwin.diagnosis.graph import diagnose, line_graph

M = [f"M{i}" for i in range(1, 7)]
OK = {"vib_high": False, "temp_high": False, "current_high": False, "slow": False, "idle": False}


def test_graph_finds_the_failing_machine_among_victims():
    sym = {m: dict(OK) for m in M}
    sym["M3"].update(vib_high=True, temp_high=True)                  # failing bearing
    for m in ("M1", "M2", "M4", "M5", "M6"):
        sym[m].update(idle=True)                                      # blocked upstream, starved downstream
    sym["M2"].update(idle=False, slow=True)                          # still emptying its buffer
    d = diagnose(line_graph(M), set(M), sym)
    assert d.root == "M3"
    assert set(d.explained) == {"M1", "M2", "M4", "M5", "M6"}
    assert ("M3", "M4") in d.path and ("M3", "M2") in d.path              # starvation downstream, blocking travels upstream


def test_no_alarm_no_root():
    assert diagnose(line_graph(M), set(), {m: dict(OK) for m in M}).root is None


def test_bayes_learns_and_normalises():
    net = BayesNet.fit(["none", "mech"], ["vib"], [("none", {"vib": False})] * 30 + [("mech", {"vib": True})] * 10)
    p = net.posterior({"vib": True})
    assert abs(sum(p.values()) - 1) < 1e-9 and p["mech"] > 0.9
    nets = bayes.load()                                               # trained params shipped in the package
    assert nets and set(nets) == {"machine", "factory"}
