"""Fold today's snapshot into data/history.json.

The Wayback backfill reconstructed the past; this keeps the series going forward
without touching the archive again. Rows are ISO weeks, matching the backfill's
grain -- a scheduled daily run keeps rewriting the current week until it rolls
over, so re-running is idempotent rather than additive.

Weeks the backfill built stay put unless a fresh observation covers them.
"""
import datetime, json, os, sys

HIST = "data/history.json"
MIN_STATES = 45


def iso_week(d):
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


def main():
    counties = json.load(open("data/counties.json"))
    fetched = counties.get("fetched") or datetime.date.today().isoformat()
    day = datetime.date.fromisoformat(fetched)
    week = iso_week(day)

    priced = {c["f"]: c["p"] for c in counties["counties"] if c["p"] is not None}
    states = {c["s"] for c in counties["counties"] if c["p"] is not None}
    if len(states) < MIN_STATES:
        print(f"FAIL: snapshot covers {len(states)} states (need {MIN_STATES})",
              file=sys.stderr)
        return 1

    if os.path.exists(HIST):
        h = json.load(open(HIST))
    else:
        h = {"weeks": [], "states_per_week": [], "fips": [], "prices": [],
             "source": "AAA county payloads"}

    # widen the fips axis if this snapshot has counties the history never saw
    fips = list(h["fips"])
    known = {f: i for i, f in enumerate(fips)}
    added = [f for f in sorted(priced) if f not in known]
    for f in added:
        known[f] = len(fips)
        fips.append(f)
    if added:
        for row in h["prices"]:
            row.extend([None] * len(added))

    row = [None] * len(fips)
    for f, p in priced.items():
        row[known[f]] = p

    weeks = list(h["weeks"])
    spw = list(h["states_per_week"])
    if week in weeks:
        i = weeks.index(week)
        h["prices"][i] = row          # same week, fresher observation
        spw[i] = len(states)
        action = "replaced"
    else:
        # keep weeks in chronological order regardless of arrival order
        i = next((k for k, w in enumerate(weeks) if w > week), len(weeks))
        weeks.insert(i, week)
        spw.insert(i, len(states))
        h["prices"].insert(i, row)
        action = "inserted"

    h.update({"weeks": weeks, "states_per_week": spw, "fips": fips})
    json.dump(h, open(HIST, "w"), separators=(",", ":"))

    filled = sum(1 for v in row if v is not None)
    print(f"{action} {week} from {fetched}: {filled} counties, {len(states)} states")
    print(f"history now {len(weeks)} weeks ({weeks[0]} .. {weeks[-1]}), "
          f"{len(fips)} counties" + (f", +{len(added)} new" if added else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
