"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
import { getMapDate, getMapDateServer, SOURCE_NOTE, subscribeMapDate } from "@/lib/mapDate";
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
// Height per dollar, in the same projected pixels the map is drawn in. There is
// no meaningful 1:1 here -- the vertical axis is dollars and the horizontal is
// map distance -- so this is chosen for legibility, not fidelity: 50 is where
// the state plateaus and the border cliffs both read without the tall western
// columns swallowing the frame.
const PX_PER_DOLLAR = 50;

const MATERIAL = {
  ambient: 0.6,
  diffuse: 0.65,
  shininess: 8,
  specularColor: [40, 36, 30] as [number, number, number],
};

// Camera framing. The scene lives in the map's own projected pixels and
// OrbitView's zoom is absolute -- 2^zoom screen pixels per world unit -- so a
// single hardcoded zoom only frames one window size. Fit to the frame instead.
const TILT = 50;          // degrees; enough relief to read as terrain, flat
                          // enough that the coastline still reads as a coastline
const SPIN = -18;         // degrees about Z
// Fractions of the frame the scene should occupy. They differ, and the reason
// is perspective: the camera is a 40-degree frustum, not an orthographic one,
// so the near edge of the tilted plane is magnified. Measured against the
// rendered canvas, the vertical estimate below lands within a pixel while the
// horizontal one comes out about 8% narrow, so the width allowance is pulled in
// to match. Both were read off real renders rather than reasoned about.
const FILL_W = 0.80;
const FILL_H = 0.88;

const rad = (d: number) => (d * Math.PI) / 180;

/**
 * Zoom that fits the scene, on both axes.
 *
 * Fitting width alone is not enough and the difference is not small: the
 * columns are extruded, so what the camera has to contain is the footprint
 * tilted back plus the terrain standing up out of it. On a wide window height
 * is what binds -- at a 1088x620 frame width alone suggests -0.25 while the
 * scene needs about -0.8 -- and a narrow frame hides this entirely, because
 * there width binds and the two agree.
 *
 * `footW`/`footD` come from the geometry's own bounding box rather than the
 * map's 975x610 page box. Albers USA insets Alaska and Hawaii at the lower
 * left, so the drawn content neither fills that box nor centres in it.
 */
function zoomToFit(
  frameW: number,
  frameH: number,
  footW: number,
  footD: number,
  columnPx: number,
) {
  const spun = Math.abs(SPIN);
  const across = footW * Math.cos(rad(spun)) + footD * Math.sin(rad(spun));
  const deep = footW * Math.sin(rad(spun)) + footD * Math.cos(rad(spun));
  const vertical = deep * Math.sin(rad(TILT)) + columnPx * Math.cos(rad(TILT));
  return Math.min(
    Math.log2((frameW * FILL_W) / across),
    Math.log2((frameH * FILL_H) / vertical),
  );
}


export default function Relief3D({
  src,
  gradient,
  ticks,
  floor,
}: {
  src: string;
  gradient: string;
  ticks: Tick[];
  /** The price every column is measured up from, fixed across dates. Passed in
   *  rather than discovered from the scrubber's first publish so the camera can
   *  be fitted to the real column height at mount, and so the terrain does not
   *  visibly jump when the scrubber arrives a moment later. */
  floor?: number;
}) {
  const [data, setData] = useState<Relief | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [ready, setReady] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  // the date the scrubber has selected, if any
  const md = useSyncExternalStore(subscribeMapDate, getMapDate, getMapDateServer);

  // Measured before the canvas mounts, so the fitted zoom is the one deck.gl
  // takes as its initial state. Deliberately not tracked after that: refitting
  // on resize would yank the camera out from under anyone who had moved it.
  const [frame, setFrame] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    setReady(true);
    if (wrap.current) {
      setFrame({ w: wrap.current.clientWidth, h: wrap.current.clientHeight });
    }
  }, []);
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
    const sorted = md ? md.domain : data.domain;
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
  }, [data, md]);

  // Height is measured from a baseline fixed across dates, so scrubbing makes
  // the terrain rise rather than just recolour. Falls back to the snapshot's own
  // floor before the scrubber has published anything.
  const base = useMemo(
    () => floor ?? (md ? md.base : data ? elevationBase(data) : 0),
    [floor, md, data],
  );

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
      date: string | null;
    }[] = [];
    for (const c of data.counties) {
      // scrubbed prices are keyed by FIPS, which relief.json carries too
      const dated = md ? md.byFips.get(c.f) : undefined;
      const price = md ? dated?.p : c.p;
      if (price == null) continue;
      for (const ring of c.r) {
        out.push({
          // negate y so north is up in the 3D scene
          poly: ring.map(([x, y]) => [x - cx, -(y - cy)] as [number, number]),
          p: price,
          n: c.n,
          s: c.s,
          note: md
            ? dated?.note ?? (dated?.s ? SOURCE_NOTE[dated.s] ?? null : null)
            : c.note ?? null,
          date: md ? md.date : null,
        });
      }
    }
    return out;
  }, [data, md]);

  // How far the terrain stands above the baseline, in the same projected pixels
  // the footprint is measured in -- the term the vertical fit turns on.
  //
  // Deliberately a high percentile rather than the maximum. A handful of Alaskan
  // boroughs run to nearly $10 against a mainland that is mostly under $5, and
  // fitting to those spikes pushes the camera so far back that the country ends
  // up small in a frame of empty paper. They also sit low and to the left, where
  // the frame has room to spare, so their tips overshooting costs nothing while
  // the mainland -- the part being read -- fills the frame.
  // Bounding box of the geometry actually drawn, in the same coordinates polys
  // are built in. Used to centre and size the camera: the map's page box is
  // 975x610, but Albers USA insets Alaska and Hawaii at the lower left, so the
  // content neither fills that box nor sits in the middle of it. Aiming at the
  // box centre left the country pushed to one side with a band of empty paper
  // opposite -- 110px of margin on the left against 354px on the right.
  const bounds = useMemo(() => {
    if (!data) return null;
    const cx = data.w / 2;
    const cy = data.h / 2;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const c of data.counties) {
      for (const ring of c.r) {
        for (const [x, y] of ring) {
          const px = x - cx;
          const py = -(y - cy);
          if (px < x0) x0 = px;
          if (px > x1) x1 = px;
          if (py < y0) y0 = py;
          if (py > y1) y1 = py;
        }
      }
    }
    if (!isFinite(x0)) return null;
    return { mx: (x0 + x1) / 2, my: (y0 + y1) / 2, w: x1 - x0, d: y1 - y0 };
  }, [data]);

  const terrainHeight = useMemo(() => {
    if (!data) return 0;
    const prices = data.counties
      .map((c) => c.p)
      .filter((p): p is number => p != null)
      .sort((a, b) => a - b);
    if (!prices.length) return 0;
    const p98 = prices[Math.floor((prices.length - 1) * 0.98)];
    return Math.max(0, p98 - base) * PX_PER_DOLLAR;
  }, [data, base]);

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
        getElevation: (d: (typeof polys)[number]) => (d.p - base) * PX_PER_DOLLAR,
        getFillColor: (d: (typeof polys)[number]) => scale(d.p),
        updateTriggers: { getElevation: [base], getFillColor: [scale] },
      }),
    ];
  }, [data, scale, polys, base]);

  return (
    <div>
      <div
        ref={wrap}
        className="relative border border-[var(--color-rule)] bg-[var(--color-paper-warm)]"
        style={{ height: 620 }}
      >
        {ready && data && frame && bounds ? (
          <DeckGL
            views={new OrbitView({ orbitAxis: "Z", fovy: 40 })}
            initialViewState={{
              // Aimed at the middle of the terrain's height, not at the map
              // plane. Columns only ever rise, so aiming at the plane puts the
              // mass above the centre of the frame: it crowds the top edge while
              // leaving a band of empty paper along the bottom.
              target: [bounds.mx, bounds.my, 0],
              rotationX: TILT,
              rotationOrbit: SPIN,
              zoom: zoomToFit(frame.w, frame.h, bounds.w, bounds.d, terrainHeight),
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
                | { p?: number; n?: string; s?: string; note?: string | null; date?: string | null }
                | null;
              if (o && o.p != null && info.x != null && info.y != null) {
                setHover({
                  name: o.n ?? "",
                  state: o.s ?? "",
                  price: o.p,
                  note: o.note ?? null,
                  date: o.date ?? null,
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
    </div>
  );
}
