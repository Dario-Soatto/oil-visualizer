"""Stage 2 of 2: everything local. No network except the Alaska survey.

Was five scripts and two intermediate files. The county topology is decoded and
projected exactly once here, and both outputs are derived from that single pass
-- the flat map's SVG paths and the relief's simplified rings are different
simplifications of the same projected geometry, not two separate projections.

  data/prices.json  ->  data/counties.json    flat map, read at build time
                        public/relief.json    3D view, fetched at runtime

The price history lives in Postgres, not here; `scripts/db.mjs ingest` loads
this snapshot into it. data/history.json is the frozen Wayback reconstruction
that seeded that table once and is not written again.
"""
import datetime, json, re, sys, urllib.parse, urllib.request
from collections import defaultdict

from shapely.geometry import Point, Polygon
from shapely.ops import unary_union

from geo import (albers_usa, decode_arcs, ensure_topology, geometry_to_path,
                 _ring_coords)
from join import STATE_FIPS, build_index, join

W, H = 975.0, 610.0
SIMPLIFY = 0.6          # px tolerance for the relief's extruded outlines
MIN_PART = 1.5          # drop relief polygon parts smaller than this (px^2)
MIN_STATES = 45
AK_SVC = ("https://maps.commerce.alaska.gov/server/rest/services/Services/"
          "CDO_Utilities/MapServer/6/query")
# Refuse a survey older than this. Two periods a year, so anything past ~9
# months means the newest one stopped being found rather than being late.
AK_MAX_AGE_DAYS = 300


# ---------------------------------------------------------------- Alaska ----
def latest_ak_survey():
    """The newest reporting period the DCCED service offers.

    This used to be a hardcoded (year, season) pair, which rotted silently: the
    query kept returning the pinned period forever, so the nine survey boroughs
    froze at February prices through August while every other county updated
    daily. Nothing caught it -- AAA still supplies Anchorage and Mat-Su, so
    Alaska never looked absent, and 9 counties is far inside the coverage floor.
    Ask the service which period is newest instead of asserting it.
    """
    q = urllib.parse.urlencode({
        "where": "GasRetailGal IS NOT NULL",
        "outFields": "ReportingYear,ReportingSeason,ReportingDate",
        "returnGeometry": "false", "returnDistinctValues": "true", "f": "json"})
    with urllib.request.urlopen(f"{AK_SVC}?{q}", timeout=60) as r:
        rows = [f["attributes"] for f in json.load(r).get("features", [])]
    periods = [r for r in rows if r.get("ReportingDate")]
    if not periods:
        raise RuntimeError("DCCED survey returned no reporting periods")
    newest = max(periods, key=lambda r: r["ReportingDate"])
    on = datetime.datetime.fromtimestamp(
        newest["ReportingDate"] / 1000, datetime.timezone.utc).date()
    return newest["ReportingYear"], newest["ReportingSeason"], on


def alaska_fill(records, year, season):
    """AAA covers only Anchorage and Mat-Su in Alaska; the state's own community
    survey covers the rest. Semi-annual, so it carries its vintage downstream."""
    q = urllib.parse.urlencode({
        "where": f"ReportingYear={year} AND ReportingSeason='{season}'",
        "outFields": "CommunityName,GasRetailGal",
        "returnGeometry": "true", "outSR": "4326", "f": "json"})
    with urllib.request.urlopen(f"{AK_SVC}?{q}", timeout=60) as r:
        feats = json.load(r).get("features", [])

    polys = dict(records)
    by_borough = defaultdict(list)
    for feat in feats:
        a, geom = feat["attributes"], feat.get("geometry")
        price = a.get("GasRetailGal")
        if not geom or price is None or not (1 < price < 25):
            continue
        pt = Point(geom["x"], geom["y"])
        hit = next((f for f, g in polys.items() if g.contains(pt)), None)
        if hit is None and polys:
            hit = min(polys, key=lambda k: polys[k].distance(pt))
            if polys[hit].distance(pt) > 0.35:
                continue
        if hit:
            by_borough[hit].append(price)
    return {f: (round(sum(v) / len(v), 4), len(v)) for f, v in by_borough.items()}


# ------------------------------------------------------------------ main ----
def main():
    payload = json.load(open("data/prices.json"))
    rows, fetched = payload["rows"], payload["date"]

    topo = ensure_topology()
    arcs = decode_arcs(topo)
    proj = albers_usa(scale=1300.0, translate=(W / 2, H / 2))

    def pick(f):
        return proj["alaska"] if f.startswith("02") else (
               proj["hawaii"] if f.startswith("15") else proj["l48"])

    # --- prices: AAA, then DC, then the Alaska survey where AAA is silent ----
    idx = build_index(topo)
    aaa, unmatched, conflicts = join(rows, idx)
    print(f"AAA rows {len(rows)} -> matched {len(aaa)}  "
          f"unmatched {len(unmatched)}  conflicts {len(conflicts)}")

    dc = next((r["price"] for r in rows if r["state"] == "DC"), None)
    if dc is None:                       # DC has no county map; use its own average
        try:
            h = open(f"data/raw/{fetched}/page_DC.html", encoding="utf-8",
                     errors="ignore").read()
            i = h.find("Current Avg.")
            m = re.search(r"\$([\d.]+)", h[i:i + 400])
            dc = float(m.group(1)) if m else None
        except FileNotFoundError:
            dc = None

    # --- one projection pass, both geometries -------------------------------
    # The Alaska survey returns lon/lat points, so borough matching happens in
    # lon/lat -- not in the projected pixel space the map is drawn in.
    ak_lonlat = {}       # fips -> unioned lon/lat polygon, Alaska only
    counties, relief = [], []
    for g in topo["objects"]["counties"]["geometries"]:
        f = g["id"]
        if f[:2] not in STATE_FIPS:
            continue
        pr = pick(f)
        parts = [g["arcs"]] if g["type"] == "Polygon" else g["arcs"]

        # flat map: full detail, adaptive precision, sub-pixel units kept
        d = geometry_to_path(g, arcs, pr)
        approx = False
        if not d:
            pts = [pr(lon, lat) for poly in parts for ring in poly
                   for lon, lat in _ring_coords(arcs, ring)]
            if not pts:
                continue
            cx = sum(p[0] for p in pts) / len(pts)
            cy = sum(p[1] for p in pts) / len(pts)
            r = 0.9
            d = (f"M{cx-r:.2f},{cy:.2f}L{cx:.2f},{cy-r:.2f}"
                 f"L{cx+r:.2f},{cy:.2f}L{cx:.2f},{cy+r:.2f}Z")
            approx = True

        # relief: simplified outer rings, and the shapely union Alaska needs
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
        rings = []
        if polys:
            u = unary_union(polys)
            simp = u.simplify(SIMPLIFY, preserve_topology=True)
            for part in ([simp] if simp.geom_type == "Polygon" else list(simp.geoms)):
                if part.is_empty or part.area < MIN_PART:
                    continue
                rings.append([[round(x, 1), round(y, 1)] for x, y in part.exterior.coords])

        if f.startswith("02"):
            geo_polys = []
            for poly in parts:
                ring = _ring_coords(arcs, poly[0])
                if len(ring) < 4:
                    continue
                q = Polygon(ring)
                if not q.is_valid:
                    q = q.buffer(0)
                if not q.is_empty:
                    geo_polys.append(q)
            if geo_polys:
                ak_lonlat[f] = unary_union(geo_polys)

        counties.append({"f": f, "d": d, "n": g["properties"]["name"],
                         "s": STATE_FIPS[f[:2]], "approx": approx, "rings": rings})

    ak_year, ak_season, ak_on = latest_ak_survey()
    ak = alaska_fill(ak_lonlat, ak_year, ak_season)
    ak_age = (datetime.date.today() - ak_on).days
    print(f"Alaska survey: {ak_season} {ak_year} (surveyed {ak_on}, {ak_age}d ago), "
          f"{len(ak)} boroughs available")

    # --- attach prices ------------------------------------------------------
    out_counties, out_relief = [], []
    for c in counties:
        f = c["f"]
        price = tier = note = None
        name = c["n"]
        if f in aaa:
            price, tier, name = aaa[f]["price"], "aaa", aaa[f]["name"]
        elif f == "11001" and dc:
            price, tier, note = dc, "dc", "District-wide AAA average"
        elif f in ak:
            price, tier = ak[f][0], "ak"
            note = (f"AK community survey, {ak_season} {ak_year}, surveyed {ak_on} "
                    f"({ak[f][1]} communities)")
        rec = {"f": f, "d": c["d"], "n": name, "s": c["s"],
               "p": round(price, 3) if price is not None else None,
               "t": tier, "note": note}
        if c["approx"]:
            rec["approx"] = True
        out_counties.append(rec)
        if c["rings"]:
            r = {"f": f, "n": name, "s": c["s"], "p": rec["p"], "r": c["rings"]}
            if note:
                r["note"] = note
            out_relief.append(r)

    states_geo = [d for d in (geometry_to_path(g, arcs, pick(g["id"]), min_area_px=1.0)
                              for g in topo["objects"]["states"]["geometries"]
                              if g["id"] in STATE_FIPS) if d]

    priced = [c for c in out_counties if c["p"] is not None]
    domain = sorted(c["p"] for c in priced)

    json.dump({"w": W, "h": H, "fetched": fetched,
               "counties": out_counties, "states": states_geo},
              open("data/counties.json", "w"), separators=(",", ":"))
    json.dump({"w": W, "h": H, "fetched": fetched,
               "domain": domain, "counties": out_relief},
              open("public/relief.json", "w"), separators=(",", ":"))

    return check(out_counties, out_relief, domain, fetched, len(ak), ak_age)


# --------------------------------------------------------------- checks -----
def check(counties, relief, domain, fetched, ak_boroughs, ak_age):
    """Fail loudly rather than committing a broken map. Every assertion here
    corresponds to something that has actually gone wrong in this project."""
    problems = []
    priced = [c for c in counties if c["p"] is not None]
    vals = [c["p"] for c in priced]
    states = {c["s"] for c in priced}

    if len(counties) < 3100:
        problems.append(f"only {len(counties)} county units rendered")
    if len(priced) < 3000:
        problems.append(f"only {len(priced)} counties priced")
    if len(states) < MIN_STATES:
        problems.append(f"only {len(states)} states represented")
    # Every jurisdiction should contribute at least one priced county. A silent
    # path or parse failure in one of them reads as "still 50 states, fine"
    # against a count threshold -- which is exactly how DC went missing once.
    expected = set(STATE_FIPS.values())
    absent = sorted(expected - states)
    if absent:
        problems.append(f"no priced county in: {', '.join(absent)}")
    if vals and not (1.0 < min(vals) < 10.0 and 1.0 < max(vals) < 25.0):
        problems.append(f"implausible price range ${min(vals):.2f}-${max(vals):.2f}")
    age = (datetime.date.today() - datetime.date.fromisoformat(fetched)).days
    if age > 2:
        problems.append(f"prices are {age} days old ({fetched})")
    if len(domain) != len(priced):
        problems.append(f"colour domain {len(domain)} != priced {len(priced)}")
    rp = [c["p"] for c in relief if c["p"] is not None]
    if rp and domain and min(rp) < domain[0] - 1e-9:
        problems.append("a relief county sits below the colour domain floor")
    # The Alaska survey is the one source that can go stale without shrinking
    # coverage: AAA still reports Anchorage and Mat-Su, so a dead survey leaves
    # Alaska present and merely wrong. Check the vintage, not just the count.
    if ak_boroughs < 5:
        problems.append(f"Alaska survey filled only {ak_boroughs} boroughs")
    if ak_age > AK_MAX_AGE_DAYS:
        problems.append(f"Alaska survey is {ak_age} days old; a newer period should exist")

    print(f"counties : {len(priced)}/{len(counties)} priced, {len(states)} states, "
          f"${min(vals):.2f}-${max(vals):.2f}, fetched {fetched}")
    print(f"relief   : {len(relief)} outlines, domain {len(domain)}")
    if problems:
        print("\nFAILED:", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
