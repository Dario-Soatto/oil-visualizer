"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import HoverCard, { type HoverInfo } from "./HoverCard";
import Legend, { type Tick } from "./Legend";

interface Props {
  viewBox: string;
  children: ReactNode; // county paths, rendered on the server
  stateLines: ReactNode;
  gradient: string;
  ticks: Tick[];
}

const MIN_K = 1;
// Paths are rounded to 0.1 viewBox units, so past ~16x the rounding shows.
const MAX_K = 16;

export default function MapView({ viewBox, children, stateLines, gradient, ticks }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const [panning, setPanning] = useState(false);

  const clampPan = (k: number, x: number, y: number, w: number, h: number) => {
    const maxX = (k - 1) * w;
    const maxY = (k - 1) * h;
    return { x: Math.min(0, Math.max(-maxX, x)), y: Math.min(0, Math.max(-maxY, y)) };
  };

  const zoomBy = (factor: number) => {
    const el = wrap.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setView((v) => {
      const k = Math.min(MAX_K, Math.max(MIN_K, v.k * factor));
      if (k === v.k) return v;
      const cx = r.width / 2;
      const cy = r.height / 2;
      const nx = cx - ((cx - v.x) / v.k) * k;
      const ny = cy - ((cy - v.y) / v.k) * k;
      return { k, ...clampPan(k, nx, ny, r.width, r.height) };
    });
  };

  // Native listener so the wheel can be non-passive: without preventDefault the
  // page scrolls away underneath while you are trying to zoom.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      // trackpads emit huge deltas; cap so one flick cannot jump several levels
      const dy = Math.max(-120, Math.min(120, e.deltaY));
      setView((v) => {
        const k = Math.min(MAX_K, Math.max(MIN_K, v.k * Math.pow(1.0022, -dy)));
        if (k === v.k) return v;
        const nx = px - ((px - v.x) / v.k) * k;
        const ny = py - ((py - v.y) / v.k) * k;
        return { k, ...clampPan(k, nx, ny, r.width, r.height) };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (view.k <= 1) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    setPanning(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const el = wrap.current;
    if (drag.current && el) {
      const r = el.getBoundingClientRect();
      const nx = drag.current.vx + (e.clientX - drag.current.x);
      const ny = drag.current.vy + (e.clientY - drag.current.y);
      setView((v) => ({ k: v.k, ...clampPan(v.k, nx, ny, r.width, r.height) }));
      return;
    }
    const t = e.target as SVGElement;
    if (!el || !t.classList?.contains("county")) {
      setHover(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setHover({
      name: t.dataset.n ?? "",
      state: t.dataset.s ?? "",
      price: t.dataset.p != null ? Number(t.dataset.p) : null,
      note: t.dataset.note ?? null,
      x: e.clientX - r.left,
      y: e.clientY - r.top,
    });
  };

  const endDrag = (e: React.PointerEvent) => {
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    drag.current = null;
    setPanning(false);
  };

  const btn =
    "h-8 w-8 flex items-center justify-center bg-[var(--color-paper)]/95 hover:bg-[var(--color-paper)] border border-[var(--color-rule)] text-[var(--color-ink)] disabled:text-[var(--color-ink-mute)] disabled:cursor-not-allowed transition";

  return (
    <div
      ref={wrap}
      className="border border-[var(--color-rule)] bg-[var(--color-paper-warm)] relative overflow-hidden"
      style={{ cursor: view.k > 1 ? (panning ? "grabbing" : "grab") : "default" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={() => {
        setHover(null);
        drag.current = null;
        setPanning(false);
      }}
    >
      <svg
        viewBox={viewBox}
        className="w-full h-auto block select-none"
        role="img"
        aria-label="Retail gasoline price by US county"
      >
        <defs>
          <pattern
            id="hatch"
            width="4"
            height="4"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="4" height="4" fill="var(--color-paper)" />
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="4"
              stroke="var(--color-ink-mute)"
              strokeWidth="1"
            />
          </pattern>
        </defs>
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          <g id="counties">{children}</g>
          <g id="stateline">{stateLines}</g>
        </g>
      </svg>

      {/* zoom toolbar */}
      <div className="absolute top-3 left-3 flex flex-col gap-px">
        <button
          onClick={() => zoomBy(1.6)}
          disabled={view.k >= MAX_K}
          className={btn}
          aria-label="zoom in"
          title="zoom in"
        >
          <span className="text-base leading-none">+</span>
        </button>
        <button
          onClick={() => zoomBy(1 / 1.6)}
          disabled={view.k <= MIN_K}
          className={btn}
          aria-label="zoom out"
          title="zoom out"
        >
          <span className="text-base leading-none">&minus;</span>
        </button>
        <button
          onClick={() => setView({ k: 1, x: 0, y: 0 })}
          disabled={view.k === MIN_K}
          className={`${btn} text-[10px] tracking-widest`}
          aria-label="reset zoom"
          title="reset zoom"
        >
          &#10226;
        </button>
        <div className="text-[9px] tracking-wider text-[var(--color-ink-mute)] text-center mt-1">
          {view.k.toFixed(1)}&times;
        </div>
      </div>

      {hover && (
        <HoverCard
          info={hover}
          frameW={wrap.current?.clientWidth ?? 0}
          frameH={wrap.current?.clientHeight ?? 0}
        />
      )}

      <div className="pointer-events-none absolute left-3 bottom-3 text-[10px] tracking-wider text-[var(--color-ink-mute)] bg-[var(--color-paper)]/90 px-2 py-1 border border-[var(--color-rule)]">
        scroll to zoom &middot; drag to pan
      </div>

      <Legend gradient={gradient} ticks={ticks} />
    </div>
  );
}
