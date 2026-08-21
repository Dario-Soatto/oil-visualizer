export interface Tick {
  t: number;
  label: string;
}

/**
 * The colour key, shared by both views since they rank against the same domain.
 * `showNoData` is off for the 3D, where an unpriced county has no height and so
 * is never drawn.
 */
export default function Legend({
  gradient,
  ticks,
  showNoData = true,
}: {
  gradient: string;
  ticks: Tick[];
  showNoData?: boolean;
}) {
  return (
    <div className="pointer-events-none absolute right-3 bottom-3 bg-[var(--color-paper)]/90 px-2 py-1.5 border border-[var(--color-rule)]">
      <div className="flex items-center gap-3">
        <div>
          <span
            className="block h-3 w-[210px] border border-[var(--color-rule)]"
            style={{ backgroundImage: gradient }}
          />
          <span className="relative block h-3 w-[210px] mt-0.5 text-[9px] tracking-wider text-[var(--color-ink-mute)] tabular-nums">
            {ticks.map((tk, i) => (
              <span
                key={tk.t}
                className="absolute whitespace-nowrap"
                style={{
                  left: `${tk.t * 100}%`,
                  transform:
                    i === 0
                      ? "none"
                      : i === ticks.length - 1
                        ? "translateX(-100%)"
                        : "translateX(-50%)",
                }}
              >
                {tk.label}
              </span>
            ))}
          </span>
        </div>
        {showNoData && (
          <div className="flex items-center gap-1.5 text-[9px] tracking-wider text-[var(--color-ink-mute)] self-start">
            <span
              className="block h-3 w-3 border border-[var(--color-rule)]"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(45deg, var(--color-paper) 0 2px, var(--color-ink-mute) 2px 3px)",
              }}
            />
            <span>n/a</span>
          </div>
        )}
      </div>
    </div>
  );
}
