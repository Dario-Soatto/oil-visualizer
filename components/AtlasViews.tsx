"use client";

import dynamic from "next/dynamic";
import { useState, type ReactNode } from "react";
import MapView from "./MapView";
import type { Tick } from "./Legend";

// deck.gl is ~150 KB brotli. It stays a dynamic import even though relief is now
// the default view: that keeps it off the server bundle and out of the critical
// HTML, so the page paints and the flat map is interactive while the renderer
// streams in behind the placeholder.
const Relief3D = dynamic(() => import("./Relief3D"), {
  ssr: false,
  loading: () => (
    <div
      className="border border-[var(--color-rule)] bg-[var(--color-paper-warm)] flex items-center justify-center text-[11px] tracking-wider text-[var(--color-ink-mute)]"
      style={{ height: 620 }}
    >
      loading relief&hellip;
    </div>
  ),
});

type Mode = "flat" | "relief";

export default function AtlasViews({
  viewBox,
  children,
  stateLines,
  gradient,
  ticks,
  reliefSrc,
  reliefFloor,
}: {
  viewBox: string;
  children: ReactNode;
  stateLines: ReactNode;
  gradient: string;
  ticks: Tick[];
  reliefSrc: string;
  /** price the relief's columns are measured up from */
  reliefFloor?: number;
}) {
  const [mode, setMode] = useState<Mode>("relief");

  const btn = (on: boolean) =>
    `px-3 py-1.5 text-[11px] tracking-wider border border-[var(--color-rule)] transition-colors ${
      on
        ? "bg-[var(--color-ink)] text-[var(--color-paper)]"
        : "bg-[var(--color-paper)] hover:bg-[var(--color-paper-warm)] text-[var(--color-ink-soft)]"
    }`;

  return (
    <div>
      {/* The flat map's 3,142 paths are server-rendered, so it stays mounted and
          is merely hidden -- rebuilding that subtree on every toggle is wasted
          work, and the date scrubber paints those paths whether or not they are
          the visible view. The 3D unmounts, which releases its WebGL context. */}
      <div hidden={mode !== "flat"}>
        <MapView viewBox={viewBox} stateLines={stateLines} gradient={gradient} ticks={ticks}>
          {children}
        </MapView>
      </div>

      {mode === "relief" && (
        <Relief3D src={reliefSrc} gradient={gradient} ticks={ticks} floor={reliefFloor} />
      )}

      {/* Below the map rather than above it: this switches how the thing you are
          already looking at is drawn, so it reads as a control on the map rather
          than as a heading for it. */}
      <div className="flex justify-end mt-3">
        <div className="flex gap-px" role="group" aria-label="view">
          <button
            className={btn(mode === "flat")}
            aria-pressed={mode === "flat"}
            onClick={() => setMode("flat")}
          >
            flat map
          </button>
          <button
            className={btn(mode === "relief")}
            aria-pressed={mode === "relief"}
            onClick={() => setMode("relief")}
          >
            relief
          </button>
        </div>
      </div>
    </div>
  );
}
