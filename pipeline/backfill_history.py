"""Rebuild a county-level price history from the Internet Archive.

AAA's county payload carries only today's price, so there is no history to ask
it for. But the endpoint itself has been archived ~28k times since 2019, and
each capture is a full state's counties at that moment. Sampling one capture per
state-week reconstructs a weekly series.

State is inferred from each payload's own county-name set rather than read off
its `map_id`. The ids look stable (map_id=1 is Florida in 2020 and still is) but
they are opaque WordPress ids, not an alphabetical scheme, and nothing guarantees
AAA never renumbered them across seven years of archive. Inference is unambiguous
anyway -- no two states share a county roster -- and the run cross-checks every
capture against today's id->state map, reporting any disagreement rather than
silently trusting either source.

Resumable: every capture is cached under data/wayback/raw/, so re-running costs
nothing for what already landed.
"""
import json, os, re, sys, time, threading
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

import requests

from geo import ensure_topology
from join import STATE_FIPS, norm, build_index, join

RAW = "data/wayback/raw"
SEL = "data/wayback/selected.json"
CDX = "data/wayback/cdx.jsonl"
CDX_URL = ("http://web.archive.org/cdx/search/cdx?url=gasprices.aaa.com/index.php*"
           "&filter=statuscode:200&filter=original:.*premiumhtml5map_js_data.*&output=json")
UA = "pump-price-atlas/1.0 (personal research; contact dario.soatto@gmail.com)"
WORKERS = 5                     # archive.org is slow; stay well-mannered
TIMEOUT = 45

_lock = threading.Lock()
_stats = defaultdict(int)


def bump(k, n=1):
    with _lock:
        _stats[k] += n


def build_index_file():
    """Enumerate every archived capture of the county endpoint, then keep one per
    state-week. Weekly is the right resolution for pump prices and cuts ~28k
    captures to ~6k fetches."""
    import datetime
    rows = []
    with requests.Session() as s:
        for page in range(0, 40):
            r = s.get(f"{CDX_URL}&page={page}", timeout=120, headers={"User-Agent": UA})
            if r.status_code != 200 or not r.text.strip():
                break
            try:
                got = r.json()
            except ValueError:
                break
            got = got[1:] if got and got[0][0] == "urlkey" else got
            if not got:
                break
            rows += got
            print(f"  cdx page {page}: {len(rows)} rows", flush=True)
            time.sleep(1)
    os.makedirs(os.path.dirname(CDX), exist_ok=True)
    with open(CDX, "w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")

    def week_key(ts):
        d = datetime.date(int(ts[:4]), int(ts[4:6]), int(ts[6:8]))
        y, w, _ = d.isocalendar()
        return f"{y}-W{w:02d}"

    sel = {}
    for r in rows:
        ts, url = r[1], r[2]
        m = re.search(r"map_id=(\d+)", url)
        if not m:
            continue
        key = (m.group(1), week_key(ts))
        # earliest capture in each state-week, so the sampling point is consistent
        if key not in sel or ts < sel[key][1]:
            sel[key] = (m.group(1), ts, url)
    json.dump([list(v) for v in sel.values()], open(SEL, "w"))
    print(f"captures: {len(rows)}  ->  selected one per state-week: {len(sel)}")


def wayback_url(ts, original):
    return f"https://web.archive.org/web/{ts}id_/{original.replace('&amp;', '&')}"


def cache_path(ts, map_id):
    return os.path.join(RAW, f"{ts}_{map_id}.js")


def fetch_one(item, session):
    map_id, ts, url = item
    path = cache_path(ts, map_id)
    if os.path.exists(path):
        bump("cached")
        return
    for attempt in range(4):
        try:
            r = session.get(wayback_url(ts, url), timeout=TIMEOUT,
                            headers={"User-Agent": UA})
            if r.status_code == 200 and "map_data" in r.text:
                with open(path, "w", encoding="utf-8") as f:
                    f.write(r.text)
                bump("fetched")
                return
            if r.status_code in (429, 503, 502, 504):
                time.sleep(4 * (attempt + 1))
                continue
            bump(f"http_{r.status_code}")
            return
        except requests.RequestException:
            time.sleep(3 * (attempt + 1))
    bump("failed")


def extract(js):
    """Pull {name: price} out of an archived map_data blob."""
    i = js.find("map_data")
    if i < 0:
        return {}
    j = js.find("{", i)
    depth = 0
    for k in range(j, len(js)):
        if js[k] == "{":
            depth += 1
        elif js[k] == "}":
            depth -= 1
            if depth == 0:
                try:
                    data = json.loads(js[j:k + 1])
                except json.JSONDecodeError:
                    return {}
                break
    else:
        return {}
    out = {}
    for v in data.values():
        name = (v.get("name") or "").strip()
        m = re.search(r"([\d.]+)", (v.get("comment") or "").replace("$", "").replace(",", ""))
        if not name or not m:
            continue
        try:
            p = float(m.group(1))
        except ValueError:
            continue
        if 0.5 < p < 25.0:
            out[name] = p
    return out


def build_state_rosters(topo):
    """state -> set of normalised county names, for inferring a payload's state."""
    rosters = defaultdict(set)
    for g in topo["objects"]["counties"]["geometries"]:
        st = STATE_FIPS.get(g["id"][:2])
        if st:
            n = norm(g["properties"]["name"])
            rosters[st].add(n)
            rosters[st].add(n.replace(" ", ""))
    return rosters


def infer_state(names, rosters):
    """Best-matching state for a set of county names, or None if ambiguous."""
    keys = {norm(n) for n in names} | {norm(n).replace(" ", "") for n in names}
    best, second, best_st = 0.0, 0.0, None
    for st, roster in rosters.items():
        hit = len(keys & roster) / max(1, len(keys))
        if hit > best:
            best, second, best_st = hit, best, st
        elif hit > second:
            second = hit
    # a real match covers most of its roster and clearly beats the runner-up
    if best >= 0.55 and best - second >= 0.15:
        return best_st, best
    return None, best


if __name__ == "__main__":
    if "--index" in sys.argv or not os.path.exists(SEL):
        build_index_file()
        if "--index" in sys.argv:
            sys.exit(0)

    items = [tuple(x) for x in json.load(open(SEL))]
    only_fetch = "--fetch" in sys.argv
    todo = [i for i in items if not os.path.exists(cache_path(i[1], i[0]))]
    print(f"selected captures: {len(items)}   already cached: {len(items)-len(todo)}   to fetch: {len(todo)}")

    if todo:
        with requests.Session() as s:
            with ThreadPoolExecutor(max_workers=WORKERS) as ex:
                for n, _ in enumerate(ex.map(lambda i: fetch_one(i, s), todo), 1):
                    if n % 250 == 0:
                        print(f"  {n}/{len(todo)}  {dict(_stats)}", flush=True)
        print("fetch stats:", dict(_stats))
    if only_fetch:
        sys.exit(0)

    # ---- parse every cached capture into (week, fips) -> price ---------------
    topo = ensure_topology()
    rosters = build_state_rosters(topo)
    idx = build_index(topo)

    import datetime
    def week_of(ts):
        d = datetime.date(int(ts[:4]), int(ts[4:6]), int(ts[6:8]))
        y, w, _ = d.isocalendar()
        return f"{y}-W{w:02d}"

    # today's id -> state map, to check the archive's ids against
    today = {}
    for fn in os.listdir("data/raw"):
        m = re.match(r"map_([A-Z]{2})_(\d+)\.js$", fn)
        if m:
            today[m.group(2)] = m.group(1)

    series = defaultdict(dict)      # week -> {fips: price}
    seen_states = defaultdict(set)  # week -> {state}
    bad = defaultdict(int)
    id_mismatch = defaultdict(int)
    files = sorted(os.listdir(RAW))
    for n, fn in enumerate(files, 1):
        ts, map_id = fn[:-3].split("_")
        js = open(os.path.join(RAW, fn), encoding="utf-8", errors="ignore").read()
        prices = extract(js)
        if not prices:
            bad["no_prices"] += 1
            continue
        st, score = infer_state(prices.keys(), rosters)
        if st is None:
            bad["state_unresolved"] += 1
            continue
        if map_id in today and today[map_id] != st:
            id_mismatch[f"{map_id}:{today[map_id]}->{st}"] += 1
        rows = [{"state": st, "county_raw": k, "price": v} for k, v in prices.items()]
        matched, unmatched, conflicts = join(rows, idx)
        wk = week_of(ts)
        for fips, rec in matched.items():
            series[wk][fips] = round(rec["price"], 3)
        seen_states[wk].add(st)
        bad["unmatched_rows"] += len(unmatched)
        if n % 1000 == 0:
            print(f"  parsed {n}/{len(files)}", flush=True)

    weeks = sorted(series)
    print(f"\nparsed {len(files)} captures -> {len(weeks)} weeks")
    print("parse issues:", dict(bad))
    print(f"map_id disagreements with today's mapping: {sum(id_mismatch.values())}"
          + (f"  {dict(list(id_mismatch.items())[:8])}" if id_mismatch else "  (ids stable)"))
    json.dump({"series": series, "states": {w: sorted(s) for w, s in seen_states.items()}},
              open("data/wayback/history_raw.json", "w"), separators=(",", ":"))
    # ---- emit the usable series ---------------------------------------------
    # Only weeks where most of the country was captured; a week with six states
    # in it is not a national observation and would skew any aggregate built on
    # it. The per-week state count ships too, so consumers can judge for
    # themselves rather than trusting this threshold.
    MIN_STATES = 45
    good = [w for w in weeks if len(seen_states[w]) >= MIN_STATES]
    fips_seen = sorted({f for w in good for f in series[w]})
    ix = {f: i for i, f in enumerate(fips_seen)}
    matrix = []
    for w in good:
        row = [None] * len(fips_seen)
        for f, p in series[w].items():
            row[ix[f]] = p
        matrix.append(row)

    out = {
        "weeks": good,
        "states_per_week": [len(seen_states[w]) for w in good],
        "fips": fips_seen,
        "prices": matrix,
        "source": "AAA county payloads via the Internet Archive, one capture per state-week",
    }
    json.dump(out, open("data/history.json", "w"), separators=(",", ":"))
    sz = os.path.getsize("data/history.json")

    print(f"weeks with >={MIN_STATES} states: {len(good)}  ({good[0]} .. {good[-1]})")
    print(f"counties covered: {len(fips_seen)}")
    filled = sum(1 for r in matrix for v in r if v is not None)
    print(f"cells filled: {filled:,}/{len(good)*len(fips_seen):,} "
          f"({100*filled/(len(good)*len(fips_seen)):.1f}%)")
    print(f"wrote data/history.json  {sz/1e6:.2f} MB")
