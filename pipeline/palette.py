"""Generate sequential + diverging ramps in OKLCH with even lightness steps."""
import math

def oklch_to_srgb(L, C, h_deg):
    h = math.radians(h_deg)
    a, b = C * math.cos(h), C * math.sin(h)
    l_, m_, s_ = L + .3963377774*a + .2158037573*b, L - .1055613458*a - .0638541728*b, L - .0894841775*a - 1.2914855480*b
    l, m, s = l_**3, m_**3, s_**3
    r =  4.0767416621*l - 3.3077115913*m + 0.2309699292*s
    g = -1.2684380046*l + 2.6097574011*m - 0.3413193965*s
    bb=-0.0041960863*l - 0.7034186147*m + 1.7076147010*s
    def enc(x):
        x = max(0.0, min(1.0, 1.055*(x**(1/2.4))-0.055 if x > 0.0031308 else 12.92*x))
        return round(x*255)
    return enc(r), enc(g), enc(bb)

def in_gamut(L, C, h):
    h_r = math.radians(h); a, b = C*math.cos(h_r), C*math.sin(h_r)
    l_, m_, s_ = L+.3963377774*a+.2158037573*b, L-.1055613458*a-.0638541728*b, L-.0894841775*a-1.2914855480*b
    l, m, s = l_**3, m_**3, s_**3
    r =  4.0767416621*l-3.3077115913*m+0.2309699292*s
    g = -1.2684380046*l+2.6097574011*m-0.3413193965*s
    bb=-0.0041960863*l-0.7034186147*m+1.7076147010*s
    return all(-0.001 <= v <= 1.001 for v in (r, g, bb))

def clamp_chroma(L, C, h):
    lo, hi = 0.0, C
    for _ in range(30):
        mid = (lo+hi)/2
        if in_gamut(L, mid, h): lo = mid
        else: hi = mid
    return lo

def hexs(L, C, h):
    C = clamp_chroma(L, C, h)
    return "#%02X%02X%02X" % oklch_to_srgb(L, C, h)

def ramp(n, L0, L1, hue, cmax):
    out = []
    for i in range(n):
        t = i/(n-1)
        L = L0 + (L1-L0)*t
        C = cmax * math.sin(math.pi * (0.25 + 0.6*t))   # chroma peaks past the middle
        out.append(hexs(L, C, hue))
    return out

if __name__ == "__main__":
    seq = ramp(7, 0.95, 0.36, 62, 0.165)
    print("SEQ", ",".join(seq))
    cool = ramp(4, 0.90, 0.46, 205, 0.13)[::-1]
    warm = ramp(4, 0.90, 0.42, 40,  0.17)
    div  = cool[:-1] + ["#E7E4DC"] + warm[1:]
    print("DIV", ",".join(div))
