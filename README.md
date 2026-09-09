# Pump Price Atlas

Retail gasoline price for every US county that has a reported figure — around
3,100 of 3,142 county-equivalents (~98–99%; the exact count moves with AAA's
daily coverage, and the page states the day's figure) — rendered as a continuous
choropleth on an Albers USA composite projection. Every county is coloured from its own price;
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

Writes `data/counties.json` (read at build time) and `public/relief.json`
(fetched by the relief view at runtime, so it must be deployed). The price
history lives in Postgres; `scripts/db.mjs ingest` puts the snapshot there.

Two stages:

| Stage | What it does |
|---|---|
| `pipeline/fetch.py` | The only network work for prices: 51 state pages to discover each `map_id`, then 51 county payloads. ~2 min, almost all of it the 1 req/sec delay — AAA 429s if pushed harder. Writes `data/prices.json`. |
| `pipeline/build.py` | Everything local, ~3 seconds. Joins names to FIPS, fills Alaska from the DCCED survey, projects the topology **once** and derives both outputs from that pass, and self-checks. |

`pipeline/geo.py` (projection + TopoJSON) and `pipeline/join.py` (name → FIPS)
are libraries, not stages. `pipeline/palette.py` is the design tool that
generated the colour ramp. `pipeline/backfill_history.py` is a one-off that has
already been run; `data/history.json` is its frozen output, kept as the seed for
`db.mjs backfill` and not rewritten by the daily pipeline.

## Database

Prices are also written to a Neon Postgres (`oil-visualizer-db`, provisioned
through Vercel's marketplace on the free tier), which is what backs the trend
chart and every date the scrubber can reach.

```sql
counties (fips, name, state)
prices   (fips, observed, price, source)   -- PK (fips, observed)
```

`source` distinguishes a daily reading (`aaa` / `dc` / `ak`) from a weekly
sample reconstructed out of the Internet Archive (`archive`). Archive rows land
on the Monday of their ISO week, so nothing should read the slope between two
adjacent points as a daily rate.

```bash
npx vercel env pull .env.local --environment=development   # get DATABASE_URL
node --env-file=.env.local scripts/db.mjs migrate          # create tables
node --env-file=.env.local scripts/db.mjs backfill         # load data/history.json
node --env-file=.env.local scripts/db.mjs ingest           # load today's snapshot
node --env-file=.env.local scripts/db.mjs verify           # did today's land?
node --env-file=.env.local scripts/db.mjs stats            # what is in there
```

Currently 275,733 observations across 3,128 counties and 90 dates, 2020-04-06 to
2026-09-09. `ingest` is idempotent — it upserts on `(fips, observed)`, so
re-running a day overwrites rather than duplicates — and it reads the day back
after writing, so it fails rather than reporting success on a write that did not
land.

**Both views follow the date.** The scrubber publishes the selected date through
a small external store (`lib/mapDate.ts`) that the relief subscribes to, so
scrubbing recolours the flat map and both recolours *and* re-extrudes the
relief. Relief height is measured from a baseline fixed across dates, so the
terrain visibly rises over the period rather than only changing hue — April 2020
renders pale and flat, June 2022 dark and tall.

**Scrubbing back through time.** The trend chart above the map doubles as the
date control and replays every date in the database. A plain slider was wrong
here: observations are not evenly spaced, so its midpoint landed 81% of the way
through the span. On the chart x is real time, and a tick under the axis marks
each observation, so sparse years read as sparse. The geometry never moves, so only the numbers travel — about
38 KB per date against the map's 1.2 MB of paths — and recolouring sets the
`--f` custom property on each path in place rather than re-rendering 3,142 nodes.

There is one colour scale and nothing is clamped. Every price on every date
ranks against a single domain built from all 275k observations, which spans the
full observed range, so a given price is the same colour wherever and whenever
it appears and no date falls outside the ramp. April 2020 renders pale
(median $1.75, the COVID collapse) and today renders dark ($3.91).

The cost is arithmetic rather than a design choice: prices roughly doubled over
the covered period, so any single date occupies a slice of the ramp rather than
the whole of it. That is the price of one price meaning one colour.

Widening the ramp buys contrast back across the board but cannot rescue the
flattest dates, and nothing can. In April 2020 the national p5–p95 was
$1.40–$2.39 — genuinely 5% of the domain — so that map reads nearly uniform
because the country nearly was. Raising `RANK_WEIGHT` makes it worse rather than
better: ranking uniformly cheap counties against a pooled domain bunches them
tighter still, taking 2020 from ΔE 3.3 to 1.4 at pure rank. The 0.25 dollar term
is the only thing giving those dates any spread.

The page reads the database through `lib/db.ts` and revalidates hourly. If the
database is unreachable the trend section is omitted and the map still renders;
the map's data is baked in at build time and never depends on Postgres.

## Running it on a schedule

`.github/workflows/refresh-data.yml` runs the pipeline daily at 11:00 UTC and
commits the artifacts if they changed; Vercel redeploys on the push. Daily is
ample — prices move a few cents a week.

Five things make unattended runs safe, each of which exists because it went
wrong at least once here:

**The cache is keyed by date.** `data/raw/<YYYY-MM-DD>/`. The cache exists so a
re-run costs zero requests, but a flat one would have made a scheduled job serve
the first day's prices forever while looking perfectly healthy. Snapshots older
than 7 days are pruned; the parsed result is what is kept.

**The fetch fails loudly.** `pipeline/fetch.py` exits non-zero if fewer than 45
of 51 states return data, so a partial scrape stops the run instead of
committing a half-empty map. Tune with `--min-states`.

**The artifacts are checked before commit.** `check()` in `pipeline/build.py`
asserts county coverage, that *every* jurisdiction contributes at least one
priced county (a count threshold alone let DC go missing once), plausible price
ranges, that the snapshot is not stale, and that no relief county sits below the
colour domain floor.

**The database load is not optional, and it verifies itself.** It used to be
skipped when `DATABASE_URL` was unset — which meant a repository without the
secret ran green every day while writing nothing to the history, hiding the one
failure the history exists to prevent. The step now runs unconditionally and
fails with an explanatory message if the secret is missing, and `ingest` reads
the date back after writing it. AAA serves only today's prices, so a day that
does not reach Postgres is a permanent hole; it should be loud. The commit step
runs *before* the load, so a database outage still leaves the day's map in the
repo.

**The page states its own vintage.** `counties.json` carries a `fetched` date,
shown next to the coverage line, and it turns red past eight days. An undated map
goes wrong quietly; this one says so.

Re-running on the same day is idempotent — the cache is warm and `ingest`
upserts on `(fips, observed)` rather than inserting a duplicate.

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

**AAA daily county averages** (~3,090 counties, varying daily) are the bulk. AAA renders a county
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
every priced county). The cost is that the scale is non-linear, which is why the legend's
dollar labels sit at uneven spacing and are marked "by percentile". The tooltip
carries the actual figure.

**Ramp anchors.** Cream → amber → coral → magenta → near-black indigo, in seven
steps: 154° of hue over a 0.74 lightness span, peaking at 0.174 chroma. The
palest step sits a shade off `--color-paper` itself. Anchors are generated in
OKLCH and validated for adjacent-pair colour-vision-deficient separation
(normal ΔE 14.1, protan 9.5, deutan 11.6, tritan 12.9, Viénot simulation).
Lightness is monotonic across the whole ramp — verified zero inversions across
every priced county — which is what keeps the ordering readable under CVD even
where hue does not survive. The palette is light-only, matching the house
system's `color-scheme: light`.

The ramp is deliberately wide, and the width is load-bearing rather than
decorative. Because every date ranks against one pooled domain spanning
$1.05–$8.48, a single date only occupies a slice of it — about 22% for a recent
date, 57% for a mid-2025 one. Contrast *within* a date is therefore the ramp's
perceptual arc length across that slice, and the only lever that raises it
without breaking “one price, one colour” is a longer path through colour space:
a darker dark end and more chroma. These seven anchors measure ΔE 89.5 end to
end against the 68.7 of the five-anchor version they replaced, which takes a
recent date from ΔE 15.5 to 20.9 across its middle 90%.

Chroma stops at 0.174 rather than going to the sRGB limit. An eighth anchor at
~0.215 measured better again (ΔE 23.7, +53% instead of +35%) but its mid-ramp
steps read as screen colour rather than as printed pigment, which is a visible
departure from the house system. The extra legibility was not worth leaving the
palette the rest of these pages share.

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
- **A few dozen counties have no price from any source** (49 on the latest
  snapshot; the number moves daily with AAA). Almost all are among the least
  populated in the country. They render hatched, and the footer states the count.
- **The page is ~310 KB brotli** (2.8 MB raw), most of it county path
  geometry. That is the cost of drawing 3,142 real polygons plus a per-county
  colour; it is served static and cached at the edge, and Vercel negotiates
  brotli by default. If it needs to shrink, the state outlines are 19% of the
  geometry and are decorative.
