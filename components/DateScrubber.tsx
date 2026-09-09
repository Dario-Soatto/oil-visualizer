"use client";

import { useEffect, useRef, useState } from "react";
import { RAMP, rampColor, scalePosition } from "@/lib/color";

/**
 * Scrub the map back through every date in the database.
 *
 * The geometry never moves, so nothing is re-fetched but the numbers: each date
 * is ~60 KB of prices against the map's 1.2 MB of paths. Recolouring sets the
 * --f custom property on each path in place, which is far cheaper than
 * re-rendering 3,142 nodes.
 */
// Responses are cached for a day, so a change to the payload's shape has to
// change the URL or stale bodies keep arriving. Bump this whenever the
// /api/map response gains or loses a field.
const API_VERSION = 2;

/** Provenance shown on hover, per row source. */
const SOURCE_NOTE: Record<string, string | undefined> = {
  aaa: undefined,
  dc: "District-wide AAA average",
  ak: "AK community fuel survey",
  archive: "archived snapshot \u00B7 weekly sample",
};

export default function DateScrubber({
  dates,
  pooled,
}: {
  dates: { date: string; n: number }[];
  pooled: number[];
}) {
  const [i, setI] = useState(dates.length - 1);
  const [fixedScale, setFixedScale] = useState(true);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const cache = useRef(
    new Map<string, { fips: string[]; price: number[]; source?: string[] }>(),
  );
  const reqId = useRef(0);

  const current = dates[i];

  useEffect(() => {
    let cancelled = false;
    const my = ++reqId.current;

    async function paint() {
      const date = current.date;
      let data = cache.current.get(date);
      if (!data) {
        setLoading(true);
        try {
          const r = await fetch(`/api/map/${date}?v=${API_VERSION}`);
          if (!r.ok) throw new Error(String(r.status));
          data = (await r.json()) as {
            fips: string[];
            price: number[];
            source?: string[];
          };
          if (!Array.isArray(data.fips) || !Array.isArray(data.price)) {
            throw new Error("malformed response");
          }
          cache.current.set(date, data);
        } catch {
          if (!cancelled && my === reqId.current) setNote("could not load that date");
          return;
        } finally {
          if (!cancelled) setLoading(false);
        }
      }
      if (cancelled || my !== reqId.current) return;

      // fixed: rank against every date pooled, so colour means the same thing
      // on every frame. per-date: rank within this date, maximising contrast
      // but making dates incomparable.
      const domain = fixedScale ? pooled : [...data.price].sort((a, b) => a - b);
      const byFips = new Map<string, { p: number; s?: string }>();
      const src = data.source;                     // absent on older cached bodies
      data.fips.forEach((f, k) => byFips.set(f, { p: data!.price[k], s: src?.[k] }));

      const colour = new Map<number, string>();
      document.querySelectorAll<SVGPathElement>("path.county[data-f]").forEach((p) => {
        const f = p.getAttribute("data-f");
        const v = f ? byFips.get(f) : undefined;
        // Which counties report changes date to date, so the no-data hatch has
        // to follow the date too. Left on its build-time class, a county with no
        // price today would stay hatched on dates where it did report -- and
        // .no-data outranks the --f custom property in the cascade, so the
        // colour would be computed and then silently overridden.
        // The hover card reads these attributes, so they have to move with the
        // date. Left at their build-time values the card reports today's price
        // while the map is coloured for the date you picked -- the map is right
        // and the number beside it is wrong, which is worse than either alone.
        p.dataset.date = date;
        if (v == null) {
          p.classList.add("no-data");
          p.style.removeProperty("--f");
          delete p.dataset.p;
          delete p.dataset.note;
          return;
        }
        p.classList.remove("no-data");
        p.dataset.p = String(v.p);
        const note = v.s ? SOURCE_NOTE[v.s] : undefined;
        if (note) p.dataset.note = note;
        else delete p.dataset.note;

        const key = Math.round(v.p * 1000);
        let c = colour.get(key);
        if (!c) {
          c = rampColor(scalePosition(v.p, domain), RAMP);
          colour.set(key, c);
        }
        p.style.setProperty("--f", c);
      });
      setNote(`${data.fips.length.toLocaleString()} counties reported`);
    }

    paint().catch((err) => {
      console.error("repaint failed", err);
      if (!cancelled) setNote("could not draw that date");
    });
    return () => {
      cancelled = true;
    };
  }, [i, fixedScale, current.date, pooled]);

  const btn = (on: boolean) =>
    `px-2.5 py-1 text-[10px] tracking-wider border border-[var(--color-rule)] transition-colors ${
      on
        ? "bg-[var(--color-ink)] text-[var(--color-paper)]"
        : "bg-[var(--color-paper)] hover:bg-[var(--color-paper-warm)] text-[var(--color-ink-soft)]"
    }`;

  return (
    <div className="flex flex-wrap items-end gap-x-8 gap-y-3 mb-4">
      <div className="flex flex-col gap-1.5 flex-1 min-w-[280px]">
        <span className="text-[10px] tracking-widest uppercase text-[var(--color-ink-mute)]">
          date &middot;{" "}
          <span className="text-[var(--color-ink)]">{current.date}</span>
          {loading && <span className="text-[var(--color-ink-mute)]"> &middot; loading…</span>}
          {!loading && note && <span className="text-[var(--color-ink-mute)]"> &middot; {note}</span>}
        </span>
        <input
          type="range"
          min={0}
          max={dates.length - 1}
          step={1}
          value={i}
          onChange={(e) => setI(+e.target.value)}
          className="w-full accent-[var(--color-vermillion)]"
          aria-label="Observation date"
        />
        <div className="flex justify-between text-[9px] tracking-wider text-[var(--color-ink-mute)] tabular-nums">
          <span>{dates[0].date}</span>
          <span>{dates[dates.length - 1].date}</span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] tracking-widest uppercase text-[var(--color-ink-mute)]">
          colour scale
        </span>
        <div className="flex gap-px">
          <button className={btn(fixedScale)} onClick={() => setFixedScale(true)}>
            across all dates
          </button>
          <button className={btn(!fixedScale)} onClick={() => setFixedScale(false)}>
            this date only
          </button>
        </div>
      </div>
    </div>
  );
}
