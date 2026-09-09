import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

// Queries run against the Neon Postgres the pipeline writes to each day.
//
// Connected lazily rather than at module scope: neon() throws outright when the
// connection string is absent, and at module scope that throw happens during
// import -- taking the whole page down before the caller's try/catch can run.
// The page is meant to degrade to a map with no trend when the database is
// unreachable, which includes the case where it was never configured.
let conn: NeonQueryFunction<false, false> | null = null;
function db() {
  if (!conn) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    conn = neon(url);
  }
  return conn;
}

/** Dates thin enough to render as a half-empty national map are not offered. */
const MIN_COUNTIES_FOR_A_MAP = 1000;

export interface TrendPoint {
  date: string;   // ISO date
  n: number;      // counties observed
  med: number;
  p10: number;
  p90: number;
}

/**
 * National distribution per observation date. Archive rows are weekly samples
 * and daily rows are single days; both are one point here, which is honest as
 * long as nothing tries to read a slope between two adjacent points as a rate.
 *
 * This doubles as the scrubber's list of selectable dates, so the coverage
 * floor here is what keeps a thin date from being pickable.
 */
export async function nationalTrend(): Promise<TrendPoint[]> {
  const rows = await db()`
    SELECT observed,
           count(*)::int AS n,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY price) AS med,
           percentile_cont(0.1) WITHIN GROUP (ORDER BY price) AS p10,
           percentile_cont(0.9) WITHIN GROUP (ORDER BY price) AS p90
    FROM prices
    GROUP BY observed
    HAVING count(*) > ${MIN_COUNTIES_FOR_A_MAP}::bigint
    ORDER BY observed`;
  return rows.map((r) => ({
    date: (r.observed as Date).toISOString().slice(0, 10),
    n: r.n as number,
    med: Number(r.med),
    p10: Number(r.p10),
    p90: Number(r.p90),
  }));
}

export async function coverage() {
  const [r] = await db()`
    SELECT count(*)::int AS rows,
           count(DISTINCT fips)::int AS counties,
           count(DISTINCT observed)::int AS dates,
           min(observed) AS first, max(observed) AS last
    FROM prices`;
  return {
    rows: r.rows as number,
    counties: r.counties as number,
    dates: r.dates as number,
    first: (r.first as Date).toISOString().slice(0, 10),
    last: (r.last as Date).toISOString().slice(0, 10),
  };
}

/**
 * Evenly spaced quantiles of the pooled distribution across every date.
 *
 * One scale for everything: every price on every date ranks against this, so a
 * given price is always the same colour and nothing is clamped. It spans the
 * full observed range, so no date falls outside it. Shipping all 275k values is
 * out of the question, so this is a 1,001-point summary the client interpolates
 * rank against; that is accurate to well under a cent.
 */
export async function pooledQuantiles(steps = 1000): Promise<number[]> {
  const fracs = Array.from({ length: steps + 1 }, (_, i) => i / steps);
  const [r] = await db()`
    SELECT percentile_cont(${fracs}::float8[]) WITHIN GROUP (ORDER BY price) AS q
    FROM prices`;
  return (r.q as unknown[]).map(Number);
}

/** Every county's price on one date, as parallel arrays to keep the wire small. */
export async function pricesOn(
  date: string,
): Promise<{ fips: string[]; price: number[]; source: string[] }> {
  const rows = await db()`
    SELECT fips, price, source FROM prices
    WHERE observed = ${date}::date ORDER BY fips`;
  return {
    fips: rows.map((r) => (r.fips as string).trim()),
    price: rows.map((r) => Number(r.price)),
    source: rows.map((r) => r.source as string),
  };
}
