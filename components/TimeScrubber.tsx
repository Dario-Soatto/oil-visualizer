"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RAMP, rampColor, scalePosition } from "@/lib/color";
import type { TrendPoint } from "@/lib/db";
import { setMapDate, SOURCE_NOTE } from "@/lib/mapDate";

const W = 900;
const H = 250;
const PAD = { t: 14, r: 16, b: 34, l: 46 };

// Bump when the /api/map response gains or loses a field: the route caches for
// a day, so a shape change has to change the URL or stale bodies keep arriving.
const API_VERSION = 2;

type Row = { fips: string[]; price: number[]; source?: string[] };

/**
 * The trend chart doubles as the date control.
 *
 * A plain slider was wrong here: observations are not evenly spaced in time.
 * Its midpoint landed on 2025-06-09 — 81% of the way through the span — because
 * 46 of 90 dates fall in 2025 while 2020–2022 hold six between them, and gaps
 * run from 7 days to 455. Index-space and time-space are different spaces, so a
 * control positioned by index misreports when you are.
 *
 * Here x is real time. Ticks under the axis mark every observation, so the
 * sparse years read as sparse instead of eating a third of the travel, and you
 * pick a date by pointing at the moment on the price curve you care about.
 */
export default function TimeScrubber({
  trend,
  pooled,
}: {
  trend: TrendPoint[];
  /** the one colour domain: every price on every date ranks against this */
  pooled: number[];
}) {
  const [i, setI] = useState(trend.length - 1);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const cache = useRef(new Map<string, Row>());
  const reqId = useRef(0);
  const dragging = useRef(false);

  const t0 = Date.parse(trend[0].date);
  const t1 = Date.parse(trend[trend.length - 1].date);
  const lo = Math.min(...trend.map((d) => d.p10));
  const hi = Math.max(...trend.map((d) => d.p90));
  const yLo = Math.floor(lo * 2) / 2;
  const yHi = Math.ceil(hi * 2) / 2;

  const x = (d: string) => PAD.l + ((Date.parse(d) - t0) / (t1 - t0)) * (W - PAD.l - PAD.r);
  const y = (v: number) => H - PAD.b - ((v - yLo) / (yHi - yLo)) * (H - PAD.t - PAD.b);

  /** nearest observation to a pointer position, in real time not index */
  const pick = useCallback(
    (clientX: number) => {
      const el = svgRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vx = ((clientX - r.left) / r.width) * W;
      const frac = (vx - PAD.l) / (W - PAD.l - PAD.r);
      const target = t0 + frac * (t1 - t0);
      let best = 0;
      let bestD = Infinity;
      trend.forEach((p, k) => {
        const d = Math.abs(Date.parse(p.date) - target);
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      });
      setI(best);
    },
    [trend, t0, t1],
  );

  // ---- repaint the map for the selected date -------------------------------
  useEffect(() => {
    let cancelled = false;
    const my = ++reqId.current;
    const date = trend[i].date;

    async function paint() {
      let data = cache.current.get(date);
      if (!data) {
        setLoading(true);
        try {
          const r = await fetch(`/api/map/${date}?v=${API_VERSION}`);
          if (!r.ok) throw new Error(String(r.status));
          data = (await r.json()) as Row;
          if (!Array.isArray(data.fips) || !Array.isArray(data.price)) {
            throw new Error("malformed response");
          }
          cache.current.set(date, data);
        } finally {
          if (!cancelled) setLoading(false);
        }
      }
      if (cancelled || my !== reqId.current) return;

      // fixed: rank against every date pooled, so a price is one colour on every
      // frame. per-date: rank within this date, maximising contrast but making
      // dates incomparable.
      // One domain, spanning every observation on every date. A price maps to
      // the same colour wherever and whenever it appears, and nothing clamps
      // because the domain covers the full observed range.
      const domain = pooled;
      const src = data.source;
      const byFips = new Map<string, { p: number; s?: string }>();
      data.fips.forEach((f, k) => byFips.set(f, { p: data!.price[k], s: src?.[k] }));

      const colour = new Map<number, string>();
      document.querySelectorAll<SVGPathElement>("path.county[data-f]").forEach((p) => {
        const f = p.getAttribute("data-f");
        const v = f ? byFips.get(f) : undefined;
        // the hover card reads these, so they move with the date too
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
        const n = v.s ? SOURCE_NOTE[v.s] : undefined;
        if (n) p.dataset.note = n;
        else delete p.dataset.note;

        const key = Math.round(v.p * 1000);
        let c = colour.get(key);
        if (!c) {
          c = rampColor(scalePosition(v.p, domain), RAMP);
          colour.set(key, c);
        }
        p.style.setProperty("--f", c);
      });
      // publish for the relief, which colours and extrudes from the same values
      setMapDate({ date, byFips, domain, base: pooled[0] ?? 0 });
      setNote(`${data.fips.length.toLocaleString()} counties reported`);
    }

    paint().catch((err) => {
      console.error("repaint failed", err);
      if (!cancelled) setNote("could not draw that date");
    });
    return () => {
      cancelled = true;
    };
  }, [i, trend, pooled]);

  const band =
    trend.map((d) => `${x(d.date).toFixed(1)},${y(d.p90).toFixed(1)}`).join(" L ") +
    " L " +
    [...trend].reverse().map((d) => `${x(d.date).toFixed(1)},${y(d.p10).toFixed(1)}`).join(" L ");
  const line = trend.map((d) => `${x(d.date).toFixed(1)},${y(d.med).toFixed(1)}`).join(" L ");

  const ticks: number[] = [];
  for (let v = yLo; v <= yHi + 1e-9; v += 0.5) ticks.push(v);
  const years: { year: number; px: number }[] = [];
  for (let yr = new Date(t0).getUTCFullYear(); yr <= new Date(t1).getUTCFullYear(); yr++) {
    const ms = Date.UTC(yr, 0, 1);
    if (ms >= t0 && ms <= t1) years.push({ year: yr, px: x(new Date(ms).toISOString().slice(0, 10)) });
  }

  const sel = trend[i];
  const step = (d: number) => setI((k) => Math.min(trend.length - 1, Math.max(0, k + d)));
  const stepBtn =
    "h-6 w-6 flex items-center justify-center border border-[var(--color-rule)] bg-[var(--color-paper)] hover:bg-[var(--color-paper-warm)] text-[var(--color-ink-soft)] disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div className="mb-5">
      <div className="flex items-end justify-between gap-4 flex-wrap mb-2">
        <div className="flex items-center gap-2">
          <button className={stepBtn} onClick={() => step(-1)} disabled={i === 0}
                  aria-label="previous observation">&lsaquo;</button>
          <button className={stepBtn} onClick={() => step(1)} disabled={i === trend.length - 1}
                  aria-label="next observation">&rsaquo;</button>
          <span className="text-[10px] tracking-widest uppercase text-[var(--color-ink-mute)]">
            <span className="text-[var(--color-ink)] tabular-nums">{sel.date}</span>
            {" "}&middot; median{" "}
            <span className="text-[var(--color-ink)] tabular-nums">${sel.med.toFixed(2)}</span>
            {loading ? " · loading…" : note ? ` · ${note}` : ""}
          </span>
        </div>
      </div>

      <div className="border border-[var(--color-rule)] bg-[var(--color-paper-warm)] px-3 py-2">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-auto block cursor-crosshair select-none touch-none"
          role="group"
          aria-label="National price trend; click or drag to choose a date"
          tabIndex={0}
          onPointerDown={(e) => {
            dragging.current = true;
            (e.target as Element).setPointerCapture?.(e.pointerId);
            pick(e.clientX);
          }}
          onPointerMove={(e) => dragging.current && pick(e.clientX)}
          onPointerUp={(e) => {
            dragging.current = false;
            (e.target as Element).releasePointerCapture?.(e.pointerId);
          }}
          onPointerCancel={() => (dragging.current = false)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
            if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
          }}
        >
          {ticks.map((v) => (
            <g key={v}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)}
                    stroke="var(--color-rule)" strokeWidth={0.5} />
              <text x={PAD.l - 8} y={y(v) + 3} textAnchor="end"
                    className="fill-[var(--color-ink-mute)]" style={{ fontSize: 9 }}>
                ${v.toFixed(2)}
              </text>
            </g>
          ))}
          {years.map(({ year, px }) => (
            <text key={year} x={px} y={H - 6} textAnchor="middle"
                  className="fill-[var(--color-ink-mute)]"
                  style={{ fontSize: 9, letterSpacing: ".08em" }}>
              {year}
            </text>
          ))}

          <path d={`M ${band} Z`} fill="var(--color-vermillion)" fillOpacity={0.13} />
          <path d={`M ${line}`} fill="none" stroke="var(--color-vermillion)" strokeWidth={1.5} />

          {/* one tick per observation: the sparse years should look sparse */}
          {trend.map((d, k) => (
            <line key={d.date} x1={x(d.date)} x2={x(d.date)}
                  y1={H - PAD.b + 2} y2={H - PAD.b + (k === i ? 9 : 5)}
                  stroke={k === i ? "var(--color-ink)" : "var(--color-ink-mute)"}
                  strokeWidth={k === i ? 1.4 : 0.6} strokeOpacity={k === i ? 1 : 0.55} />
          ))}

          <line x1={x(sel.date)} x2={x(sel.date)} y1={PAD.t} y2={H - PAD.b}
                stroke="var(--color-ink)" strokeWidth={1} strokeDasharray="2 2" />
          <circle cx={x(sel.date)} cy={y(sel.med)} r={4} fill="var(--color-ink)" />
        </svg>
      </div>
    </div>
  );
}
