"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import DeckGL from "@deck.gl/react";
import {
  OrbitView,
  COORDINATE_SYSTEM,
  AmbientLight,
  DirectionalLight,
  LightingEffect,
} from "@deck.gl/core";
import { SolidPolygonLayer } from "@deck.gl/layers";
import { RAMP, rampColor, scalePosition } from "@/lib/color";
import { elevationBase, rgb, type Relief } from "@/lib/relief";
import HoverCard, { type HoverInfo } from "./HoverCard";
import Legend, { type Tick } from "./Legend";

// Matte, ambient-heavy lighting: this should read as a plaster relief model on
// paper, not a glossy WebGL demo.
const lighting = new LightingEffect({
  ambient: new AmbientLight({ color: [255, 250, 240], intensity: 0.72 }),
  sun: new DirectionalLight({
    color: [255, 248, 235],
    intensity: 1.5,
    direction: [-1.2, -2.4, -1.6],
  }),
});
const MATERIAL = {
  ambient: 0.6,
  diffuse: 0.65,
  shininess: 8,
  specularColor: [40, 36, 30] as [number, number, number],
};


export default function Relief3D({
  src,
  gradient,
  ticks,
}: {
  src: string;
  gradient: string;
  ticks: Tick[];
}) {
  const [data, setData] = useState<Relief | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [exag, setExag] = useState(45);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [ready, setReady] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => setReady(true), []);
  useEffect(() => {
    let dead = false;
    fetch(src)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} fetching ${src}`);
        return r.json();
      })
      .then((j: Relief) => !dead && setData(j))
      .catch((e) => !dead && setErr(String(e)));
    return () => {
      dead = true;
    };
  }, [src]);

  // price -> colour, ranked against the same county domain the flat map uses,
  // so the two views agree on every value
  const scale = useMemo(() => {
    if (!data) return null;
    const sorted = data.domain;
    const cache = new Map<number, [number, number, number]>();
    return (p: number): [number, number, number] => {
      const k = Math.round(p * 1000);
      let c = cache.get(k);
      if (!c) {
        c = rgb(rampColor(scalePosition(p, sorted), RAMP));
        cache.set(k, c);
      }
      return c;
    };
  }, [data]);

  const base = useMemo(() => (data ? elevationBase(data) : 0), [data]);

  const polys = useMemo(() => {
    if (!data) return [];
    const cx = data.w / 2;
    const cy = data.h / 2;
    const out: {
      poly: [number, number][];
      p: number;
      n: string;
      s: string;
      note: string | null;
    }[] = [];
    for (const c of data.counties) {
      if (c.p == null) continue;
      for (const ring of c.r) {
        out.push({
          // negate y so north is up in the 3D scene
          poly: ring.map(([x, y]) => [x - cx, -(y - cy)] as [number, number]),
          p: c.p,
          n: c.n,
          s: c.s,
          note: c.note ?? null,
        });
      }
    }
    return out;
  }, [data]);

  const layers = useMemo(() => {
    if (!data || !scale) return [];
    return [
      new SolidPolygonLayer({
        id: "counties",
        data: polys,
        extruded: true,
        material: MATERIAL,
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        pickable: true,
        autoHighlight: true,
        highlightColor: [26, 26, 26, 130] as [number, number, number, number],
        getPolygon: (d: (typeof polys)[number]) => d.poly,
        getElevation: (d: (typeof polys)[number]) => (d.p - base) * exag,
        getFillColor: (d: (typeof polys)[number]) => scale(d.p),
        updateTriggers: { getElevation: [exag, base], getFillColor: [scale] },
      }),
    ];
  }, [data, scale, polys, exag, base]);

  const label = "text-[10px] tracking-widest uppercase text-[var(--color-ink-mute)]";

  return (
    <div>
      <div className="flex flex-wrap items-end gap-x-8 gap-y-4 mb-5">
        <div className="flex flex-col gap-1.5 min-w-[220px]">
          <span className={label}>vertical exaggeration &middot; {exag}&times;</span>
          <input
            type="range"
            min={0}
            max={120}
            step={1}
            value={exag}
            onChange={(e) => setExag(+e.target.value)}
            className="w-full accent-[var(--color-vermillion)]"
          />
        </div>
      </div>

      <div
        ref={wrap}
        className="relative border border-[var(--color-rule)] bg-[var(--color-paper-warm)]"
        style={{ height: 620 }}
      >
        {ready && data ? (
          <DeckGL
            views={new OrbitView({ orbitAxis: "Z", fovy: 40 })}
            initialViewState={{
              target: [0, 0, 0],
              rotationX: 42,
              rotationOrbit: -18,
              zoom: 0.12,
              minZoom: -3,
              maxZoom: 4,
            }}
            controller={{ dragRotate: true, touchRotate: true }}
            layers={layers}
            effects={[lighting]}
            parameters={{ cullMode: "none" }}
            getCursor={() => "grab"}
            onHover={(info) => {
              const o = info.object as
                | { p?: number; n?: string; s?: string; note?: string | null }
                | null;
              if (o && o.p != null && info.x != null && info.y != null) {
                setHover({
                  name: o.n ?? "",
                  state: o.s ?? "",
                  price: o.p,
                  note: o.note ?? null,
                  x: info.x,
                  y: info.y,
                });
              } else {
                setHover(null);
              }
            }}
            style={{ position: "absolute", inset: "0" }}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] tracking-wider text-[var(--color-ink-mute)]">
            {err ? `failed: ${err}` : "loading relief…"}
          </div>
        )}

        {hover && (
          <HoverCard
            info={hover}
            frameW={wrap.current?.clientWidth ?? 0}
            frameH={wrap.current?.clientHeight ?? 0}
          />
        )}

        <div className="pointer-events-none absolute left-3 bottom-3 text-[10px] tracking-wider text-[var(--color-ink-mute)] bg-[var(--color-paper)]/90 px-2 py-1 border border-[var(--color-rule)]">
          drag to orbit &middot; scroll to zoom
        </div>

        <Legend gradient={gradient} ticks={ticks} showNoData={false} />
      </div>

      <p className="mt-5 max-w-3xl text-[13px] leading-relaxed text-[var(--color-ink-soft)]">
        Height is price. 86% of the variance in US gasoline prices sits{" "}
        <em>between</em> states rather than within them, so the real shape of this
        data is a staircase &mdash; plateaus with cliffs at the state lines &mdash;
        not rolling hills. Nothing here is interpolated: every column is one county
        at its own reported price. Note that footprint is land area, not population
        &mdash; the largest 16% of counties cover half the map, so the empty western
        ones carry more visual weight than the dense counties where most of the fuel
        is actually sold. Vertical scale is exaggerated, as on any relief model.
      </p>
    </div>
  );
}
