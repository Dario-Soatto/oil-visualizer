"""Pull daily county-level retail gas prices from AAA's public county map payloads.

AAA renders a per-state county choropleth whose data lives in a JS config blob at
    /index.php?premiumhtml5map_js_data=true&map_id=<N>
where <N> is a per-state map id discoverable from that state's page.

The cache is keyed by fetch date. Re-running on the same day costs zero requests
(the point of the cache), but a new day always fetches fresh -- a flat cache
would make a scheduled job silently serve the first day's prices forever.
"""
import argparse, datetime, json, os, re, shutil, sys, time
import requests

# repo root, not pipeline/ -- every path in the pipeline is root-relative
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW_ROOT = os.path.join(HERE, "data", "raw")
KEEP_DAYS = 7          # prune older snapshot dirs; the parsed result is what we keep
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
HEADERS = {"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9",
           "Referer": "https://gasprices.aaa.com/"}
DELAY = 1.0  # be a polite guest on someone else's public page

STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN",
          "IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH",
          "NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT",
          "VT","VA","WA","WV","WI","WY"]


def prune(root, keep_days):
    cutoff = (datetime.date.today() - datetime.timedelta(days=keep_days)).isoformat()
    for d in sorted(os.listdir(root)) if os.path.isdir(root) else []:
        path = os.path.join(root, d)
        if os.path.isdir(path) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", d) and d < cutoff:
            shutil.rmtree(path, ignore_errors=True)


def get(url, cache_path, session):
    if os.path.exists(cache_path) and os.path.getsize(cache_path) > 500:
        return open(cache_path, encoding="utf-8", errors="ignore").read()
    for attempt in range(3):
        try:
            r = session.get(url, headers=HEADERS, timeout=30)
            if r.status_code == 200 and len(r.text) > 500:
                open(cache_path, "w", encoding="utf-8").write(r.text)
                time.sleep(DELAY)
                return r.text
            print(f"    HTTP {r.status_code} (attempt {attempt+1})", file=sys.stderr)
        except requests.RequestException as e:
            print(f"    {type(e).__name__} (attempt {attempt+1})", file=sys.stderr)
        time.sleep(2 * (attempt + 1))
    return None


def extract_map_id(html):
    m = re.search(r'premiumhtml5map_js_data=true[^"\']*?map_id=(\d+)', html)
    return m.group(1) if m else None


def extract_map_data(js):
    """Pull the map_data object out of the JS config via brace matching."""
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
                return json.loads(js[j:k + 1])
    return {}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=datetime.date.today().isoformat(),
                    help="snapshot date to fetch into (default: today)")
    ap.add_argument("--min-states", type=int, default=45,
                    help="fail the run if fewer states return data")
    args = ap.parse_args()

    raw_dir = os.path.join(RAW_ROOT, args.date)
    os.makedirs(raw_dir, exist_ok=True)
    prune(RAW_ROOT, KEEP_DAYS)
    print(f"snapshot date: {args.date}   cache: {raw_dir}")

    session = requests.Session()
    out, stats = [], []
    for st in STATES:
        html = get(f"https://gasprices.aaa.com/?state={st}",
                   os.path.join(raw_dir, f"page_{st}.html"), session)
        if not html:
            print(f"{st}: page fetch FAILED"); stats.append((st, 0, 0)); continue
        mid = extract_map_id(html)
        if not mid:
            print(f"{st}: no map_id"); stats.append((st, 0, 0)); continue
        js = get(f"https://gasprices.aaa.com/index.php?premiumhtml5map_js_data=true&map_id={mid}&ver=7.0.4",
                 os.path.join(raw_dir, f"map_{st}_{mid}.js"), session)
        if not js:
            print(f"{st}: map data FAILED"); stats.append((st, 0, 0)); continue

        data = extract_map_data(js)
        priced = 0
        for v in data.values():
            name = (v.get("name") or "").strip()
            raw = (v.get("comment") or "").strip()
            m = re.search(r"([\d.]+)", raw.replace("$", "").replace(",", ""))
            if not name or not m:
                continue
            try:
                price = float(m.group(1))
            except ValueError:
                continue
            if not (1.0 < price < 15.0):   # guard against parse junk
                continue
            out.append({"state": st, "county_raw": name, "price": price})
            priced += 1
        stats.append((st, priced, len(data)))
        print(f"{st} (map_id={mid}): {priced}/{len(data)} priced")

    os.makedirs(os.path.join(HERE, "data"), exist_ok=True)
    with open(os.path.join(HERE, "data", "county_prices.json"), "w") as f:
        json.dump({"date": args.date, "rows": out}, f, separators=(",", ":"))
    total = sum(s[1] for s in stats)
    live = [s[0] for s in stats if s[1] > 0]
    print(f"\nTOTAL priced county units: {total}")
    print(f"states with data: {len(live)}/{len(STATES)}")
    print(f"states with zero: {[s[0] for s in stats if s[1]==0]}")

    # A scheduled run must fail loudly rather than quietly shipping a half map.
    if len(live) < args.min_states:
        print(f"\nFAIL: only {len(live)} states returned data "
              f"(need {args.min_states}). Not updating downstream artifacts.",
              file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
