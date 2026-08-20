import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import { buildIso } from "@/lib/iso";
import { RAMP, rampColor, scalePosition } from "@/lib/color";
import { sortedPrices, type Relief } from "@/lib/relief";

export const metadata = {
  title: "Pump Price Atlas — axonometric",
  description: "US county gasoline prices as an axonometric relief, in static SVG.",
};

const EXAG = 34;
const TILE = 15;
const FACTOR = 2;

export default function IsoPage() {
  const relief = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "public", "relief.json"), "utf8"),
  ) as Relief;

  const sorted = sortedPrices(relief);
  const cache = new Map<number, string>();
  const colorOf = (p: number) => {
    const k = Math.round(p * 500);
    let c = cache.get(k);
    if (!c) {
      c = rampColor(scalePosition(p, sorted), RAMP);
      cache.set(k, c);
    }
    return c;
  };

  const scene = buildIso(relief, {
    factor: FACTOR,
    tileW: TILE,
    exaggeration: EXAG,
    smooth: true,
    colorOf,
  });

  return (
    <div className="mx-auto max-w-6xl px-8">
      <section className="flex flex-wrap items-end justify-between gap-8 py-14">
        <h1 className="font-serif text-5xl leading-[1.05] tracking-tight">
          The same gallon, as an{" "}
          <span className="font-serif italic text-[var(--color-vermillion)]">engraving</span>
        </h1>
        <div className="flex flex-col items-end gap-1">
          <Link
            href="/relief"
            className="text-[10px] tracking-widest uppercase text-[var(--color-ink-mute)] hover:text-[var(--color-ink)]"
          >
            the orbiting version &rarr;
          </Link>
          <Link
            href="/"
            className="text-[10px] tracking-widest uppercase text-[var(--color-ink-mute)] hover:text-[var(--color-ink)]"
          >
            &larr; back to the flat map
          </Link>
        </div>
      </section>

      <section className="pb-12 border-t border-[var(--color-rule)] pt-8">
        <div className="flex items-baseline justify-between mb-5 gap-4 flex-wrap">
          <span className="text-[10px] tracking-widest uppercase text-[var(--color-ink-mute)]">
            {scene.faces.length.toLocaleString()} faces &middot; static svg &middot; no client js
          </span>
          <span className="text-[10px] tracking-wider text-[var(--color-ink-mute)]">
            {EXAG}&times; vertical exaggeration
          </span>
        </div>
        <div className="border border-[var(--color-rule)] bg-[var(--color-paper-warm)] overflow-x-auto">
          <svg
            viewBox={`${scene.minX} ${scene.minY} ${scene.width} ${scene.height}`}
            className="w-full h-auto block"
            role="img"
            aria-label="Axonometric relief of US county gasoline prices"
            shapeRendering="crispEdges"
          >
            {scene.faces.map((f, i) => (
              <polygon key={i} points={f.pts} fill={f.fill} />
            ))}
          </svg>
        </div>
        <p className="mt-5 max-w-3xl text-[13px] leading-relaxed text-[var(--color-ink-soft)]">
          Same height-is-price surface as the orbiting version, projected 2:1 dimetric
          and painted back-to-front, then shipped as flat SVG polygons &mdash; no WebGL,
          no hydration, nothing to load. The trade is the camera: this one is fixed at
          build time. Grid only, because extruding true county outlines this way would
          need real polygon triangulation and a depth sort over interleaving concave
          shapes, which is exactly what the GPU is for.
        </p>
      </section>
    </div>
  );
}
