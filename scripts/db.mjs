/**
 * Database work for the atlas: schema, historical backfill, and the daily load.
 *
 *   node --env-file=.env.local scripts/db.mjs migrate
 *   node --env-file=.env.local scripts/db.mjs backfill
 *   node --env-file=.env.local scripts/db.mjs ingest    today's snapshot -> history
 *   node --env-file=.env.local scripts/db.mjs verify    did it land?
 *   node --env-file=.env.local scripts/db.mjs stats
 *
 * Prices are stored one row per county per observation date. The Wayback
 * backfill sampled one capture per state-week, so those rows land on the Monday
 * of their ISO week and are marked source='archive' -- they are weekly samples,
 * not daily readings, and anything aggregating them should be able to tell.
 */
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  console.error(
    "DATABASE_URL is not set.\n" +
    "  locally:  npx vercel env pull .env.local --environment=development\n" +
    "            then run with  node --env-file=.env.local scripts/db.mjs <cmd>\n" +
    "  in CI:    set it as a repository secret (Settings > Secrets > Actions)",
  );
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const BATCH = 4000;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS counties (
     fips  CHAR(5) PRIMARY KEY,
     name  TEXT    NOT NULL,
     state CHAR(2) NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS prices (
     fips     CHAR(5)      NOT NULL REFERENCES counties(fips),
     observed DATE         NOT NULL,
     price    NUMERIC(6,3) NOT NULL,
     source   TEXT         NOT NULL,
     PRIMARY KEY (fips, observed)
   )`,
  `CREATE INDEX IF NOT EXISTS prices_observed_idx ON prices (observed)`,
  `CREATE INDEX IF NOT EXISTS prices_fips_observed_idx ON prices (fips, observed DESC)`,
];

/** Monday of an ISO week label like "2026-W37". */
function isoWeekMonday(label) {
  const [y, w] = label.split("-W").map(Number);
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const dow = jan4.getUTCDay() || 7;                 // Mon=1..Sun=7
  const week1Mon = new Date(jan4);
  week1Mon.setUTCDate(jan4.getUTCDate() - dow + 1);
  const d = new Date(week1Mon);
  d.setUTCDate(week1Mon.getUTCDate() + (w - 1) * 7);
  return d.toISOString().slice(0, 10);
}

async function upsertCounties(rows) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const b = rows.slice(i, i + BATCH);
    await sql`
      INSERT INTO counties (fips, name, state)
      SELECT * FROM UNNEST(${b.map(r => r.fips)}::char(5)[],
                           ${b.map(r => r.name)}::text[],
                           ${b.map(r => r.state)}::char(2)[])
      ON CONFLICT (fips) DO UPDATE SET name = EXCLUDED.name, state = EXCLUDED.state`;
  }
}

async function upsertPrices(rows) {
  let done = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const b = rows.slice(i, i + BATCH);
    await sql`
      INSERT INTO prices (fips, observed, price, source)
      SELECT * FROM UNNEST(${b.map(r => r.fips)}::char(5)[],
                           ${b.map(r => r.observed)}::date[],
                           ${b.map(r => r.price)}::numeric[],
                           ${b.map(r => r.source)}::text[])
      ON CONFLICT (fips, observed)
        DO UPDATE SET price = EXCLUDED.price, source = EXCLUDED.source`;
    done += b.length;
    if (done % 40000 === 0) console.log(`   ${done.toLocaleString()} rows`);
  }
  return done;
}

function countyDim() {
  const d = JSON.parse(readFileSync("data/counties.json", "utf8"));
  return d.counties.map(c => ({ fips: c.f, name: c.n, state: c.s }));
}

const cmd = process.argv[2];

if (cmd === "migrate") {
  for (const stmt of SCHEMA) await sql.query(stmt);
  console.log(`schema ready (${SCHEMA.length} statements)`);

} else if (cmd === "backfill") {
  const dim = countyDim();
  const known = new Set(dim.map(c => c.fips));
  const h = JSON.parse(readFileSync("data/history.json", "utf8"));

  // history can carry a fips the current topology no longer lists; keep the
  // row rather than dropping the observation, with a placeholder name
  for (const f of h.fips) {
    if (!known.has(f)) dim.push({ fips: f, name: "(retired unit)", state: "??" });
  }
  await upsertCounties(dim);
  console.log(`counties: ${dim.length}`);

  const rows = [];
  h.weeks.forEach((week, wi) => {
    const observed = isoWeekMonday(week);
    h.prices[wi].forEach((p, fi) => {
      if (p != null) rows.push({ fips: h.fips[fi], observed, price: p, source: "archive" });
    });
  });
  console.log(`backfilling ${rows.length.toLocaleString()} weekly observations…`);
  const n = await upsertPrices(rows);
  console.log(`inserted/updated ${n.toLocaleString()}`);

} else if (cmd === "ingest") {
  const d = JSON.parse(readFileSync("data/counties.json", "utf8"));
  const observed = d.fetched;
  if (!observed) throw new Error("data/counties.json has no fetched date");
  await upsertCounties(countyDim());
  const rows = d.counties
    .filter(c => c.p !== null)
    .map(c => ({ fips: c.f, observed, price: c.p, source: c.t ?? "aaa" }));
  if (rows.length < 3000) {
    throw new Error(`snapshot has only ${rows.length} priced counties; refusing to ingest`);
  }
  const n = await upsertPrices(rows);

  // Read the day back rather than trusting the write. A scrape that does not
  // reach the history is the failure that matters here and it is otherwise
  // silent -- the map still renders from counties.json, so nothing looks wrong
  // until you scrub back and find the date missing.
  const [got] = await sql`
    SELECT count(*)::int AS n FROM prices WHERE observed = ${observed}::date`;
  if (got.n !== rows.length) {
    throw new Error(
      `ingest did not land: wrote ${rows.length} rows for ${observed}, ` +
      `database reports ${got.n}`,
    );
  }
  console.log(`ingested ${n.toLocaleString()} prices for ${observed}; verified in database`);

} else if (cmd === "verify") {
  // Standalone form of the check above, for asking "did today's scrape make it
  // into the history?" without rewriting anything.
  const d = JSON.parse(readFileSync("data/counties.json", "utf8"));
  const observed = d.fetched;
  const expected = d.counties.filter(c => c.p !== null).length;
  const [got] = await sql`
    SELECT count(*)::int AS n FROM prices WHERE observed = ${observed}::date`;
  if (got.n === 0) {
    console.error(`MISSING: no rows for ${observed}; run "db.mjs ingest"`);
    process.exit(1);
  }
  if (got.n !== expected) {
    console.error(`PARTIAL: ${observed} has ${got.n} rows, snapshot has ${expected}`);
    process.exit(1);
  }
  console.log(`${observed}: ${got.n.toLocaleString()} rows present`);

} else if (cmd === "stats") {
  const [a] = await sql`SELECT count(*)::int AS rows,
                               count(DISTINCT fips)::int AS counties,
                               count(DISTINCT observed)::int AS dates,
                               min(observed) AS first, max(observed) AS last
                        FROM prices`;
  console.log(a);
  const bySrc = await sql`SELECT source, count(*)::int AS n FROM prices GROUP BY source ORDER BY n DESC`;
  console.table(bySrc);

} else {
  console.error("usage: db.mjs migrate|backfill|ingest|verify|stats");
  process.exit(1);
}
