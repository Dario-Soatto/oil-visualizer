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

interface Hover {
  n: string;
  s: string;
  p: number;
  x: number;
  y: number;
}

const TIP_W = 190;
const TIP_H = 96;

export default function Relief3D({ src }: { src: string }) {
  const [data, setData] = useState<Relief | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [exag, setExag] = useState(45);
  const [hover, setHover] = useState<Hover | null>(null);
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
    const out: { poly: [number, number][]; p: number; n: string; s: string }[] = [];
    for (const c of data.counties) {
      if (c.p == null) continue;
      for (const ring of c.r) {
        out.push({
          // negate y so north is up in the 3D scene
          poly: ring.map(([x, y]) => [x - cx, -(y - cy)] as [number, number]),
          p: c.p,
          n: c.n,
          s: c.s,
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

  // keep the tooltip inside the frame near the right and bottom edges
  const fw = wrap.current?.clientWidth ?? 0;
  const fh = wrap.current?.clientHeight ?? 0;
  const tx = hover ? (hover.x + TIP_W + 16 > fw ? hover.x - TIP_W - 16 : hover.x + 16) : 0;
  const ty = hover ? (hover.y + TIP_H + 16 > fh ? hover.y - TIP_H - 16 : hover.y + 16) : 0;

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
              const o = info.object as { p?: number; n?: string; s?: string } | null;
              if (o && o.p != null && info.x != null && info.y != null) {
                setHover({ n: o.n ?? "", s: o.s ?? "", p: o.p, x: info.x, y: info.y });
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
          <div
            className="pointer-events-none absolute z-10 bg-[var(--color-paper)] border border-[var(--color-rule)] px-2.5 py-2"
            style={{ left: tx, top: ty, width: TIP_W }}
          >
            <div className="font-serif text-[15px] leading-tight text-[var(--color-ink)]">
              {hover.n}
            </div>
            <div className="text-[10px] tracking-widest uppercase text-[var(--color-ink-mute)] mb-1.5">
              {hover.s}
            </div>
            <div className="font-serif text-[22px] leading-none tabular-nums text-[var(--color-ink)]">
              ${hover.p.toFixed(2)}
            </div>
          </div>
        )}

        <div className="pointer-events-none absolute left-3 bottom-3 text-[10px] tracking-wider text-[var(--color-ink-mute)] bg-[var(--color-paper)]/90 px-2 py-1 border border-[var(--color-rule)]">
          drag to orbit &middot; scroll to zoom
        </div>
      </div>
    </div>
  );
}
