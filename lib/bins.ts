export type Tier = "aaa" | "dc" | "ak";

export interface County {
  f: string;            // FIPS
  d: string;            // projected SVG path
  n: string;            // county name
  s: string;            // state abbreviation
  p: number | null;     // $/gal, null when no source reports it
  t: Tier | null;
  note?: string | null; // provenance detail, shown in the tooltip
  approx?: boolean;     // geometry too small to draw; rendered as a marker
}

export interface MapData {
  w: number;
  h: number;
  counties: County[];
  states: string[];
}

export function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export const money = (n: number) => `$${n.toFixed(2)}`;
