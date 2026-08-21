"""Geometry for the 3D relief view.

Emits the projected county outlines, extruded by price in the browser, plus the
canonical colour domain so the 3D view and the flat map agree on every value.

The equal-area grid that used to live here is gone with the surface toggle it
fed; recover it from git (b6704d7) if the area-bias view is ever wanted again.
"""
import json

from shapely.geometry import Polygon
from shapely.ops import unary_union

from geo import ensure_topology, albers_usa, decode_arcs, _ring_coords
from join import STATE_FIPS

W, H = 975.0, 610.0
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
    rg = rings_of(unary_union(polys), SIMPLIFY)
    if not rg:
        continue
    counties_out.append({"n": meta["n"], "s": meta["s"], "p": meta["p"], "r": rg})

# The canonical colour domain, identical to the one the flat map builds: one
# value per priced county, so a price is the same colour in both views.
domain = sorted(c["p"] for c in prices["counties"] if c["p"] is not None)

out = {"w": W, "h": H, "domain": domain, "counties": counties_out}
# served to the client rather than bundled: the 3D route fetches it
json.dump(out, open("public/relief.json", "w"), separators=(",", ":"))

sz = len(open("public/relief.json").read())
priced = [c for c in counties_out if c["p"] is not None]
print(f"county outlines: {len(counties_out)}  ({len(priced)} priced, "
      f"{sum(len(x) for c in counties_out for x in c['r']):,} vertices)")
print(f"colour domain  : {len(domain)} county prices "
      f"${domain[0]:.3f}-${domain[-1]:.3f}")
print(f"wrote public/relief.json  {sz/1e6:.2f} MB")
