#!/usr/bin/env python3
"""Generate the COMBINED measured->projected cost+context figure.

One continuous task axis with a PIECEWISE scale: the MEASURED region
(<=24 tasks, the N=1 head-to-head ladder) gets ~40% of the panel width so the
actual-eval detail is legible, then a cutoff divider at task 24 marks where
measurement ends and PROJECTION begins (dashed, extrapolated to ~task 180 where
SP's in-session coordinator approaches the 1M window ceiling). Before-and-after
in a single frame.

Pure-stdlib SVG (matplotlib unavailable in the sandbox). Model + anchors are
documented in docs/benchmarks/cost-and-context-ladder-2026-06-14.md.

  A(n) = 1.018 n + 0.00655 n^2     # SP: linear build + opus-coordinator cache-read tax (~n^2)
  B(n) = 1.061 n + 0.000867 n^2    # UP: linear build + bounded-window cache-read (~linear)
  A_window(n) = 52 + 5.0 n   (K)   # SP coordinator peak window
  B_window(n) = 39 + 0.83 n  (K)   # UP coordinator peak window (bounded)

All values >24 tasks are EXTRAPOLATION from an N=1 ladder, not measurement.
"""

# ---- model -------------------------------------------------------------------
def A(n):  return 1.018 * n + 0.00655 * n * n          # SP cost, central
def B(n):  return 1.061 * n + 0.000867 * n * n         # UP cost, central
def A_lo(n): return 1.018 * n + 0.003275 * n * n       # SP cost, low band (half tax)
def A_hi(n): return 1.018 * n + 0.0098 * n * n         # SP cost, high band (1.5x tax)
def B_lo(n): return 1.061 * n + 0.00040 * n * n
def B_hi(n): return 1.061 * n + 0.00130 * n * n
def Awin(n): return 52 + 5.0 * n                       # K
def Bwin(n): return 39 + 0.83 * n                      # K

# measured anchors (N=1 ladder)
M_A   = [(6, 6.742), (12, 11.761), (24, 28.192)]
M_B   = [(6, 6.356), (12, 11.853), (24, 25.949)]
M_Aw  = [(6, 82), (12, 107), (24, 172)]
M_Bw  = [(6, 43), (12, 51), (24, 59)]

NCUT = 24                     # measured/projected cutoff (end of the real eval)
NMAX = 180
FRAC = 0.40                   # measured region (0..NCUT) gets this share of panel width
RED, BLUE, GREY = "#d1495b", "#2e6fdb", "#999"

# ---- panel geometry ----------------------------------------------------------
# left = cost ($0..$420), right = window (0..1000K). x = tasks 0..180 (piecewise).
LX0, LX1 = 70, 440
RX0, RX1 = 590, 960
PY0, PY1 = 110, 400          # top (max), bottom (0)
COST_MAX, WIN_MAX = 420, 1000

def _piece(x0, x1, n):
    if n <= NCUT:
        return x0 + (x1 - x0) * FRAC * (n / NCUT)
    return x0 + (x1 - x0) * (FRAC + (1 - FRAC) * (n - NCUT) / (NMAX - NCUT))
def lx(n):  return _piece(LX0, LX1, n)
def rx(n):  return _piece(RX0, RX1, n)
def yc(c):  return PY1 - (PY1 - PY0) * c / COST_MAX
def yw(w):  return PY1 - (PY1 - PY0) * w / WIN_MAX

def path(fn, xfn, yfn, n0, n1, step=3):
    pts = []
    k = n0
    while k <= n1 + 1e-9:
        pts.append(f"{xfn(k):.1f},{yfn(fn(k)):.1f}")
        k += step
    return " ".join(pts)

s = []
def add(x): s.append(x)

def cutoff(x0, x1, xfn):
    """Measured-region tint + the task-24 cutoff divider, drawn under the curves."""
    xc = xfn(NCUT)
    add(f'<rect x="{x0}" y="{PY0:.1f}" width="{xc-x0:.1f}" height="{PY1-PY0}" fill="{BLUE}" fill-opacity="0.04"/>')
    add(f'<line x1="{xc:.1f}" y1="{PY0-4:.1f}" x2="{xc:.1f}" y2="{PY1}" stroke="#555" stroke-width="1.2" stroke-dasharray="3,3"/>')
    add(f'<text x="{xc-6:.1f}" y="{PY0-6:.1f}" text-anchor="end" fill="#555" font-size="10">&#9664; measured (N=1)</text>')
    add(f'<text x="{xc+6:.1f}" y="{PY0-6:.1f}" text-anchor="start" fill="#555" font-size="10">projected &#9654;</text>')

add('<svg xmlns="http://www.w3.org/2000/svg" width="1040" height="470" '
    'font-family="-apple-system,Segoe UI,Roboto,sans-serif" font-size="13">')
add('<rect width="1040" height="470" fill="#ffffff"/>')
add('<text x="24" y="28" font-size="17" font-weight="700" fill="#111">'
    'Measured head-to-head &#8594; projected to a 1M coordinator window</text>')
add('<text x="24" y="46" font-size="12" fill="#666">'
    'solid = measured (&#8804;24 tasks, N=1 ladder) &#183; dashed = PROJECTED extrapolation past the task-24 cutoff</text>')

# ---- LEFT: cost --------------------------------------------------------------
add('<text x="24" y="74" font-size="15" font-weight="700" fill="#111">Total cost &#8212; on par early, gap opens at scale</text>')
add('<text x="24" y="92" font-size="12" fill="#666">billed total_cost_usd &#183; band = N=1 uncertainty</text>')
cutoff(LX0, LX1, lx)
for c in range(0, COST_MAX + 1, 100):
    y = yc(c)
    add(f'<line x1="{LX0}" y1="{y:.1f}" x2="{LX1}" y2="{y:.1f}" stroke="#eee"/>')
    add(f'<text x="{LX0-8}" y="{y+4:.1f}" text-anchor="end" fill="{GREY}" font-size="11">${c}</text>')
for n in (6, 12, 24, 48, 96, 144, 180):
    x = lx(n)
    bold = ' font-weight="700"' if n == NCUT else ''
    add(f'<line x1="{x:.1f}" y1="{PY1}" x2="{x:.1f}" y2="{PY1+4}" stroke="{GREY}"/>')
    add(f'<text x="{x:.1f}" y="{PY1+20}" text-anchor="middle" fill="{GREY}" font-size="11"{bold}>{n}</text>')
add(f'<text x="255" y="438" text-anchor="middle" fill="#666" font-size="12">tasks (axis compresses after 24)</text>')

# uncertainty bands (projected region only, 24->180)
sp_band = path(A_hi, lx, yc, 24, NMAX) + " " + \
          " ".join(f"{lx(k):.1f},{yc(A_lo(k)):.1f}" for k in range(NMAX, 23, -3))
add(f'<polygon points="{sp_band}" fill="{RED}" fill-opacity="0.10" stroke="none"/>')
up_band = path(B_hi, lx, yc, 24, NMAX) + " " + \
          " ".join(f"{lx(k):.1f},{yc(B_lo(k)):.1f}" for k in range(NMAX, 23, -3))
add(f'<polygon points="{up_band}" fill="{BLUE}" fill-opacity="0.10" stroke="none"/>')

# projected dashed central curves (24->180)
add(f'<polyline points="{path(A, lx, yc, 24, NMAX)}" fill="none" stroke="{RED}" stroke-width="2.5" stroke-dasharray="7,5"/>')
add(f'<polyline points="{path(B, lx, yc, 24, NMAX)}" fill="none" stroke="{BLUE}" stroke-width="2.5" stroke-dasharray="7,5"/>')

# measured solid (6->24)
add(f'<polyline points="{" ".join(f"{lx(n):.1f},{yc(c):.1f}" for n,c in M_A)}" fill="none" stroke="{RED}" stroke-width="2.8"/>')
add(f'<polyline points="{" ".join(f"{lx(n):.1f},{yc(c):.1f}" for n,c in M_B)}" fill="none" stroke="{BLUE}" stroke-width="2.8"/>')
for n,c in M_A: add(f'<circle cx="{lx(n):.1f}" cy="{yc(c):.1f}" r="3.6" fill="{RED}"/>')
for n,c in M_B: add(f'<circle cx="{lx(n):.1f}" cy="{yc(c):.1f}" r="3.6" fill="{BLUE}"/>')

# endpoint labels
add(f'<text x="{lx(180)-4:.1f}" y="{yc(A(180))-6:.1f}" text-anchor="end" fill="{RED}" font-size="12" font-weight="700">SP ~${A(180):.0f}</text>')
add(f'<text x="{lx(180)-4:.1f}" y="{yc(B(180))+16:.1f}" text-anchor="end" fill="{BLUE}" font-size="12" font-weight="700">UP ~${B(180):.0f}</text>')
add(f'<text x="{lx(24)+8:.1f}" y="{yc(360):.1f}" fill="#444" font-size="12">@~task 180: ~1.8&#215; &#183; ~$175 gap</text>')

# ---- RIGHT: window -----------------------------------------------------------
add('<text x="544" y="74" font-size="15" font-weight="700" fill="#111">Coordinator window &#8212; SP nears 1M; UP bounded</text>')
add('<text x="544" y="92" font-size="12" fill="#666">peak per-turn window &#183; opus 4.8 ceiling = 1M</text>')
cutoff(RX0, RX1, rx)
for w in range(0, WIN_MAX + 1, 200):
    y = yw(w)
    add(f'<line x1="{RX0}" y1="{y:.1f}" x2="{RX1}" y2="{y:.1f}" stroke="#eee"/>')
    add(f'<text x="{RX0-8}" y="{y+4:.1f}" text-anchor="end" fill="{GREY}" font-size="11">{w}K</text>')
for n in (6, 12, 24, 48, 96, 144, 180):
    x = rx(n)
    bold = ' font-weight="700"' if n == NCUT else ''
    add(f'<line x1="{x:.1f}" y1="{PY1}" x2="{x:.1f}" y2="{PY1+4}" stroke="{GREY}"/>')
    add(f'<text x="{x:.1f}" y="{PY1+20}" text-anchor="middle" fill="{GREY}" font-size="11"{bold}>{n}</text>')
add(f'<text x="775" y="438" text-anchor="middle" fill="#666" font-size="12">tasks (axis compresses after 24)</text>')

# 1M ceiling line
add(f'<line x1="{RX0}" y1="{yw(1000):.1f}" x2="{RX1}" y2="{yw(1000):.1f}" stroke="#b00" stroke-width="1.3" stroke-dasharray="4,4"/>')
add(f'<text x="{RX1:.1f}" y="{yw(1000)-6:.1f}" text-anchor="end" fill="#b00" font-size="11" font-weight="700">1M ceiling</text>')

# projected dashed windows
add(f'<polyline points="{path(Awin, rx, yw, 24, NMAX)}" fill="none" stroke="{RED}" stroke-width="2.5" stroke-dasharray="7,5"/>')
add(f'<polyline points="{path(Bwin, rx, yw, 24, NMAX)}" fill="none" stroke="{BLUE}" stroke-width="2.5" stroke-dasharray="7,5"/>')
# measured solid windows
add(f'<polyline points="{" ".join(f"{rx(n):.1f},{yw(w):.1f}" for n,w in M_Aw)}" fill="none" stroke="{RED}" stroke-width="2.8"/>')
add(f'<polyline points="{" ".join(f"{rx(n):.1f},{yw(w):.1f}" for n,w in M_Bw)}" fill="none" stroke="{BLUE}" stroke-width="2.8"/>')
for n,w in M_Aw: add(f'<circle cx="{rx(n):.1f}" cy="{yw(w):.1f}" r="3.6" fill="{RED}"/>')
for n,w in M_Bw: add(f'<circle cx="{rx(n):.1f}" cy="{yw(w):.1f}" r="3.6" fill="{BLUE}"/>')
add(f'<text x="{rx(180)-4:.1f}" y="{yw(Awin(180))-6:.1f}" text-anchor="end" fill="{RED}" font-size="12" font-weight="700">SP ~{Awin(180):.0f}K</text>')
add(f'<text x="{rx(180)-4:.1f}" y="{yw(Bwin(180))+16:.1f}" text-anchor="end" fill="{BLUE}" font-size="12" font-weight="700">UP ~{Bwin(180):.0f}K (bounded)</text>')

# ---- legend / disclosure -----------------------------------------------------
add(f'<rect x="24" y="452" width="14" height="4" fill="{RED}"/><text x="44" y="459" fill="#333" font-size="12">SP = superpowers (in-session coordinator)</text>')
add(f'<rect x="330" y="452" width="14" height="4" fill="{BLUE}"/><text x="350" y="459" fill="#333" font-size="12">UP = ultrapowers (flat JS coordinator)</text>')
add(f'<text x="640" y="459" fill="{GREY}" font-size="11">PROJECTED beyond 24 tasks via cache-read-tax mechanism &#183; not measured</text>')
add('</svg>')

open("docs/benchmarks/cost-projection-2026-06-14.svg", "w").write("\n".join(s) + "\n")
print("wrote docs/benchmarks/cost-projection-2026-06-14.svg")
print(f"checks: A(180)={A(180):.1f} B(180)={B(180):.1f} Awin(180)={Awin(180):.0f}K Bwin(180)={Bwin(180):.0f}K")
print(f"        A(24)={A(24):.2f} (meas 28.19)  B(24)={B(24):.2f} (meas 25.95)")
print(f"        lx(24)={lx(24):.1f} (cutoff x, measured region = {FRAC*100:.0f}% of panel)")
