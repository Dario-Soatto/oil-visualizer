import type { Relief } from "./relief";

/**
 * Axonometric (2:1 dimetric) heightmap renderer.
 *
 * Every cell becomes a solid column: one lit top face plus the two side faces
 * that face the camera, drawn back-to-front by depth so nearer columns overwrite
 * the ones behind. No WebGL, no client JS — the whole scene is plain SVG
 * polygons emitted at build time.
 *
 * Grid only. Extruding the true county outlines this way would need proper
 * polygon triangulation and a depth sort over concave, interleaving shapes; the
 * deck.gl view already does that on the GPU, so this one stays on the grid.
 */
export interface IsoFace {
  pts: string;
  fill: string;
}

export interface IsoScene {
  faces: IsoFace[];
  width: number;
  height: number;
  minX: number;
  minY: number;
}

/** Aggregate the fine grid by `factor`, averaging non-empty cells. */
export function coarsen(
  values: (number | null)[],
  gw: number,
  gh: number,
  factor: number,
): { v: (number | null)[]; gw: number; gh: number } {
  const nw = Math.ceil(gw / factor);
  const nh = Math.ceil(gh / factor);
  const out: (number | null)[] = new Array(nw * nh).fill(null);
  for (let j = 0; j < nh; j++) {
    for (let i = 0; i < nw; i++) {
      let sum = 0;
      let n = 0;
      for (let dj = 0; dj < factor; dj++) {
        for (let di = 0; di < factor; di++) {
          const y = j * factor + dj;
          const x = i * factor + di;
          if (y >= gh || x >= gw) continue;
          const v = values[y * gw + x];
          if (v != null) {
            sum += v;
            n++;
          }
        }
      }
      // only keep a cell if most of it is land, else the coast frays into spikes
      if (n > (factor * factor) / 2) out[j * nw + i] = sum / n;
    }
  }
  return { v: out, gw: nw, gh: nh };
}

function shade(hex: string, k: number): string {
  const r = Math.round(parseInt(hex.slice(1, 3), 16) * k);
  const g = Math.round(parseInt(hex.slice(3, 5), 16) * k);
  const b = Math.round(parseInt(hex.slice(5, 7), 16) * k);
  return `#${[r, g, b].map((v) => Math.min(255, v).toString(16).padStart(2, "0")).join("")}`;
}

export function buildIso(
  relief: Relief,
  opts: {
    factor: number;
    tileW: number;
    exaggeration: number;
    smooth: boolean;
    colorOf: (p: number) => string;
  },
): IsoScene {
  const { factor, tileW, exaggeration, smooth, colorOf } = opts;
  const src = smooth ? relief.grid.smooth : relief.grid.raw;
  const { v, gw, gh } = coarsen(src, relief.grid.gw, relief.grid.gh, factor);

  let base = Infinity;
  for (const p of v) if (p != null && p < base) base = p;
  if (!isFinite(base)) base = 0;

  const tw = tileW / 2;
  const th = tileW / 4; // 2:1 dimetric
  const px = (gx: number, gy: number) => [(gx - gy) * tw, (gx + gy) * th];

  const faces: IsoFace[] = [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const track = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };

  // back-to-front: depth increases with (i + j), so later cells paint over earlier
  for (let d = 0; d <= gw + gh; d++) {
    for (let j = Math.max(0, d - gw + 1); j < gh; j++) {
      const i = d - j;
      if (i < 0 || i >= gw) break;
      const p = v[j * gw + i];
      if (p == null) continue;

      const h = (p - base) * exaggeration;
      const fill = colorOf(p);
      const [ax, ay] = px(i, j);
      const [bx, by] = px(i + 1, j);
      const [cx, cy] = px(i + 1, j + 1);
      const [dx, dy] = px(i, j + 1);
      const skirt = th * 2 + h; // down to the floor plane

      // right face (the i+1 edge) and left face (the j+1 edge)
      faces.push({
        pts: `${bx},${by - h} ${cx},${cy - h} ${cx},${cy + skirt - h} ${bx},${by + skirt - h}`,
        fill: shade(fill, 0.74),
      });
      faces.push({
        pts: `${dx},${dy - h} ${cx},${cy - h} ${cx},${cy + skirt - h} ${dx},${dy + skirt - h}`,
        fill: shade(fill, 0.56),
      });
      faces.push({
        pts: `${ax},${ay - h} ${bx},${by - h} ${cx},${cy - h} ${dx},${dy - h}`,
        fill,
      });
      track(ax, ay - h);
      track(cx, cy + skirt - h);
      track(bx, by - h);
      track(dx, dy - h);
    }
  }

  const pad = tileW;
  return {
    faces,
    minX: minX - pad,
    minY: minY - pad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
  };
}
