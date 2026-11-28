"""Download CC0 assets from Poly Haven (polyhaven.com, public domain) for the 3D twin.

    python scripts/fetch_polyhaven.py            # props + pipes (glTF 1k) and PBR texture sets (1k jpg)

Models go to frontend/public/models/polyhaven/<id>/<id>.gltf (+ .bin + textures), textures to
frontend/public/textures/<id>/{diff,nor_gl,rough,metal}.jpg. Already downloaded files are skipped.
Machines are NOT downloaded: no CC0 CNC / robot / conveyor exists there, and the machines must stay
part-by-part CAD for the exploded view (see frontend/src/twin/machines/).
"""
from __future__ import annotations

import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "frontend" / "public"
API = "https://api.polyhaven.com"
UA = {"User-Agent": "roottwin-asset-fetch"}

MODELS = ["metal_tool_chest", "tool_cart", "portable_welding_cart", "hand_truck", "cardboard_box_01", "Barrel_01",
          "korean_fire_extinguisher_01", "plastic_crate_03", "power_box_01", "worn_metal_rack", "industrial_storage_cart",
          "modular_industrial_pipes_01"]
TEXTURES = {"hangar_concrete_floor": ["diff", "nor_gl", "rough"], "blue_metal_plate": ["diff", "nor_gl", "rough", "metal"],
            "painted_metal_shutter": ["diff", "nor_gl", "rough"], "corrugated_iron": ["diff", "nor_gl", "rough"],
            "metal_plate": ["diff", "nor_gl", "rough", "metal"]}


def get(url: str) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read()


def save(url: str, dest: Path) -> int:
    if dest.exists():
        return 0
    dest.parent.mkdir(parents=True, exist_ok=True)
    data = get(url)
    dest.write_bytes(data)
    return len(data)


def main():
    total = 0
    for mid in MODELS:
        g = json.loads(get(f"{API}/files/{mid}"))["gltf"]["1k"]["gltf"]
        d = ROOT / "models" / "polyhaven" / mid
        total += save(g["url"], d / f"{mid}.gltf")
        for rel, f in g.get("include", {}).items():
            if ".." in Path(rel).parts:                     # never write outside the asset folder
                raise ValueError(f"{mid}: unsafe path {rel}")
            total += save(f["url"], d / rel)
        print("model  ", mid, flush=True)
    for tid, maps in TEXTURES.items():
        files = json.loads(get(f"{API}/files/{tid}"))
        for m in maps:
            key = {"diff": "Diffuse", "nor_gl": "nor_gl", "rough": "Rough", "metal": "Metal"}[m]
            if key in files:
                total += save(files[key]["1k"]["jpg"]["url"], ROOT / "textures" / tid / f"{m}.jpg")
        print("texture", tid, flush=True)
    (ROOT / "models" / "polyhaven" / "LICENSE.txt").write_text(
        "All assets in this folder and in ../../textures/ are from Poly Haven (https://polyhaven.com), "
        "licensed CC0 1.0 (public domain).\n", encoding="utf-8")
    print(f"downloaded {total / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
