"""Join AAA county price rows onto Census FIPS, refusing to guess.

The only genuinely ambiguous cases nationally are 6 county/independent-city name
collisions (Baltimore MD, St. Louis MO, and Richmond/Franklin/Roanoke/Fairfax VA).
In every one the independent city carries the higher FIPS, so an AAA name ending
in " City" resolves to the higher of the pair and a bare name to the lower.
"""
import json, re, unicodedata
from collections import defaultdict
from geo import ensure_topology

STATE_FIPS = {
 '01':'AL','02':'AK','04':'AZ','05':'AR','06':'CA','08':'CO','09':'CT','10':'DE',
 '11':'DC','12':'FL','13':'GA','15':'HI','16':'ID','17':'IL','18':'IN','19':'IA',
 '20':'KS','21':'KY','22':'LA','23':'ME','24':'MD','25':'MA','26':'MI','27':'MN',
 '28':'MS','29':'MO','30':'MT','31':'NE','32':'NV','33':'NH','34':'NJ','35':'NM',
 '36':'NY','37':'NC','38':'ND','39':'OH','40':'OK','41':'OR','42':'PA','44':'RI',
 '45':'SC','46':'SD','47':'TN','48':'TX','49':'UT','50':'VT','51':'VA','53':'WA',
 '54':'WV','55':'WI','56':'WY'}


def norm(s):
    """Casefold + strip punctuation/diacritics and the generic county-type suffixes."""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = s.replace("&", " and ").replace("'", "").replace("`", "").replace(".", "")
    s = re.sub(r"\b(saint|sainte|ste)\b", "st", s)
    s = re.sub(r"\s+(county|parish|borough|census area|municipality|city and borough)$", "", s)
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    return s


def build_index(topo):
    idx = defaultdict(list)
    for g in topo["objects"]["counties"]["geometries"]:
        fips = g["id"]
        st = STATE_FIPS.get(fips[:2])
        if not st:
            continue                        # territories: no AAA coverage
        n = norm(g["properties"]["name"])
        idx[(st, n)].append(fips)
        if " " in n:
            idx[(st, n.replace(" ", ""))].append(fips)
    return idx


ALIASES = {                      # AAA name -> current FIPS (may be a split)
    ("SD", "shannon"):                 ["46102"],   # renamed Oglala Lakota, 2015
    ("AK", "prince wales ketchikan"):  ["02198"],   # -> Prince of Wales-Hyder, 2008 (approx.)
    ("AK", "wrangell petersburg"):     ["02275", "02195"],  # split 2008; price applied to both
}
DEFUNCT = {                      # no longer county-equivalents; correctly absent from Census
    ("VA", "clifton forge city"): "reverted to town, 2001",
    ("VA", "bedford city"):       "reverted to town, 2013",
}


def join(rows, idx):
    matched, unmatched, conflicts = {}, [], []
    claimed_by = {}
    # exact names first so "Charles City"/"James City" (real counties) win their
    # own FIPS before any " City" suffix-stripping runs
    ordered = sorted(rows, key=lambda r: r["county_raw"].lower().endswith(" city"))
    for r in ordered:
        st, raw = r["state"], r["county_raw"]
        is_city = raw.lower().endswith(" city")
        key = norm(raw)
        if (st, key) in DEFUNCT:
            unmatched.append({**r, "reason": "defunct: " + DEFUNCT[(st, key)]}); continue
        if (st, key) in ALIASES:
            for f in ALIASES[(st, key)]:
                if f not in claimed_by:
                    claimed_by[f] = raw
                    matched[f] = {"state": st, "name": raw, "price": r["price"]}
            continue
        cands = idx.get((st, key)) or idx.get((st, key.replace(" ", ""))) or []
        if not cands and is_city:
            base = norm(re.sub(r"\s+[Cc]ity$", "", raw))
            cands = idx.get((st, base)) or idx.get((st, base.replace(" ", ""))) or []
        if not cands:
            unmatched.append({**r, "reason": "no name match"}); continue
        if len(cands) == 1:
            fips = cands[0]
        else:
            fips = max(cands) if is_city else min(cands)   # independent city = higher FIPS
        if fips in claimed_by:
            conflicts.append({**r, "fips": fips, "reason": f"FIPS already taken by {claimed_by[fips]}"})
            continue
        claimed_by[fips] = raw
        matched[fips] = {"state": st, "name": raw, "price": r["price"]}
    return matched, unmatched, conflicts


if __name__ == "__main__":
    payload = json.load(open("data/county_prices.json"))
    # dated wrapper since the fetcher became date-aware; tolerate the old shape
    rows = payload["rows"] if isinstance(payload, dict) else payload
    fetched = payload.get("date") if isinstance(payload, dict) else None
    topo = ensure_topology()
    idx = build_index(topo)
    m, u, c = join(rows, idx)
    total_units = sum(1 for g in topo["objects"]["counties"]["geometries"]
                      if g["id"][:2] in STATE_FIPS)
    print(f"AAA priced rows      : {len(rows)}")
    print(f"matched to FIPS      : {len(m)}")
    print(f"unmatched            : {len(u)}")
    print(f"conflicts            : {len(c)}")
    print(f"atlas units (50+DC)  : {total_units}")
    print(f"COVERAGE             : {100*len(m)/total_units:.1f}%")
    if u:
        print("\n-- unmatched sample --")
        for r in u[:25]: print(f"   {r['state']} {r['county_raw']!r}")
    if c:
        print("\n-- conflicts --")
        for r in c[:15]: print(f"   {r['state']} {r['county_raw']!r} -> {r['reason']}")
    json.dump({"date": fetched, "matched": m},
              open("data/matched.json", "w"), separators=(",", ":"))
