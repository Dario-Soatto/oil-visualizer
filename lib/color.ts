/**
 * Continuous colour ramp.
 *
 * Pale sand through ochre, brick and plum to a deep aubergine: a wide sweep
 * — ~145 degrees of hue over a 0.59 lightness span, so counties a little apart
 * in price are a little apart in hue as well as tone — but held to low chroma
 * so every stop reads as printed earth pigment against the paper ground rather
 * than as screen colour. The palest step sits a shade off --color-paper itself.
 *
 * Anchors are validated for adjacent-pair CVD separation (protan dE 12.4,
 * normal-vision dE 16.6) and interpolate in OKLab, so intermediate colours stay
 * perceptually even instead of going muddy through sRGB. Lightness is monotonic
 * across the whole ramp, which is what keeps the ordering readable under
 * colour-vision deficiency even where hue does not survive.
 */
export const RAMP = [
  "#F7ECD1", "#F3AD6D", "#D96B5F", "#9D3C6D", "#4B276A",
];

type Lab = [number, number, number];

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function linearToSrgb(c: number): number {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, Math.round(v * 255)));
}

export function hexToOklab(hex: string): Lab {
  const r = srgbToLinear(parseInt(hex.slice(1, 3), 16) / 255);
  const g = srgbToLinear(parseInt(hex.slice(3, 5), 16) / 255);
  const b = srgbToLinear(parseInt(hex.slice(5, 7), 16) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabToHex([L, a, bb]: Lab): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * bb) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * bb) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * bb) ** 3;
  const r = linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const g = linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const b = linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** Sample the ramp at t in [0,1], interpolating between anchors in OKLab. */
export function rampColor(t: number, ramp: string[]): string {
  const labs = ramp.map(hexToOklab);
  const x = Math.min(1, Math.max(0, t)) * (labs.length - 1);
  const i = Math.min(labs.length - 2, Math.floor(x));
  const f = x - i;
  const A = labs[i];
  const B = labs[i + 1];
  return oklabToHex([
    A[0] + (B[0] - A[0]) * f,
    A[1] + (B[1] - A[1]) * f,
    A[2] + (B[2] - A[2]) * f,
  ]);
}

/**
 * How much of the scale is rank versus raw dollars.
 *
 * Pure rank spreads the bulk perfectly evenly but squashes the tail: $5.47,
 * $6.82 and $8.48 all land within two points of the top and come out the same
 * colour. Pure dollars does the opposite — the middle 80% of counties would sit
 * inside 15% of the ramp and the map would read flat. At 0.75 the middle 80%
 * still gets 64% of the ramp while the top outliers separate by roughly eight
 * points each, which on this wide a sweep is a visibly different colour.
 */
export const RANK_WEIGHT = 0.75;

/** Rank of `p` within `sorted`, in [0,1]. Ties resolve to one shared value. */
export function rankPosition(p: number, sorted: number[]): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < p) lo = mid + 1;
    else hi = mid;
  }
  const first = lo;
  hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= p) lo = mid + 1;
    else hi = mid;
  }
  // midpoint of the tied run, so identical prices resolve to one colour
  const rank = (first + lo - 1) / 2;
  return sorted.length < 2 ? 0 : rank / (sorted.length - 1);
}

/**
 * Ramp position for a price: rank blended with the raw dollar position.
 *
 * Stays a strict function of price — both terms are monotonic, so equal prices
 * get equal colour and a dearer county is always further along the ramp.
 */
export function scalePosition(p: number, sorted: number[]): number {
  const lo = sorted[0];
  const hi = sorted[sorted.length - 1];
  const linear = hi > lo ? (p - lo) / (hi - lo) : 0;
  return RANK_WEIGHT * rankPosition(p, sorted) + (1 - RANK_WEIGHT) * linear;
}

/** Price landing at ramp position `t`. Numeric inverse of scalePosition, for
 *  legend ticks — the blend has no closed form. */
export function valueAtPosition(t: number, sorted: number[]): number {
  let lo = sorted[0];
  let hi = sorted[sorted.length - 1];
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (scalePosition(mid, sorted) < t) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** CSS gradient matching the ramp, sampled densely enough to read as smooth. */
export function gradientCss(ramp: string[], stops = 24): string {
  const parts: string[] = [];
  for (let i = 0; i < stops; i++) {
    const t = i / (stops - 1);
    parts.push(`${rampColor(t, ramp)} ${(t * 100).toFixed(1)}%`);
  }
  return `linear-gradient(90deg, ${parts.join(", ")})`;
}
