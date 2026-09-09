"""Consolidate every price source into one dataset for the Next app.

Tiers, most authoritative first:
  aaa  -- AAA daily county average (the bulk)
  dc   -- AAA daily District average (DC is a single county-equivalent, so its
          state figure IS its county figure)
  ak   -- Alaska DCCED community survey, used only where AAA reports nothing.
          Semi-annual, so it carries its own vintage and stays visually distinct.
"""
import json, re, statistics
from geo import ensure_topology, albers_usa, decode_arcs, geometry_to_path, _ring_coords
from join import STATE_FIPS

W, H = 975.0, 610.0
proj = albers_usa(scale=1300.0, translate=(W / 2, H / 2))
topo = ensure_topology()
arcs = decode_arcs(topo)
_m = json.load(open("data/matched.json"))
aaa = _m["matched"] if "matched" in _m else _m
FETCHED = _m.get("date") if isinstance(_m, dict) else None
akfill = json.load(open("data/alaska_fill.json"))

# --- DC: pull the District's own daily average off its AAA page -------------
dc_price = None
try:
    h = open("data/raw/page_DC.html", encoding="utf-8", errors="ignore").read()
    i = h.find("Current Avg.")
    m = re.search(r"\$([\d.]+)", h[i:i + 400])
    if m:
        dc_price = float(m.group(1))
except FileNotFoundError:
    pass

def pick(f):
    return proj["alaska"] if f.startswith("02") else (
           proj["hawaii"] if f.startswith("15") else proj["l48"])

counties = []
for g in topo["objects"]["counties"]["geometries"]:
    f = g["id"]
    if f[:2] not in STATE_FIPS:
        continue
    d = geometry_to_path(g, arcs, pick(f))
    approx = False
    if not d:
        # counties-10m simplifies the very smallest independent cities down to a
        # 2-vertex sliver, so draw a minimum-size marker at the centroid instead
        # of dropping the unit off the map.
        pr = pick(f)
        polys = [g["arcs"]] if g["type"] == "Polygon" else g["arcs"]
        pts = [pr(lon, lat) for poly in polys for ring in poly
               for lon, lat in _ring_coords(arcs, ring)]
        if not pts:
            continue
        cx = sum(p[0] for p in pts) / len(pts)
        cy = sum(p[1] for p in pts) / len(pts)
        r = 0.9
        d = (f"M{cx-r:.2f},{cy:.2f}L{cx:.2f},{cy-r:.2f}"
             f"L{cx+r:.2f},{cy:.2f}L{cx:.2f},{cy+r:.2f}Z")
        approx = True
    name, st = g["properties"]["name"], STATE_FIPS[f[:2]]
    price, tier, note = None, None, None
    if f in aaa:
        price, tier = aaa[f]["price"], "aaa"
        name = aaa[f]["name"]
    elif f == "11001" and dc_price:
        price, tier, note = dc_price, "dc", "District-wide AAA average"
    elif f in akfill:
        v = akfill[f]
        price, tier = v["price"], "ak"
        note = f"AK community survey, Jan 2026 ({v['n']} communities)"
    rec = {"f": f, "d": d, "n": name, "s": st,
           "p": round(price, 3) if price else None, "t": tier, "note": note}
    if approx:
        rec["approx"] = True
    counties.append(rec)

states = [d for d in (geometry_to_path(g, arcs, pick(g["id"]), min_area_px=1.0)
                      for g in topo["objects"]["states"]["geometries"]
                      if g["id"] in STATE_FIPS) if d]

json.dump({"w": W, "h": H, "fetched": FETCHED,
           "counties": counties, "states": states},
          open("data/counties.json", "w"), separators=(",", ":"))

tot = len(counties)
have = [c for c in counties if c["p"] is not None]
from collections import Counter
print(f"rendered      : {tot} / 3142")
print(f"with a price  : {len(have)}  ({100*len(have)/tot:.1f}%)")
print(f"by tier       : {Counter(c['t'] for c in have).most_common()}")
print(f"still missing : {tot-len(have)}")
for c in counties:
    if c["p"] is None:
        print(f"   {c['f']} {c['n']}, {c['s']}")
v = [c["p"] for c in have]
print(f"\nrange ${min(v):.2f} - ${max(v):.2f}   median ${statistics.median(v):.2f}")
aaa_only = [c['p'] for c in have if c['t'] in ('aaa','dc')]
print(f"AAA-basis range ${min(aaa_only):.2f} - ${max(aaa_only):.2f}")
top = sorted(have, key=lambda c: -c["p"])[:4]
print("top:", [(c['n'], c['s'], c['p'], c['t']) for c in top])
