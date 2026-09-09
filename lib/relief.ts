export interface ReliefCounty {
  f: string;
  n: string;
  s: string;
  p: number | null;
  note?: string | null;
  r: number[][][]; // simplified exterior rings, projected Albers px
}

export interface Relief {
  w: number;
  h: number;
  /** Canonical colour domain: one price per county, identical to the flat map's,
   *  so a price is the same colour in both views. */
  domain: number[];
  counties: ReliefCounty[];
}

/** Hex to the [r,g,b] deck.gl wants. */
export function rgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/** Floor for the extrusion, so nothing renders below the base plane. */
export function elevationBase(r: Relief): number {
  let lo = Infinity;
  for (const c of r.counties) if (c.p != null && c.p < lo) lo = c.p;
  return isFinite(lo) ? lo : 0;
}
