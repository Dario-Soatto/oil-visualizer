"""Fill Alaska's AAA gaps from the state's own community fuel price survey.

AAA only reports Anchorage and Mat-Su in Alaska -- the DCCED survey exists
precisely to cover the rest. It is semi-annual rather than daily, so anything
sourced here is tagged with its survey vintage and kept visually distinct.
"""
import json, urllib.parse, urllib.request
from collections import defaultdict
from shapely.geometry import Point, Polygon
from shapely.ops import unary_union
from geo import ensure_topology, decode_arcs, _ring_coords

SVC = ("https://maps.commerce.alaska.gov/server/rest/services/Services/"
       "CDO_Utilities/MapServer/6/query")

def fetch(year, season):
    q = urllib.parse.urlencode({
        "where": f"ReportingYear={year} AND ReportingSeason='{season}'",
        "outFields": "CommunityName,GasRetailGal,ReportingYear,ReportingSeason",
        "returnGeometry": "true", "outSR": "4326", "f": "json"})
    with urllib.request.urlopen(f"{SVC}?{q}", timeout=60) as r:
        return json.load(r)

def ak_polygons():
    topo = ensure_topology()
    arcs = decode_arcs(topo)
    out = {}
    for g in topo["objects"]["counties"]["geometries"]:
        if not g["id"].startswith("02"):
            continue
        polys = [g["arcs"]] if g["type"] == "Polygon" else g["arcs"]
        shells = []
        for poly in polys:
            for ring in poly:
                pts = _ring_coords(arcs, ring)
                if len(pts) >= 4:
                    try: shells.append(Polygon(pts).buffer(0))
                    except Exception: pass
        shells = [s for s in shells if not s.is_empty]
        if shells:
            out[g["id"]] = unary_union(shells)
    return out

if __name__ == "__main__":
    data = fetch(2026, "Winter")
    feats = data.get("features", [])
    print(f"Winter 2026 community records: {len(feats)}")
    polys = ak_polygons()
    print(f"AK borough polygons: {len(polys)}")

    by_borough, unplaced = defaultdict(list), 0
    for f in feats:
        a, geom = f["attributes"], f.get("geometry")
        price = a.get("GasRetailGal")
        if not geom or price is None or not (1 < price < 25):
            continue
        pt = Point(geom["x"], geom["y"])
        hit = next((fips for fips, poly in polys.items() if poly.contains(pt)), None)
        if hit is None:            # snap to nearest borough (coastal rounding)
            hit = min(polys, key=lambda k: polys[k].distance(pt))
            if polys[hit].distance(pt) > 0.35:
                unplaced += 1; continue
        by_borough[hit].append((a["CommunityName"], price))

    out = {}
    for fips, items in by_borough.items():
        vals = [p for _, p in items]
        out[fips] = {"price": round(sum(vals) / len(vals), 4),
                     "n": len(items),
                     "communities": sorted(c for c, _ in items)[:6]}
    json.dump(out, open("data/alaska_fill.json", "w"), separators=(",", ":"))
    print(f"boroughs covered: {len(out)}   communities placed: {sum(v['n'] for v in out.values())}   unplaced: {unplaced}")

    _m = json.load(open("data/matched.json"))
    matched = _m["matched"] if "matched" in _m else _m
    gaps = [f for f in polys if f not in matched]
    fixed = [f for f in gaps if f in out]
    print(f"\nAK boroughs missing from AAA: {len(gaps)}   now fillable: {len(fixed)}")
    for f in sorted(gaps):
        v = out.get(f)
        print(f"   {f}  {'$%.2f' % v['price'] + '  n=' + str(v['n']) + '  ' + ', '.join(v['communities'][:3]) if v else '-- still no data --'}")
