import Link from "next/link";
import Relief3D from "@/components/Relief3D";

export const metadata = {
  title: "Pump Price Atlas — relief",
  description: "US county gasoline prices as an extruded relief model.",
};

export default function ReliefPage() {
  return (
    <div className="mx-auto max-w-6xl px-8">
      <section className="flex flex-wrap items-end justify-between gap-8 py-14">
        <h1 className="font-serif text-5xl leading-[1.05] tracking-tight">
          The same gallon, as{" "}
          <span className="font-serif italic text-[var(--color-vermillion)]">terrain</span>
        </h1>
        <Link
          href="/"
          className="text-[10px] tracking-widest uppercase text-[var(--color-ink-mute)] hover:text-[var(--color-ink)]"
        >
          &larr; back to the flat map
        </Link>
      </section>

      <section className="pb-12 border-t border-[var(--color-rule)] pt-8">
        <Relief3D src="/relief.json" />
        <p className="mt-5 max-w-3xl text-[13px] leading-relaxed text-[var(--color-ink-soft)]">
          Height is price. 86% of the variance in US gasoline prices sits{" "}
          <em>between</em> states rather than within them, so the real shape of this
          data is a staircase &mdash; plateaus with cliffs at the state lines &mdash;
          not rolling hills. Nothing here is interpolated: every column is one
          county at its own reported price. Note that footprint is land area, not
          population &mdash; the largest 16% of counties cover half the map, so the
          empty western ones carry more visual weight than the dense counties where
          most of the fuel is actually sold. Vertical scale is exaggerated, as on any
          relief model.
        </p>
      </section>
    </div>
  );
}
