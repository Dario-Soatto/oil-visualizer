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
