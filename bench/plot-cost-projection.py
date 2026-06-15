#!/usr/bin/env python3
"""Generate the PROJECTED cost+context figure (solid = measured <=24 tasks,
dashed = projected to ~task 180 where SP's coordinator approaches 1M).

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

NMAX = 180
RED, BLUE, GREY = "#d1495b", "#2e6fdb", "#999"

# ---- panel geometry ----------------------------------------------------------
# left = cost ($0..$420), right = window (0..1000K). x = tasks 0..180.
LX0, LX1 = 70, 440
RX0, RX1 = 590, 960
PY0, PY1 = 110, 400          # top (max), bottom (0)
COST_MAX, WIN_MAX = 420, 1000

def lx(n):  return LX0 + (LX1 - LX0) * n / NMAX
def rx(n):  return RX0 + (RX1 - RX0) * n / NMAX
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

add('<svg xmlns="http://www.w3.org/2000/svg" width="1040" height="470" '
    'font-family="-apple-system,Segoe UI,Roboto,sans-serif" font-size="13">')
add('<rect width="1040" height="470" fill="#ffffff"/>')
add('<text x="24" y="28" font-size="17" font-weight="700" fill="#111">'
    'Projected to ~1M coordinator window &#8212; solid = measured (&#8804;24 tasks), '
    'dashed = PROJECTED (N=1 extrapolation)</text>')

# ---- LEFT: cost --------------------------------------------------------------
add('<text x="24" y="58" font-size="15" font-weight="700" fill="#111">Total cost &#8212; gap opens at scale</text>')
add('<text x="24" y="76" font-size="12" fill="#666">billed total_cost_usd · band = N=1 uncertainty</text>')
for c in range(0, COST_MAX + 1, 100):
    y = yc(c)
    add(f'<line x1="{LX0}" y1="{y:.1f}" x2="{LX1}" y2="{y:.1f}" stroke="#eee"/>')
    add(f'<text x="{LX0-8}" y="{y+4:.1f}" text-anchor="end" fill="{GREY}" font-size="11">${c}</text>')
for n in (24, 48, 96, 144, 180):
    x = lx(n)
    add(f'<line x1="{x:.1f}" y1="{PY1}" x2="{x:.1f}" y2="{PY1+4}" stroke="{GREY}"/>')
    add(f'<text x="{x:.1f}" y="{PY1+20}" text-anchor="middle" fill="{GREY}" font-size="11">{n}</text>')
add(f'<text x="255" y="438" text-anchor="middle" fill="#666" font-size="12">tasks</text>')

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
add(f'<text x="80" y="{yc(360):.1f}" fill="#444" font-size="12">@~task 180: ~1.8&#215; · ~$175 gap</text>')

# ---- RIGHT: window -----------------------------------------------------------
add('<text x="544" y="58" font-size="15" font-weight="700" fill="#111">Coordinator window &#8212; SP nears 1M; UP bounded</text>')
add('<text x="544" y="76" font-size="12" fill="#666">peak per-turn window · opus 4.8 ceiling = 1M</text>')
for w in range(0, WIN_MAX + 1, 200):
    y = yw(w)
    add(f'<line x1="{RX0}" y1="{y:.1f}" x2="{RX1}" y2="{y:.1f}" stroke="#eee"/>')
    add(f'<text x="{RX0-8}" y="{y+4:.1f}" text-anchor="end" fill="{GREY}" font-size="11">{w}K</text>')
for n in (24, 48, 96, 144, 180):
    x = rx(n)
    add(f'<line x1="{x:.1f}" y1="{PY1}" x2="{x:.1f}" y2="{PY1+4}" stroke="{GREY}"/>')
    add(f'<text x="{x:.1f}" y="{PY1+20}" text-anchor="middle" fill="{GREY}" font-size="11">{n}</text>')
add(f'<text x="775" y="438" text-anchor="middle" fill="#666" font-size="12">tasks</text>')

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
add(f'<text x="640" y="459" fill="{GREY}" font-size="11">PROJECTED beyond 24 tasks via cache-read-tax mechanism · not measured</text>')
add('</svg>')

open("docs/benchmarks/cost-projection-2026-06-14.svg", "w").write("\n".join(s) + "\n")
print("wrote docs/benchmarks/cost-projection-2026-06-14.svg")
print(f"checks: A(180)={A(180):.1f} B(180)={B(180):.1f} Awin(180)={Awin(180):.0f}K Bwin(180)={Bwin(180):.0f}K")
print(f"        A(24)={A(24):.2f} (meas 28.19)  B(24)={B(24):.2f} (meas 25.95)")
