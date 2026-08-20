import json as _json
import os as _os
import urllib.request as _url

TOPO_URL = "https://cdn.jsdelivr.net/npm/us-atlas@3/counties-10m.json"
TOPO_PATH = "data/counties-10m.json"


def ensure_topology(path=TOPO_PATH):
    """Fetch the county topology if it is not on disk (it is gitignored)."""
    if not _os.path.exists(path) or _os.path.getsize(path) < 100_000:
        _os.makedirs(_os.path.dirname(path), exist_ok=True)
        print(f"downloading {TOPO_URL} ...")
        with _url.urlopen(TOPO_URL, timeout=120) as r, open(path, "wb") as f:
            f.write(r.read())
    return _json.load(open(path))


"""TopoJSON decoding + a hand-rolled d3-compatible Albers USA composite projection.

We route Alaska/Hawaii by state FIPS rather than by clip extent (which is how d3
does it) because we always know a county's FIPS -- it is both simpler and immune
to the Aleutian antimeridian wrap that trips up extent-based routing.
"""
import math

RADIANS = math.pi / 180


def _conic_equal_area_raw(phi0, phi1):
    sy0 = math.sin(phi0)
    n = (sy0 + math.sin(phi1)) / 2
    if abs(n) < 1e-10:                      # degenerate -> cylindrical equal area
        cos0 = math.cos(phi0)
        return lambda lam, phi: (lam * cos0, math.sin(phi) / cos0)
    c = 1 + sy0 * (2 * n - sy0)
    r0 = math.sqrt(c) / n

    def raw(lam, phi):
        inner = c - 2 * n * math.sin(phi)
        r = math.sqrt(inner if inner > 0 else 0) / n
        return (r * math.sin(lam * n), r0 - r * math.cos(lam * n))
    return raw


class Albers:
    """d3.geoAlbers()-equivalent: rotate(lambda), center(deg), parallels, scale, translate."""

    def __init__(self, rotate_lambda, center, parallels, scale, translate):
        self.rot = rotate_lambda
        self.raw = _conic_equal_area_raw(parallels[0] * RADIANS, parallels[1] * RADIANS)
        self.k = scale
        self.tx, self.ty = translate
        # d3's .center() is given in ROTATED space, so it goes straight through the
        # raw conic -- running it through _raw_point would apply the rotation twice.
        self.cx, self.cy = self.raw(center[0] * RADIANS, center[1] * RADIANS)

    def _raw_point(self, lon, lat):
        lam = lon + self.rot
        # normalise into [-180, 180] so the Aleutians do not fly off after rotation
        lam = (lam + 180) % 360 - 180
        return self.raw(lam * RADIANS, lat * RADIANS)

    def __call__(self, lon, lat):
        px, py = self._raw_point(lon, lat)
        return (self.tx + self.k * (px - self.cx),
                self.ty - self.k * (py - self.cy))


def albers_usa(scale=1070.0, translate=(480.0, 250.0)):
    """Returns (lower48, alaska, hawaii) with d3's exact composite offsets."""
    k, (x, y) = scale, translate
    return {
        "l48":    Albers(96,  (-0.6, 38.7), (29.5, 45.5), k,        (x, y)),
        "alaska": Albers(154, (-2.0, 58.5), (55.0, 65.0), k * 0.35, (x - 0.307 * k, y + 0.201 * k)),
        "hawaii": Albers(157, (-3.0, 19.9), (8.0, 18.0),  k,        (x - 0.205 * k, y + 0.212 * k)),
    }


def decode_arcs(topo):
    """Delta-decode + dequantize TopoJSON arcs into absolute lon/lat rings."""
    sx, sy = topo["transform"]["scale"]
    tx, ty = topo["transform"]["translate"]
    out = []
    for arc in topo["arcs"]:
        x = y = 0
        pts = []
        for dx, dy in arc:
            x += dx
            y += dy
            pts.append((x * sx + tx, y * sy + ty))
        out.append(pts)
    return out


def _ring_coords(arcs, idx_list):
    coords = []
    for i in idx_list:
        if i < 0:
            seg = arcs[~i][::-1]
        else:
            seg = arcs[i]
        coords.extend(seg[1:] if coords else seg)
    return coords


def geometry_to_path(geom, arcs, proj, precision=1, min_area_px=0.05):
    """Project a TopoJSON Polygon/MultiPolygon into an SVG path string."""
    if geom["type"] == "Polygon":
        polys = [geom["arcs"]]
    elif geom["type"] == "MultiPolygon":
        polys = geom["arcs"]
    else:
        return ""

    parts = []
    for poly in polys:
        for ri, ring in enumerate(poly):
            pts = [proj(lon, lat) for lon, lat in _ring_coords(arcs, ring)]
            if len(pts) < 4:
                continue
            # Drop sub-pixel slivers -- but never a polygon's outer ring (ri == 0),
            # or tiny independent cities like Falls Church vanish entirely.
            if ri > 0:
                a = 0.0
                for i in range(len(pts) - 1):
                    a += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1]
                if abs(a) / 2 < min_area_px:
                    continue
            # Tiny units (Falls Church is ~2 sq mi) collapse to a single point at
            # 0.1px rounding, so give sub-pixel rings more decimals rather than
            # dropping them off the map entirely.
            xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
            prec = precision
            if max(max(xs) - min(xs), max(ys) - min(ys)) < 3.0:
                prec = precision + 2
            d, prev = [], None
            for px, py in pts:
                c = (round(px, prec), round(py, prec))
                if c == prev:
                    continue
                d.append(("M" if not d else "L") + f"{c[0]:g},{c[1]:g}")
                prev = c
            if len(d) >= 3:
                parts.append("".join(d) + "Z")
    return "".join(parts)
