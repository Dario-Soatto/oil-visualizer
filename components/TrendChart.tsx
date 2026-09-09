import type { TrendPoint } from "@/lib/db";

const W = 900;
const H = 260;
const PAD = { t: 14, r: 14, b: 26, l: 44 };

/**
 * National price distribution over time: the p10–p90 band as a tinted area with
 * the median drawn over it. One series, so no legend box — the caption names it.
 * Server-rendered SVG, like the map: nothing to hydrate.
 */
export default function TrendChart({ data }: { data: TrendPoint[] }) {
  if (data.length < 2) return null;

  const t0 = Date.parse(data[0].date);
  const t1 = Date.parse(data[data.length - 1].date);
  const lo = Math.min(...data.map((d) => d.p10));
  const hi = Math.max(...data.map((d) => d.p90));
  // round the domain out to clean dollar marks
  const yLo = Math.floor(lo * 2) / 2;
  const yHi = Math.ceil(hi * 2) / 2;

  const x = (d: string) =>
    PAD.l + ((Date.parse(d) - t0) / (t1 - t0)) * (W - PAD.l - PAD.r);
  const y = (v: number) =>
    H - PAD.b - ((v - yLo) / (yHi - yLo)) * (H - PAD.t - PAD.b);

  const band =
    data.map((d) => `${x(d.date).toFixed(1)},${y(d.p90).toFixed(1)}`).join(" L ") +
    " L " +
    [...data].reverse().map((d) => `${x(d.date).toFixed(1)},${y(d.p10).toFixed(1)}`).join(" L ");
  const line = data.map((d) => `${x(d.date).toFixed(1)},${y(d.med).toFixed(1)}`).join(" L ");

  const ticks: number[] = [];
  for (let v = yLo; v <= yHi + 1e-9; v += 0.5) ticks.push(v);

  const years: { year: number; px: number }[] = [];
  for (let yr = new Date(t0).getUTCFullYear(); yr <= new Date(t1).getUTCFullYear(); yr++) {
    const ms = Date.UTC(yr, 0, 1);
    if (ms >= t0 && ms <= t1) years.push({ year: yr, px: x(new Date(ms).toISOString().slice(0, 10)) });
  }

  const last = data[data.length - 1];
  const lowest = data.reduce((a, b) => (a.med < b.med ? a : b));
  const peak = data.reduce((a, b) => (a.med > b.med ? a : b));

  const note = (p: TrendPoint, label: string, dy: number) => (
    <g key={label}>
      <circle cx={x(p.date)} cy={y(p.med)} r={2.5} fill="var(--color-vermillion)" />
      <text
        x={x(p.date)}
        y={y(p.med) + dy}
        textAnchor="middle"
        className="fill-[var(--color-ink-soft)]"
        style={{ fontSize: 9, letterSpacing: ".06em" }}
      >
        {label} ${p.med.toFixed(2)}
      </text>
    </g>
  );

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block" role="img"
         aria-label="National retail gasoline price distribution over time">
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
        <text key={year} x={px} y={H - 8} textAnchor="middle"
              className="fill-[var(--color-ink-mute)]"
              style={{ fontSize: 9, letterSpacing: ".08em" }}>
          {year}
        </text>
      ))}

      <path d={`M ${band} Z`} fill="var(--color-vermillion)" fillOpacity={0.13} />
      <path d={`M ${line}`} fill="none" stroke="var(--color-vermillion)" strokeWidth={1.6} />

      {note(lowest, "low", 14)}
      {note(peak, "peak", -8)}
      <circle cx={x(last.date)} cy={y(last.med)} r={3} fill="var(--color-ink)" />
      <text x={x(last.date) - 6} y={y(last.med) - 8} textAnchor="end"
            className="fill-[var(--color-ink)]" style={{ fontSize: 10, fontWeight: 600 }}>
        ${last.med.toFixed(2)}
      </text>
    </svg>
  );
}
