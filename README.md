# Pump Price Atlas

Retail gasoline price for every US county that has a reported figure — 3,115 of
3,142 county-equivalents (99.1%) — rendered as a continuous choropleth on an
Albers USA composite projection. Every county is coloured from its own price;
there are no classes.

Two views on one page, toggled: the flat choropleth, and a relief where each
county is extruded by its price. Both rank against the same colour domain, so a
price is the same colour in either.

Next.js App Router + TypeScript + Tailwind v4. The flat map uses no mapping
library at all — the projection and the SVG paths are precomputed by a small
Python pipeline, so the browser ships static markup and it paints without a
fetch or a hydration pass. The relief uses deck.gl, lazily imported on first
toggle so the default view never pays for a renderer it does not use (initial
client JS stays at ~143 KB brotli; deck.gl's ~150 KB arrives only on demand).

Styling follows the house system shared by `political-economy/midterms-2026` and
`political-economy/catalog` — the same paper/ink/rule tokens, JetBrains Mono for
body and Newsreader for display, light-only, square corners, hairline rules, and
numbered section headings.

## Deploy to Vercel

```bash
npx vercel
```

Zero configuration — it is a stock Next.js app. `data/counties.json` is committed,
so the build needs no network access and no Python on the build machine. The page
is statically prerendered (`○ Static`) and served from the CDN.

## Local development

```bash
npm install && npm run dev
```

## Refreshing the data

```bash
pip install -r requirements.txt
npm run data
```

Writes `data/counties.json` (read at build time), `public/relief.json` (fetched
by the relief view at runtime, so it must be deployed) and appends to
`data/history.json`.

Two stages:

| Stage | What it does |
|---|---|
| `pipeline/fetch.py` | The only network work for prices: 51 state pages to discover each `map_id`, then 51 county payloads. ~2 min, almost all of it the 1 req/sec delay — AAA 429s if pushed harder. Writes `data/prices.json`. |
| `pipeline/build.py` | Everything local, ~3 seconds. Joins names to FIPS, fills Alaska from the DCCED survey, projects the topology **once** and derives both outputs from that pass, appends to the history, and self-checks. |

`pipeline/geo.py` (projection + TopoJSON) and `pipeline/join.py` (name → FIPS)
are libraries, not stages. `pipeline/palette.py` is the design tool that
generated the colour ramp. `pipeline/backfill_history.py` is a one-off.

## Running it on a schedule

`.github/workflows/refresh-data.yml` runs the pipeline daily at 11:00 UTC and
commits the artifacts if they changed; Vercel redeploys on the push. Daily is
ample — prices move a few cents a week.

Four things make unattended runs safe, each of which exists because it went
wrong at least once here:

**The cache is keyed by date.** `data/raw/<YYYY-MM-DD>/`. The cache exists so a
re-run costs zero requests, but a flat one would have made a scheduled job serve
the first day's prices forever while looking perfectly healthy. Snapshots older
than 7 days are pruned; the parsed result is what is kept.

**The fetch fails loudly.** `fetch_prices.py` exits non-zero if fewer than 45 of
51 states return data, so a partial scrape stops the run instead of committing a
half-empty map. Tune with `--min-states`.

**The artifacts are checked before commit.** `pipeline/check_artifacts.py`
asserts county coverage, plausible price ranges, that the flat and relief views
share a vintage and colour domain, that no relief county sits below the
extrusion floor, and that the history stays ordered and gains the current week.

**The page states its own vintage.** `counties.json` carries a `fetched` date,
shown next to the coverage line, and it turns red past eight days. An undated map
goes wrong quietly; this one says so.

Re-running on the same day is idempotent — the cache is warm and
`append_history` rewrites the current week rather than appending a duplicate.

## Historical backfill

AAA's county payload carries only today's price — there is no history to ask it
for. But the endpoint itself has been archived ~28,000 times since 2019, and
each capture is one state's counties at that moment. `pipeline/backfill_history.py`
reconstructs a weekly county-level series from the Internet Archive:

```bash
python3 pipeline/backfill_history.py --index   # enumerate captures, pick one per state-week
python3 pipeline/backfill_history.py           # fetch, parse, join, emit data/history.json
```

It is resumable — every capture is cached under `data/wayback/raw/` (gitignored,
~73 MB), so re-running costs nothing for what already landed. A full cold run is
roughly 40 minutes at 5 workers.

State is inferred from each payload's own county-name set rather than read off
its `map_id`. The ids turn out to be stable (verified: zero disagreements with
today's mapping across all 6,231 captures) but they are opaque WordPress ids, and
a county roster identifies its state unambiguously regardless.

**What it yields:** 87 weeks where at least 45 of 51 states were captured,
spanning 2020-W15 to 2026-W34, covering 3,120 counties at 98.2% cell fill. The
longest unbroken weekly run is 48 weeks (2024-W52 → 2025-W47). Coverage thins
going back — 47 good weeks in 2025 against 2 in 2020 — because the archive
sampled the site far more often in recent years.

The result validates against reality: the April 2020 national median comes out at
$1.75 (the COVID crash), and the final archived week matches the live feed to the
cent (Dubois IN $3.29 vs $3.296; Harris TX $3.52 vs $3.55).

## Where the numbers come from

**AAA daily county averages** (3,105 counties) are the bulk. AAA renders a county
choropleth on each state page; its data lives in a JS config blob at
`/index.php?premiumhtml5map_js_data=true&map_id=<N>`, where the id is per-state and
discoverable from that state's page.

**District of Columbia** (1) is a single county-equivalent, so its district-wide AAA
average *is* its county figure.

**Alaska** (9 boroughs) comes from the [Alaska DCCED community fuel price
survey](https://www.commerce.alaska.gov/web/dcra/), reached through the state's
ArcGIS service. AAA covers only Anchorage and Mat-Su in Alaska — the DCCED survey
exists precisely to cover the rest. It matters: Kusilvak reports **$8.48/gal**,
which would top the national table outright, and no state-average fill would have
come close. This survey is semi-annual rather than daily, so those counties carry
their vintage in the tooltip and a dashed outline on the map.

## Decisions worth knowing

**Continuous colour, on a rank domain.** Each county's colour is interpolated
from its own price, in OKLab so intermediate colours stay perceptually even. The
ramp is positioned by the county's rank in the national distribution rather than
by raw dollars, because the distribution is hard right-skewed — median $3.94,
p90 $4.43, max $8.48. On a straight dollar scale **the middle 80% of counties
would occupy 15% of the ramp** and the map would read as one flat colour with a
handful of outliers. Ranking spends the ramp where the counties actually are.

Colour remains a strict function of price: equal prices get equal colour, and a
dearer county is always further along the ramp (verified — zero inversions across
all 3,115). The cost is that the scale is non-linear, which is why the legend's
dollar labels sit at uneven spacing and are marked "by percentile". The tooltip
carries the actual figure.

**Ramp anchors.** Pale sand → ochre → brick → plum → deep aubergine: ~145° of
hue over a 0.59 lightness span, wide enough that counties a little apart in price
differ in hue as well as tone, but held to low chroma so every stop reads as
printed earth pigment on the paper ground rather than as screen colour. The
palest step sits a shade off `--color-paper` itself. Anchors are generated in
OKLCH and validated for adjacent-pair colour-vision-deficient separation (protan
ΔE 12.4, normal-vision ΔE 16.6). Lightness is monotonic across the whole ramp —
verified zero inversions across all 3,115 counties — which is what keeps the
ordering readable under CVD even where hue does not survive. The palette is
light-only, matching the house system's `color-scheme: light`.

**The join refuses to guess.** Six county names collide with an independent city
inside the same state (Baltimore MD, St. Louis MO, and Richmond / Franklin /
Roanoke / Fairfax VA); in every case the city carries the higher FIPS, which is the
disambiguation rule. Census is itself inconsistent about spacing (`La Salle` vs
`LaSalle`), so matching also tries a space-collapsed key. AAA still reports a few
units under pre-rename or pre-split names — Shannon County SD is aliased to Oglala
Lakota, two pre-2008 Alaska census areas are mapped forward, and Bedford City and
Clifton Forge City are dropped as no longer being county-equivalents.

**Sub-pixel counties.** `counties-10m` simplifies the smallest independent cities
down to a 2-vertex sliver — Falls Church VA is ~2 sq mi and has no drawable polygon
at that resolution. Those are rendered as a minimum-size marker at the centroid
rather than dropped off the map.

## Known limits

- **A county average hides the station-to-station spread inside it**, which across
  a large metro can exceed a dollar. True station-level data is commercial only
  (OPIS, Barchart); no free feed covers it.
- **27 counties have no price from any source.** Almost all are among the least
  populated in the country. They render hatched, and the footer states the count.
- **The page is ~310 KB brotli** (2.8 MB raw), most of it county path
  geometry. That is the cost of drawing 3,142 real polygons plus a per-county
  colour; it is served static and cached at the edge, and Vercel negotiates
  brotli by default. If it needs to shrink, the state outlines are 19% of the
  geometry and are decorative.
