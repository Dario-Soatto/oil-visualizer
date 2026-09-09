import fs from "node:fs";
import path from "node:path";
import AtlasViews from "@/components/AtlasViews";
import { median, money, type MapData } from "@/lib/bins";
import { gradientCss, RAMP, rampColor, scalePosition, valueAtPosition } from "@/lib/color";
import TrendChart from "@/components/TrendChart";
import { availableDates, coverage, nationalTrend, pooledQuantiles } from "@/lib/db";
import DateScrubber from "@/components/DateScrubber";

// The map geometry is baked in; the trend comes from Postgres, so the page is
// revalidated hourly rather than fully static.
export const revalidate = 3600;

// Read at build time; the map ships as static HTML so it paints without a fetch.
function load(): MapData {
  const p = path.join(process.cwd(), "data", "counties.json");
  return JSON.parse(fs.readFileSync(p, "utf8")) as MapData;
}

export default async function Page() {
  const data = load();
  // If the database is unreachable the map must still render; the trend is an
  // addition to the page, not a prerequisite for it.
  let trend: Awaited<ReturnType<typeof nationalTrend>> = [];
  let cov: Awaited<ReturnType<typeof coverage>> | null = null;
  let dates: Awaited<ReturnType<typeof availableDates>> = [];
  let pooled: number[] = [];
  try {
    [trend, cov, dates, pooled] = await Promise.all([
      nationalTrend(), coverage(), availableDates(), pooledQuantiles(),
    ]);
  } catch (e) {
    console.error("history unavailable:", e);
  }

  const priced = data.counties.filter((c) => c.p !== null);
  const snapshotDomain = priced.map((c) => c.p as number).sort((a, b) => a - b);

  // Colour must mean the same thing on every date, so the map is ranked against
  // the pooled distribution over all dates -- not against this snapshot. Ranking
  // each date against itself would make every date look identical and the date
  // scrubber pointless. Falls back to the snapshot when the database is down.
  const sorted = pooled.length > 1 ? pooled : snapshotDomain;

  // Ticks sit at even positions along the ramp and are labelled with whatever
  // dollar value lands there, so the scale's non-linearity shows up as uneven
  // label spacing rather than being hidden.
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
    t,
    label: money(valueAtPosition(t, sorted)),
  }));

  const aaaBasis = priced.filter((c) => c.t === "aaa" || c.t === "dc");
  const aaaValues = aaaBasis.map((c) => c.p as number);
  const cheapest = aaaBasis.reduce((a, b) => ((a.p as number) < (b.p as number) ? a : b));
  const dearest = aaaBasis.reduce((a, b) => ((a.p as number) > (b.p as number) ? a : b));
  const surveyCount = priced.filter((c) => c.t === "ak").length;
  const missing = data.counties.length - priced.length;

  // Prices move a few cents a week, so an undated map quietly goes wrong. Say
  // how old it is, and say so louder once it is more than a week behind.
  const fetched = data.fetched ?? null;
  const ageDays = fetched
    ? Math.floor((Date.now() - Date.parse(fetched + "T00:00:00Z")) / 86_400_000)
    : null;
  const stale = ageDays != null && ageDays > 8;

  const paths = data.counties.map((c) => {
    // only the Alaska survey is a different vintage; DC is the same daily AAA feed
    const cls =
      c.p === null ? "county no-data" : `county${c.t === "ak" ? " survey" : ""}`;
    return (
      <path
        key={c.f}
        className={cls}
        style={
          c.p === null
            ? undefined
            : ({ "--f": rampColor(scalePosition(c.p, sorted), RAMP) } as React.CSSProperties)
        }
        d={c.d}
        data-f={c.f}
        data-n={c.n}
        data-s={c.s}
        data-p={c.p ?? undefined}
        data-note={c.note ?? undefined}
      />
    );
  });
  const stateLines = data.states.map((d, i) => <path key={i} className="state-line" d={d} />);

  return (
    <div className="mx-auto max-w-6xl px-8">
      <section className="flex flex-wrap items-end justify-between gap-8 py-14">
        <h1 className="font-serif text-5xl leading-[1.05] text-[var(--color-ink)] tracking-tight">
          What a gallon costs, county by{" "}
          <span className="font-serif italic text-[var(--color-vermillion)]">county</span>
        </h1>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-4 gap-x-6 text-xs">
            <Stat n={priced.length.toLocaleString()} label="counties" />
            <Stat n={money(median(aaaValues))} label="median" />
            <Stat n={money(cheapest.p as number)} label="cheapest" />
            <Stat n={money(dearest.p as number)} label="dearest" />
          </div>
          <p className="text-[10px] tracking-wider text-[var(--color-ink-mute)]">
            {priced.length.toLocaleString()}/{data.counties.length.toLocaleString()} counties
            priced &middot; {missing} unreported
            {fetched && (
              <>
                {" "}&middot;{" "}
                <span className={stale ? "text-[var(--color-vermillion)]" : undefined}>
                  as of {fetched}
                  {stale && ageDays != null ? ` (${ageDays} days old)` : ""}
                </span>
              </>
            )}
          </p>
        </div>
      </section>

      <section className="pb-12 border-t border-[var(--color-rule)] pt-8">
        <div className="flex items-baseline justify-between mb-5 gap-4 flex-wrap">
          <details className="group text-xs">
            <summary className="cursor-pointer list-none tracking-widest uppercase text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] select-none">
              <span className="inline-block w-3 text-[var(--color-ink-mute)] group-open:rotate-90 transition-transform">
                &rsaquo;
              </span>
              sources &amp; coverage
            </summary>
            <div className="mt-4 max-w-3xl text-[13px] leading-relaxed text-[var(--color-ink-soft)] normal-case tracking-normal flex flex-col gap-3">
              <p>
                AAA publishes a daily county average behind the county map on each state
                page; this reads that payload for all 50 states and joins it to Census
                county FIPS. The District of Columbia is a single county-equivalent, so
                its district-wide average is its county figure.
              </p>
              <p>
                AAA covers only Anchorage and Mat-Su in Alaska. The other {surveyCount}{" "}
                boroughs shown come from the Alaska DCCED community fuel survey,
                aggregated to borough and drawn with a dashed outline &mdash; that survey
                is semi-annual rather than daily.
              </p>
              <p>
                {priced.length.toLocaleString()} of{" "}
                {data.counties.length.toLocaleString()} county-equivalents carry a price (
                {((100 * priced.length) / data.counties.length).toFixed(1)}%). The
                remaining {missing} are hatched: almost all are among the least populated
                counties in the country, where no survey reports a pump price.
              </p>
            </div>
          </details>
        </div>
        {dates.length > 1 && pooled.length > 1 && (
          <DateScrubber dates={dates} pooled={pooled} />
        )}
        <AtlasViews
          viewBox={`0 0 ${data.w} ${data.h}`}
          stateLines={stateLines}
          gradient={gradientCss(RAMP)}
          ticks={ticks}
          reliefSrc="/relief.json"
        >
          {paths}
        </AtlasViews>
      </section>

      {trend.length > 1 && (
        <section className="pb-12 border-t border-[var(--color-rule)] pt-8">
          <div className="flex items-baseline justify-between mb-5 gap-4 flex-wrap">
            <h2 className="text-xs tracking-widest uppercase text-[var(--color-ink-soft)]">
              the national trend
            </h2>
            <span className="text-[10px] tracking-wider text-[var(--color-ink-mute)]">
              median county price &middot; shaded band is the 10th&ndash;90th percentile
            </span>
          </div>
          <div className="border border-[var(--color-rule)] bg-[var(--color-paper-warm)] px-4 py-4">
            <TrendChart data={trend} />
          </div>
          {cov && (
            <p className="mt-4 max-w-3xl text-[13px] leading-relaxed text-[var(--color-ink-soft)]">
              {cov.rows.toLocaleString()} observations across {cov.counties.toLocaleString()}{" "}
              counties and {cov.dates} dates, {cov.first} to {cov.last}. Everything before{" "}
              {data.fetched} was reconstructed from archived copies of AAA&rsquo;s county
              payload, sampled one capture per state-week; each daily refresh adds a point
              from here on.
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function Stat({ n, label }: { n: string; label: string }) {
  return (
    <div className="flex flex-col gap-0.5 leading-tight">
      <span className="font-serif text-xl text-[var(--color-ink)] tabular-nums">{n}</span>
      <span className="text-[10px] tracking-wider text-[var(--color-ink-mute)] uppercase">
        {label}
      </span>
    </div>
  );
}
