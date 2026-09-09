import { neon } from "@neondatabase/serverless";

// Queries run against the Neon Postgres the pipeline writes to each day.
const sql = neon(process.env.DATABASE_URL!);

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
 */
export async function nationalTrend(): Promise<TrendPoint[]> {
  const rows = await sql`
    SELECT observed,
           count(*)::int AS n,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY price) AS med,
           percentile_cont(0.1) WITHIN GROUP (ORDER BY price) AS p10,
           percentile_cont(0.9) WITHIN GROUP (ORDER BY price) AS p90
    FROM prices
    GROUP BY observed
    HAVING count(*) > 1000
    ORDER BY observed`;
  return rows.map((r) => ({
    date: (r.observed as Date).toISOString().slice(0, 10),
    n: r.n as number,
    med: Number(r.med),
    p10: Number(r.p10),
    p90: Number(r.p90),
  }));
}

export interface CountyPoint {
  date: string;
  price: number;
}

export async function countyHistory(fips: string): Promise<CountyPoint[]> {
  const rows = await sql`
    SELECT observed, price FROM prices
    WHERE fips = ${fips}
    ORDER BY observed`;
  return rows.map((r) => ({
    date: (r.observed as Date).toISOString().slice(0, 10),
    price: Number(r.price),
  }));
}

export async function coverage() {
  const [r] = await sql`
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
 * Dates with enough coverage to draw a national map.
 * The archive sampled unevenly, so thin dates would render as a half-empty map.
 */
export async function availableDates(): Promise<{ date: string; n: number }[]> {
  const rows = await sql`
    SELECT observed, count(*)::int AS n
    FROM prices GROUP BY observed
    HAVING count(*) > 1000
    ORDER BY observed`;
  return rows.map((r) => ({
    date: (r.observed as Date).toISOString().slice(0, 10),
    n: r.n as number,
  }));
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
  const [r] = await sql`
    SELECT percentile_cont(${fracs}::float8[]) WITHIN GROUP (ORDER BY price) AS q
    FROM prices`;
  return (r.q as unknown[]).map(Number);
}

/** Every county's price on one date, as parallel arrays to keep the wire small. */
export async function pricesOn(
  date: string,
): Promise<{ fips: string[]; price: number[]; source: string[] }> {
  const rows = await sql`
    SELECT fips, price, source FROM prices
    WHERE observed = ${date}::date ORDER BY fips`;
  return {
    fips: rows.map((r) => (r.fips as string).trim()),
    price: rows.map((r) => Number(r.price)),
    source: rows.map((r) => r.source as string),
  };
}
