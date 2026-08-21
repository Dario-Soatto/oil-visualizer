"use client";

/**
 * The hover card, shared verbatim by the flat map and the 3D relief so both
 * views read identically. Positioned beside the cursor, flipping before it runs
 * off the right or bottom edge of its frame.
 */
export interface HoverInfo {
  name: string;
  state: string;
  price: number | null;
  note?: string | null;
  /** cursor position within the map frame */
  x: number;
  y: number;
}

export const TIP_W = 190;

export default function HoverCard({
  info,
  frameW,
  frameH,
}: {
  info: HoverInfo;
  frameW: number;
  frameH: number;
}) {
  const tipH = info.note ? 128 : 96;
  const left = info.x + TIP_W + 16 > frameW ? info.x - TIP_W - 16 : info.x + 16;
  const top = info.y + tipH + 16 > frameH ? info.y - tipH - 16 : info.y + 16;

  return (
    <div
      className="pointer-events-none absolute z-10 bg-[var(--color-paper)] border border-[var(--color-rule)] px-2.5 py-2"
      style={{ left, top, width: TIP_W }}
      role="status"
    >
      <div className="font-serif text-[15px] leading-tight text-[var(--color-ink)]">
        {info.name}
      </div>
      <div className="text-[10px] tracking-widest uppercase text-[var(--color-ink-mute)] mb-1.5">
        {info.state}
      </div>
      {info.price != null ? (
        <div className="font-serif text-[22px] leading-none tabular-nums text-[var(--color-ink)]">
          ${info.price.toFixed(2)}
        </div>
      ) : (
        <div className="text-[10px] tracking-wider text-[var(--color-ink-mute)]">
          no price reported
        </div>
      )}
      {info.note && (
        <div className="mt-1.5 text-[10px] leading-snug tracking-wider text-[var(--color-ink-mute)]">
          {info.note}
        </div>
      )}
    </div>
  );
}
