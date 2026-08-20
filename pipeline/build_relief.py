"""Geometry for the 3D / relief experiments.

Two surfaces, because they answer different questions:

  counties -- the real polygons, extruded. Recognisable, but 16% of counties
              cover 49% of the map, so huge empty western counties dominate the
              frame and occlude everything behind them.
  grid     -- equal-area square cells. Every column has the same footprint, so
              height alone carries price. This is the honest one to read.

The grid also ships a smoothed variant. 86% of price variance sits *between*
states, so a plain blur would sand off the very feature that carries the signal.
This blur is state-clipped: cells only ever mix with cells in the same state, so
the plateaus soften into terrain while the border cliffs stay vertical.
"""
import json, sys
import numpy as np
from scipy import ndimage
from shapely.geometry import Polygon, Point
from shapely.strtree import STRtree
from shapely.ops import unary_union

from geo import ensure_topology, albers_usa, decode_arcs, _ring_coords
from join import STATE_FIPS

W, H = 975.0, 610.0
CELL = 6.0                 # px per grid cell in the 975x610 Albers frame
SIMPLIFY = 0.6             # px tolerance for the extruded county outlines
MIN_PART = 1.5             # drop polygon parts smaller than this (px^2)

proj = albers_usa(scale=1300.0, translate=(W / 2, H / 2))
topo = ensure_topology()
arcs = decode_arcs(topo)
prices = json.load(open("data/counties.json"))


def pick(f):
    return proj["alaska"] if f.startswith("02") else (
           proj["hawaii"] if f.startswith("15") else proj["l48"])


price_by_fips = {c["f"]: c for c in prices["counties"]}

records = []
for g in topo["objects"]["counties"]["geometries"]:
    f = g["id"]
    if f[:2] not in STATE_FIPS:
        continue
    meta = price_by_fips.get(f)
    if meta is None:
        continue
    pr = pick(f)
    parts = [g["arcs"]] if g["type"] == "Polygon" else g["arcs"]
    polys = []
    for poly in parts:
        ring = [pr(lon, lat) for lon, lat in _ring_coords(arcs, poly[0])]
        if len(ring) < 4:
            continue
        p = Polygon(ring)
        if not p.is_valid:
            p = p.buffer(0)
        if p.is_empty or p.area < MIN_PART:
            continue
        polys.append(p)
    if not polys:
        continue
    records.append({"f": f, "n": meta["n"], "s": meta["s"], "p": meta["p"],
                    "geom": unary_union(polys)})

print(f"counties with geometry: {len(records)}")

# ---- extruded county outlines -------------------------------------------
def rings_of(geom, tol):
    g = geom.simplify(tol, preserve_topology=True)
    gs = [g] if g.geom_type == "Polygon" else list(g.geoms)
    out = []
    for part in gs:
        if part.is_empty or part.area < MIN_PART:
            continue
        out.append([[round(x, 1), round(y, 1)] for x, y in part.exterior.coords])
    return out

counties_out = []
for r in records:
    rg = rings_of(r["geom"], SIMPLIFY)
    if not rg:
        continue
    counties_out.append({"n": r["n"], "s": r["s"], "p": r["p"], "r": rg})
print(f"county outlines emitted: {len(counties_out)}"
      f"  ({sum(len(x) for c in counties_out for x in c['r']):,} vertices)")

# ---- equal-area grid -----------------------------------------------------
gw = int(np.ceil(W / CELL))
gh = int(np.ceil(H / CELL))
geoms = [r["geom"] for r in records]
tree = STRtree(geoms)
states = sorted({r["s"] for r in records})
state_ix = {s: i for i, s in enumerate(states)}

price = np.full((gh, gw), np.nan, dtype=np.float32)
stidx = np.full((gh, gw), -1, dtype=np.int16)

for j in range(gh):
    for i in range(gw):
        pt = Point((i + 0.5) * CELL, (j + 0.5) * CELL)
        hits = tree.query(pt)
        for h in hits:
            r = records[int(h)]
            if r["geom"].contains(pt):
                price[j, i] = r["p"]
                stidx[j, i] = state_ix[r["s"]]
                break
    if j % 25 == 0:
        print(f"  rasterising row {j}/{gh}", file=sys.stderr)

filled = int(np.isfinite(price).sum())
print(f"grid {gw}x{gh} = {gw*gh:,} cells, {filled:,} land ({100*filled/(gw*gh):.0f}%)")

# ---- state-clipped smoothing --------------------------------------------
smooth = np.full_like(price, np.nan)
for s, si in state_ix.items():
    mask = (stidx == si)
    if not mask.any():
        continue
    vals = np.where(mask, np.nan_to_num(price), 0.0)
    m = mask.astype(np.float32)
    # normalised convolution: blur values and mask together, then divide, so
    # cells never borrow from a neighbouring state across a border cliff
    num = ndimage.gaussian_filter(vals, sigma=1.4, mode="constant")
    den = ndimage.gaussian_filter(m, sigma=1.4, mode="constant")
    with np.errstate(invalid="ignore", divide="ignore"):
        sm = np.where(den > 1e-6, num / den, np.nan)
    smooth[mask] = sm[mask]

def pack(a):
    return [None if not np.isfinite(v) else round(float(v), 3) for v in a.ravel()]

out = {
    "w": W, "h": H,
    "counties": counties_out,
    "grid": {"cell": CELL, "gw": gw, "gh": gh,
             "raw": pack(price), "smooth": pack(smooth),
             "state": [int(v) for v in stidx.ravel()], "states": states},
}
# served to the client rather than bundled: the 3D routes fetch it
json.dump(out, open("public/relief.json", "w"), separators=(",", ":"))
sz = len(open("public/relief.json").read())
print(f"wrote public/relief.json  {sz/1e6:.2f} MB")
v = price[np.isfinite(price)]
print(f"grid price range ${v.min():.2f}-${v.max():.2f}")
