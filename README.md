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

The pipeline is Python 3 and needs `requests` and `shapely`. It writes
`data/counties.json` (read at build time) and `public/relief.json` (fetched by
the relief view at runtime, so it must be deployed).

```bash
npm run data
```

That runs five stages in order:

| Stage | What it does |
|---|---|
| `pipeline/fetch_prices.py` | Pulls AAA's daily county payload for all 50 states. Disk-cached in `data/raw/`, 1 req/sec — AAA returns 429 if pushed harder. |
| `pipeline/join.py` | Joins county names to Census FIPS. Emits an explicit unmatched/conflict report rather than silently dropping rows. |
| `pipeline/fetch_alaska.py` | Pulls the Alaska DCCED community fuel survey and aggregates it to boroughs by point-in-polygon. |
| `pipeline/build_data.py` | Projects geometry to SVG paths and merges every source into `data/counties.json`. |
| `pipeline/build_relief.py` | Projects the county outlines for the 3D relief into `public/relief.json`, with the shared colour domain. |

Re-running is safe: stage 1 serves from `data/raw/` unless you clear it.

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
