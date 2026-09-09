"""Post-build sanity checks, so a scheduled run fails loudly instead of
committing a broken map.

Every check here has actually gone wrong at some point in this project's
history, which is why it is checked rather than assumed.
"""
import datetime, json, os, sys

PROBLEMS = []


def bad(msg):
    PROBLEMS.append(msg)


def main():
    counties = json.load(open("data/counties.json"))
    relief = json.load(open("public/relief.json"))
    hist = json.load(open("data/history.json"))

    units = counties["counties"]
    priced = [c for c in units if c["p"] is not None]
    vals = [c["p"] for c in priced]
    states = {c["s"] for c in priced}

    # --- coverage -----------------------------------------------------------
    if len(units) < 3100:
        bad(f"only {len(units)} county units rendered (expected ~3142)")
    if len(priced) < 3000:
        bad(f"only {len(priced)} counties priced (expected ~3115)")
    if len(states) < 45:
        bad(f"only {len(states)} states represented")

    # --- plausibility -- a parse failure usually shows up as absurd numbers --
    if vals and not (1.0 < min(vals) < 10.0 and 1.0 < max(vals) < 25.0):
        bad(f"price range implausible: ${min(vals):.2f}-${max(vals):.2f}")

    # --- freshness ----------------------------------------------------------
    fetched = counties.get("fetched")
    if not fetched:
        bad("counties.json carries no fetch date")
    else:
        age = (datetime.date.today() - datetime.date.fromisoformat(fetched)).days
        if age > 2:
            bad(f"counties.json is {age} days old ({fetched})")

    # --- the two views must agree ------------------------------------------
    if relief.get("fetched") != fetched:
        bad(f"relief vintage {relief.get('fetched')} != counties {fetched}")
    if len(relief.get("domain", [])) != len(priced):
        bad(f"relief colour domain has {len(relief.get('domain', []))} values, "
            f"counties has {len(priced)} priced")

    # --- nothing below the extrusion floor ---------------------------------
    rp = [c["p"] for c in relief["counties"] if c.get("p") is not None]
    if rp and relief.get("domain") and min(rp) < min(relief["domain"]) - 1e-9:
        bad("a relief county sits below the colour domain floor")

    # --- history stays ordered and keeps growing ---------------------------
    weeks = hist["weeks"]
    if weeks != sorted(weeks):
        bad("history weeks are not in chronological order")
    if len(weeks) != len(set(weeks)):
        bad("history has duplicate weeks")
    if len(hist["prices"]) != len(weeks):
        bad("history price rows do not match week count")
    for row in hist["prices"]:
        if len(row) != len(hist["fips"]):
            bad("a history row is not the width of the fips axis")
            break
    if fetched:
        y, w, _ = datetime.date.fromisoformat(fetched).isocalendar()
        cur = f"{y}-W{w:02d}"
        if weeks and weeks[-1] != cur:
            bad(f"latest history week is {weeks[-1]}, expected {cur}")

    print(f"counties : {len(priced)}/{len(units)} priced, {len(states)} states, "
          f"${min(vals):.2f}-${max(vals):.2f}, fetched {fetched}")
    print(f"relief   : {len(relief['counties'])} outlines, domain {len(relief['domain'])}")
    print(f"history  : {len(weeks)} weeks, {weeks[0]} .. {weeks[-1]}, {len(hist['fips'])} counties")

    if PROBLEMS:
        print("\nFAILED:", file=sys.stderr)
        for p in PROBLEMS:
            print(f"  - {p}", file=sys.stderr)
        return 1
    print("\nall checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
