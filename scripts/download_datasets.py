"""Download the public predictive-maintenance datasets into data/raw/ (T07).

    python scripts/download_datasets.py            # all
    python scripts/download_datasets.py ai4i cwru  # some

data/raw/ is git-ignored: datasets are never committed.
"""
from __future__ import annotations

import sys
import urllib.request
import zipfile
from pathlib import Path

RAW = Path(__file__).resolve().parents[1] / "data" / "raw"

SOURCES = {
    "ai4i": [  # UCI ML Repository, dataset 601 (Matzka, 2020)
        ("https://archive.ics.uci.edu/static/public/601/ai4i+2020+predictive+maintenance+dataset.zip",
         "ai4i/ai4i2020.zip"),
    ],
    "cmapss": [  # NASA PCoE turbofan engine degradation simulation (Saxena et al., 2008)
        ("https://phm-datasets.s3.amazonaws.com/NASA/6.+Turbofan+Engine+Degradation+Simulation+Data+Set.zip",
         "cmapss/cmapss.zip"),
    ],
    "cwru": [  # Case Western Reserve University Bearing Data Center, 12k drive end, 0 HP load
        ("https://engineering.case.edu/sites/default/files/97.mat", "cwru/normal_0.mat"),
        ("https://engineering.case.edu/sites/default/files/105.mat", "cwru/IR007_0.mat"),
        ("https://engineering.case.edu/sites/default/files/118.mat", "cwru/B007_0.mat"),
        ("https://engineering.case.edu/sites/default/files/130.mat", "cwru/OR007_6_0.mat"),
    ],
}


def fetch(url: str, dest: Path) -> None:
    if dest.exists() and dest.stat().st_size > 0:
        print(f"  skip (exists) {dest.relative_to(RAW)}")
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (dataset-downloader)"})
    with urllib.request.urlopen(req, timeout=120) as r, open(dest, "wb") as f:
        while chunk := r.read(1 << 16):
            f.write(chunk)
    print(f"  ok   {dest.relative_to(RAW)} ({dest.stat().st_size / 1e6:.1f} MB)")


def unzip_all(folder: Path) -> None:
    """Extract zips recursively (C-MAPSS ships a zip inside a zip)."""
    done = set()
    while True:
        zips = [z for z in folder.rglob("*.zip") if z not in done]
        if not zips:
            return
        for z in zips:
            with zipfile.ZipFile(z) as zf:
                for m in zf.namelist():
                    target = (z.parent / m).resolve()
                    if not str(target).startswith(str(folder.resolve())):
                        raise RuntimeError(f"unsafe path in {z.name}: {m}")
                zf.extractall(z.parent)
            done.add(z)


def main(names: list[str]) -> None:
    for name in names or list(SOURCES):
        print(f"[{name}]")
        for url, rel in SOURCES[name]:
            fetch(url, RAW / rel)
        unzip_all(RAW / name)


if __name__ == "__main__":
    main(sys.argv[1:])
