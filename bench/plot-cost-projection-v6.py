#!/usr/bin/env python3
"""Generate the v6 measured->projected cost+context figure (2026-06-17 ladder).

Two panels on a shared linear task axis (0..86):
  LEFT  = total cost ($), measured at {12, 24} (N=1), projected 24..86 with a band.
  RIGHT = coordinator peak per-turn window (K tokens), measured @12, projected to the
          1M opus ceiling, which SP reaches around task 86.

We STOP the projection at the 1M window (no extrapolation into the post-wall compaction
regime). Within 24..86 the cost ratio compounds as SP's coordinator context accumulates.

Pure-stdlib SVG (matplotlib unavailable in the sandbox). All anchors + the projection
model are documented in docs/benchmarks/cost-and-context-ladder-2026-06-17.md. Every
value past task 24 is EXTRAPOLATION from an N=1 ladder, not measurement.

  Cost model (linear build + compounding cache-read tax):
    SP(n) = 1.425 n + 0.0075 n^2     # central (anchored on measured cache-read 12.44M->26.6M)
                                     # band 0.0045 (tax partly absorbed) .. 0.0110 (compounds)
    UP(n) = 0.897 n - 1.33           # ~linear, bounded coordinator
  Window model (peak per-turn, K), anchored on measured @12 (SP 184, UP 52):
    SP_w(n) = 52 + 11.0 n            # reaches the 1M ceiling ~task 86 (end of projection)
    UP_w(n) = 45 + 0.6 n             # bounded
"""

# ---- model -------------------------------------------------------------------
# Projection ends at WALL: the task where SP's peak window reaches the 1M opus ceiling
# (52 + 11*86 = 998K). SP's central curve is anchored on the MEASURED cache-read growth
# (12.44M@12 -> 26.6M@24, convex), not on the two noisy cost points, so the ratio
# compounds as context accumulates toward the wall.
WALL = 86
def A(n):    return 1.425 * n + 0.0075 * n * n       # SP central (measured-cache-read-anchored, compounding)
def A_lo(n): return 1.425 * n + 0.0045 * n * n       # low band (tax partly absorbed)
def A_hi(n): return 1.425 * n + 0.0110 * n * n       # high band (tax compounds harder)
def B(n):    return max(0.0, 0.897 * n - 1.33)       # UP ~linear, bounded coordinator
def Awin(n): return min(52 + 11.0 * n, 1000)         # SP peak window (K)
def Bwin(n): return 45 + 0.6 * n                     # UP peak window (K), bounded

# measured anchors (N=1 ladder, longtasks-docdb, opus orchestrator, sonnet impl + opus reviewers)
M_A  = [(12, 20.72), (24, 38.49)]      # SP cost
M_B  = [(12, 9.43),  (24, 20.19)]      # UP cost
M_Aw = [(12, 184)]                     # SP peak window (measured this run; 24-run transcript not retained)
M_Bw = [(12, 52)]                      # UP peak window

NCUT = 24
NMAX = WALL                            # stop at the 1M window
RED, BLUE, GREY = "#d1495b", "#2e6fdb", "#999"

# diagnostics (verify the math in the run output)
for n in (12, 24, 48, 72, 86):
    print(f"n={n:3d}  SP=${A(n):6.1f} (lo {A_lo(n):.0f}/hi {A_hi(n):.0f})  UP=${B(n):6.1f}  "
          f"ratio={A(n)/max(B(n),1e-9):.2f}x  SPwin={Awin(n):.0f}K  UPwin={Bwin(n):.0f}K")

# ---- geometry ----------------------------------------------------------------
LX0, LX1 = 70, 470
RX0, RX1 = 600, 1000
PY0, PY1 = 110, 400
COST_MAX, WIN_MAX = 220, 1100

def lx(n): return LX0 + (LX1 - LX0) * n / NMAX
def rx(n): return RX0 + (RX1 - RX0) * n / NMAX
def yc(c): return PY1 - (PY1 - PY0) * c / COST_MAX
def yw(w): return PY1 - (PY1 - PY0) * w / WIN_MAX

def fpath(fn, xfn, yfn, n0, n1, step=1):
    return " ".join(f"{xfn(k):.1f},{yfn(fn(k)):.1f}" for k in range(n0, n1 + 1, step))

s = []
def add(x): s.append(x)

def base(x0, x1, xfn):
    xc = xfn(NCUT)
    add(f'<rect x="{x0}" y="{PY0:.1f}" width="{xc-x0:.1f}" height="{PY1-PY0}" fill="{BLUE}" fill-opacity="0.04"/>')
    add(f'<line x1="{xc:.1f}" y1="{PY0-4:.1f}" x2="{xc:.1f}" y2="{PY1}" stroke="#555" stroke-width="1.2" stroke-dasharray="3,3"/>')
    add(f'<text x="{xc-6:.1f}" y="{PY0-6:.1f}" text-anchor="end" fill="#555" font-size="10">&#9664; measured (N=1)</text>')
    add(f'<text x="{xc+6:.1f}" y="{PY0-6:.1f}" text-anchor="start" fill="#555" font-size="10">projected &#9654;</text>')

add('<svg xmlns="http://www.w3.org/2000/svg" width="1060" height="476" '
    'font-family="-apple-system,Segoe UI,Roboto,sans-serif" font-size="13">')
add('<rect width="1060" height="476" fill="#ffffff"/>')
add('<text x="24" y="28" font-size="17" font-weight="700" fill="#111">'
    "Superpowers v6 vs Ultrapowers: measured to 24 tasks, projected to SP's 1M window</text>")
add('<text x="24" y="46" font-size="12" fill="#666">'
    'solid = measured (12 &amp; 24 tasks, N=1) &#183; dashed = PROJECTED &#183; same fixture, sonnet implementer + opus reviewers on both; only the loop locus differs</text>')

# ---- LEFT: cost --------------------------------------------------------------
add('<text x="24" y="74" font-size="15" font-weight="700" fill="#111">Total cost: ~2&#215; gap by 12 tasks, compounding</text>')
add('<text x="24" y="92" font-size="12" fill="#666">billed total_cost_usd &#183; band = N=1 + tax uncertainty</text>')
base(LX0, LX1, lx)
for c in range(0, COST_MAX + 1, 40):
    y = yc(c)
    add(f'<line x1="{LX0}" y1="{y:.1f}" x2="{LX1}" y2="{y:.1f}" stroke="#eee"/>')
    add(f'<text x="{LX0-8}" y="{y+4:.1f}" text-anchor="end" fill="{GREY}" font-size="11">${c}</text>')
for n in (12, 24, 48, 72, 86):
    x = lx(n)
    bold = ' font-weight="700"' if n in (12, 24) else ''
    add(f'<line x1="{x:.1f}" y1="{PY1}" x2="{x:.1f}" y2="{PY1+4}" stroke="{GREY}"/>')
    add(f'<text x="{x:.1f}" y="{PY1+20}" text-anchor="middle" fill="{GREY}" font-size="11"{bold}>{n}</text>')
add(f'<text x="270" y="438" text-anchor="middle" fill="#666" font-size="12">tasks</text>')

# SP band (projected, 24..86)
sp_band = fpath(A_hi, lx, yc, NCUT, NMAX) + " " + \
          " ".join(f"{lx(k):.1f},{yc(A_lo(k)):.1f}" for k in range(NMAX, NCUT - 1, -1))
add(f'<polygon points="{sp_band}" fill="{RED}" fill-opacity="0.10" stroke="none"/>')
# projected dashed central
add(f'<polyline points="{fpath(A, lx, yc, NCUT, NMAX)}" fill="none" stroke="{RED}" stroke-width="2.5" stroke-dasharray="7,5"/>')
add(f'<polyline points="{fpath(B, lx, yc, NCUT, NMAX)}" fill="none" stroke="{BLUE}" stroke-width="2.5" stroke-dasharray="7,5"/>')
# measured solid
add(f'<polyline points="{" ".join(f"{lx(n):.1f},{yc(c):.1f}" for n,c in M_A)}" fill="none" stroke="{RED}" stroke-width="2.8"/>')
add(f'<polyline points="{" ".join(f"{lx(n):.1f},{yc(c):.1f}" for n,c in M_B)}" fill="none" stroke="{BLUE}" stroke-width="2.8"/>')
for n,c in M_A: add(f'<circle cx="{lx(n):.1f}" cy="{yc(c):.1f}" r="3.6" fill="{RED}"/>')
for n,c in M_B: add(f'<circle cx="{lx(n):.1f}" cy="{yc(c):.1f}" r="3.6" fill="{BLUE}"/>')
add(f'<text x="{lx(24)+6:.1f}" y="{yc(38.49)-8:.1f}" fill="{RED}" font-size="11" font-weight="700">SP $38 @24</text>')
add(f'<text x="{lx(24)+6:.1f}" y="{yc(20.19)+16:.1f}" fill="{BLUE}" font-size="11" font-weight="700">UP $20 @24</text>')
add(f'<text x="{lx(86)-4:.1f}" y="{yc(A(86))-8:.1f}" text-anchor="end" fill="{RED}" font-size="12" font-weight="700">SP ~${A(86):.0f}</text>')
add(f'<text x="{lx(86)-4:.1f}" y="{yc(B(86))+16:.1f}" text-anchor="end" fill="{BLUE}" font-size="12" font-weight="700">UP ~${B(86):.0f}</text>')
add(f'<text x="{lx(50):.1f}" y="{yc(A(60)):.1f}" text-anchor="middle" fill="#444" font-size="11">ratio compounds: 1.9&#215; @24 to ~{A(86)/B(86):.1f}&#215; @86</text>')

# ---- RIGHT: window -----------------------------------------------------------
add('<text x="554" y="74" font-size="15" font-weight="700" fill="#111">Coordinator window: SP fills to 1M; UP flat</text>')
add('<text x="554" y="92" font-size="12" fill="#666">peak per-turn window &#183; opus 4.8 ceiling = 1M</text>')
base(RX0, RX1, rx)
for w in range(0, WIN_MAX + 1, 200):
    y = yw(w)
    add(f'<line x1="{RX0}" y1="{y:.1f}" x2="{RX1}" y2="{y:.1f}" stroke="#eee"/>')
    add(f'<text x="{RX0-8}" y="{y+4:.1f}" text-anchor="end" fill="{GREY}" font-size="11">{w}K</text>')
for n in (12, 24, 48, 72, 86):
    x = rx(n)
    bold = ' font-weight="700"' if n in (12, 24) else ''
    add(f'<line x1="{x:.1f}" y1="{PY1}" x2="{x:.1f}" y2="{PY1+4}" stroke="{GREY}"/>')
    add(f'<text x="{x:.1f}" y="{PY1+20}" text-anchor="middle" fill="{GREY}" font-size="11"{bold}>{n}</text>')
add(f'<text x="800" y="438" text-anchor="middle" fill="#666" font-size="12">tasks</text>')

# 1M ceiling
add(f'<line x1="{RX0}" y1="{yw(1000):.1f}" x2="{RX1}" y2="{yw(1000):.1f}" stroke="#b00" stroke-width="1.3" stroke-dasharray="4,4"/>')
add(f'<text x="{RX1:.1f}" y="{yw(1000)-6:.1f}" text-anchor="end" fill="#b00" font-size="11" font-weight="700">1M ceiling</text>')
# projected dashed windows (12..86)
add(f'<polyline points="{fpath(Awin, rx, yw, 24, NMAX)}" fill="none" stroke="{RED}" stroke-width="2.5" stroke-dasharray="7,5"/>')
add(f'<polyline points="{fpath(Bwin, rx, yw, 24, NMAX)}" fill="none" stroke="{BLUE}" stroke-width="2.5" stroke-dasharray="7,5"/>')
# measured solid (connect @12 marker to projection start @24)
add(f'<polyline points="{rx(12):.1f},{yw(184):.1f} {rx(24):.1f},{yw(Awin(24)):.1f}" fill="none" stroke="{RED}" stroke-width="2.8"/>')
add(f'<polyline points="{rx(12):.1f},{yw(52):.1f} {rx(24):.1f},{yw(Bwin(24)):.1f}" fill="none" stroke="{BLUE}" stroke-width="2.8"/>')
for n,w in M_Aw: add(f'<circle cx="{rx(n):.1f}" cy="{yw(w):.1f}" r="3.6" fill="{RED}"/>')
for n,w in M_Bw: add(f'<circle cx="{rx(n):.1f}" cy="{yw(w):.1f}" r="3.6" fill="{BLUE}"/>')
add(f'<text x="{rx(12)+6:.1f}" y="{yw(184)-6:.1f}" fill="{RED}" font-size="11" font-weight="700">184K @12</text>')
add(f'<text x="{rx(12)+6:.1f}" y="{yw(52)+16:.1f}" fill="{BLUE}" font-size="11" font-weight="700">52K @12</text>')
add(f'<text x="{rx(86)-4:.1f}" y="{yw(1000)+16:.1f}" text-anchor="end" fill="{RED}" font-size="11" font-weight="700">SP at 1M ~task 86</text>')
add(f'<text x="{rx(86)-4:.1f}" y="{yw(Bwin(86))+16:.1f}" text-anchor="end" fill="{BLUE}" font-size="12" font-weight="700">UP ~{Bwin(86):.0f}K</text>')

# ---- legend ------------------------------------------------------------------
add(f'<rect x="24" y="458" width="14" height="4" fill="{RED}"/><text x="44" y="465" fill="#333" font-size="12">SP = Superpowers v6 (in-session opus coordinator)</text>')
add(f'<rect x="360" y="458" width="14" height="4" fill="{BLUE}"/><text x="380" y="465" fill="#333" font-size="12">UP = Ultrapowers (flat JS coordinator)</text>')
add(f'<text x="700" y="465" fill="{GREY}" font-size="11">PROJECTED 24..86 via the window/cache-read mechanism &#183; not measured</text>')
add('</svg>')

open("docs/benchmarks/cost-projection-2026-06-17.svg", "w").write("\n".join(s) + "\n")
print("wrote docs/benchmarks/cost-projection-2026-06-17.svg")
