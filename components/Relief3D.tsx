"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import DeckGL from "@deck.gl/react";
import { OrbitView, COORDINATE_SYSTEM, AmbientLight, DirectionalLight, LightingEffect } from "@deck.gl/core";
import { SolidPolygonLayer } from "@deck.gl/layers";
import { RAMP, rampColor, scalePosition } from "@/lib/color";
import { elevationBase, rgb, sortedPrices, type Relief } from "@/lib/relief";

type Surface = "grid" | "counties";

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
const MATERIAL = { ambient: 0.6, diffuse: 0.65, shininess: 8, specularColor: [40, 36, 30] as [number, number, number] };

export default function Relief3D({ src }: { src: string }) {
  const [data, setData] = useState<Relief | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [surface, setSurface] = useState<Surface>("grid");
  const [smooth, setSmooth] = useState(true);
  const [exag, setExag] = useState(45);
  const [hover, setHover] = useState<string | null>(null);
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

  // shared price -> colour scale, identical to the 2D map
  const scale = useMemo(() => {
    if (!data) return null;
    const sorted = sortedPrices(data);
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

  // grid cells as square footprints, centred so the model orbits about itself
  const cells = useMemo(() => {
    if (!data) return [];
    const { cell, gw, gh } = data.grid;
    const src2 = smooth ? data.grid.smooth : data.grid.raw;
    const cx = data.w / 2;
    const cy = data.h / 2;
    const out: { poly: [number, number][]; p: number; s: string }[] = [];
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const p = src2[j * gw + i];
        if (p == null) continue;
        const x = i * cell - cx;
        // negate y so north is up in the 3D scene
        const y = -(j * cell - cy);
        out.push({
          poly: [
            [x, y],
            [x + cell, y],
            [x + cell, y - cell],
            [x, y - cell],
          ],
          p,
          s: data.grid.states[data.grid.state[j * gw + i]] ?? "",
        });
      }
    }
    return out;
  }, [data, smooth]);

  const countyPolys = useMemo(() => {
    if (!data) return [];
    const cx = data.w / 2;
    const cy = data.h / 2;
    const out: { poly: [number, number][]; p: number; n: string; s: string }[] = [];
    for (const c of data.counties) {
      if (c.p == null) continue;
      for (const ring of c.r) {
        out.push({
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
    const common = {
      extruded: true,
      material: MATERIAL,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      pickable: true,
    };
    if (surface === "grid") {
      return [
        new SolidPolygonLayer({
          ...common,
          id: `grid-${smooth ? "s" : "r"}`,
          data: cells,
          getPolygon: (d: (typeof cells)[number]) => d.poly,
          getElevation: (d: (typeof cells)[number]) => (d.p - base) * exag,
          getFillColor: (d: (typeof cells)[number]) => scale(d.p),
          updateTriggers: { getElevation: [exag, base], getFillColor: [scale] },
        }),
      ];
    }
    return [
      new SolidPolygonLayer({
        ...common,
        id: "counties",
        data: countyPolys,
        getPolygon: (d: (typeof countyPolys)[number]) => d.poly,
        getElevation: (d: (typeof countyPolys)[number]) => (d.p - base) * exag,
        getFillColor: (d: (typeof countyPolys)[number]) => scale(d.p),
        updateTriggers: { getElevation: [exag, base], getFillColor: [scale] },
      }),
    ];
  }, [data, scale, surface, cells, countyPolys, exag, base, smooth]);

  const label = "text-[10px] tracking-widest uppercase text-[var(--color-ink-mute)]";
  const btn = (on: boolean) =>
    `px-3 py-1.5 text-[11px] tracking-wider border border-[var(--color-rule)] transition-colors ${
      on
        ? "bg-[var(--color-ink)] text-[var(--color-paper)]"
        : "bg-[var(--color-paper)] hover:bg-[var(--color-paper-warm)] text-[var(--color-ink-soft)]"
    }`;

  return (
    <div>
      <div className="flex flex-wrap items-end gap-x-8 gap-y-4 mb-5">
        <div className="flex flex-col gap-1.5">
          <span className={label}>surface</span>
          <div className="flex gap-px">
            <button className={btn(surface === "grid")} onClick={() => setSurface("grid")}>
              equal-area grid
            </button>
            <button className={btn(surface === "counties")} onClick={() => setSurface("counties")}>
              true counties
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className={label}>relief</span>
          <div className="flex gap-px">
            <button
              className={btn(smooth)}
              onClick={() => setSmooth(true)}
              disabled={surface !== "grid"}
            >
              smoothed
            </button>
            <button
              className={btn(!smooth)}
              onClick={() => setSmooth(false)}
              disabled={surface !== "grid"}
            >
              raw cells
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-1.5 min-w-[200px]">
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
              setHover(
                o && o.p != null
                  ? `${o.s ?? ""} ${o.n ?? ""} $${o.p.toFixed(2)}`.trim()
                  : null,
              );
            }}
            style={{ position: "absolute", inset: "0" }}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] tracking-wider text-[var(--color-ink-mute)]">
            {err ? `failed: ${err}` : "loading relief…"}
          </div>
        )}

        <div className="pointer-events-none absolute left-3 bottom-3 text-[10px] tracking-wider text-[var(--color-ink-soft)] bg-[var(--color-paper)]/90 px-2 py-1 border border-[var(--color-rule)] min-h-6 flex items-center">
          {hover ?? (
            <span className="text-[var(--color-ink-mute)]">
              drag to orbit &middot; scroll to zoom &middot; hover for price
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
