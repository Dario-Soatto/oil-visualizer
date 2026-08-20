export interface ReliefCounty {
  n: string;
  s: string;
  p: number | null;
  r: number[][][]; // simplified exterior rings, projected Albers px
}

export interface ReliefGrid {
  cell: number;
  gw: number;
  gh: number;
  raw: (number | null)[];
  smooth: (number | null)[];
  state: number[];
  states: string[];
}

export interface Relief {
  w: number;
  h: number;
  /** Canonical colour domain: one price per county, identical to the flat map's.
   *  Both 3D surfaces rank against this so a price is one colour app-wide. */
  domain: number[];
  counties: ReliefCounty[];
  grid: ReliefGrid;
}

/** Hex to the [r,g,b] deck.gl wants. */
export function rgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/**
 * Floor for the extrusion, taken across every surface the view can show.
 * Deriving it from one surface only lets another one dip below the base plane
 * and render as a column hanging under the map.
 */
export function elevationBase(r: Relief): number {
  let lo = Infinity;
  for (const p of r.grid.raw) if (p != null && p < lo) lo = p;
  for (const p of r.grid.smooth) if (p != null && p < lo) lo = p;
  for (const c of r.counties) if (c.p != null && c.p < lo) lo = c.p;
  return isFinite(lo) ? lo : 0;
}

