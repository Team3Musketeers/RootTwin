"""Public predictive-maintenance datasets (T07): loading and cleaning.

    from roottwin.datasets import ai4i, cmapss, cwru
    df = ai4i.load()                      # 10 000 rows, failure labels
    train, test = cmapss.load("FD001")    # with RUL column
    feats = cwru.load_features()          # vibration windows + features + labels

Raw files: python scripts/download_datasets.py  (data/raw/, git-ignored)
"""
from pathlib import Path

DATA = Path(__file__).resolve().parents[2] / "data"
RAW = DATA / "raw"
PROCESSED = DATA / "processed"
