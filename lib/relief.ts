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

/** Sorted price list for the shared colour scale, from whichever surface is up. */
export function sortedPrices(r: Relief): number[] {
  const v: number[] = [];
  for (const p of r.grid.raw) if (p != null) v.push(p);
  return v.sort((a, b) => a - b);
}
