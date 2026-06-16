# Cost + context divergence ladder, A-opus vs B-full, 24-task doc-DB (2026-06-14)

Model-fair head-to-head: **A-opus** (superpowers, in-session LLM coordinator) vs **B-full**
(ultrapowers, deterministic JS Workflow coordinator). `impl=sonnet`, `reviewers=opus` on both,
the only structural difference is **where the orchestration loop lives**. Fixture: the 24-task
`longtasks-docdb` build, `node --test` per task. Cumulative prefixes {6, 12, 24}, **N=1**. Cost =
billed `total_cost_usd` + per-model `modelUsage.costUSD` (rolls up subagents for both arms).

Adversarially reviewed (`/council`, 2026-06-14): verdict **approve-with-changes (medium)**, 2-1.
All five required changes are folded in below.

## The headline to show users, session-context accumulation rate (NOT cost)

The cost gap is within single-run noise; the **measured, monotonic, model-fair** finding is how
fast each architecture's coordinator session fills.

| metric | superpowers (A) | ultrapowers (B) |
|---|---|---|
| **coordinator session window growth** | **~5K tokens/task** | **~0.8K tokens/task (≈6× slower)** |
| session window @ {6,12,24} tasks | 82K → 107K → 172K | 43K → 51K → 59K |
| context ceiling (opus 4.8 = **1M default, no long-context premium**) | approaches 1M ~task **180** (long extrapolation; rarely reached) | never (bounded) |
| total cost @24 tasks | $28.19 | $25.95 |
| total cost scaling 6→24 | 4.18× | 4.08× |
| **$/task** | 1.12 → 0.98 → **1.17** (bending up) | 1.06 → 0.99 → **1.08** (flat) |

> **On modern 1M-context coordinators (opus 4.8 / sonnet 4.6 are both 1M) neither arm walls in
> normal use**, superpowers approaches the 1M ceiling only ~task 180. At realistic scales (≤~50
> tasks) it is **cost + quality parity**. The one measured, robust difference is the **accumulation
> rate**: superpowers' coordinator session grows ~5K tok/task; ultrapowers' ~0.8K/task (≈6× slower).
> ultrapowers' edge is therefore a **bounded, predictable coordinator**, headroom for very long
> autonomous runs and a flat human session, **not** a near-term cost or wall win.

`[VERIFIED claude-api model catalog]`: `claude-opus-4-8` default context = **1M** at standard
pricing ($5/$25 per MTok), **no long-context premium**. The old "200K wall" only applies to a
200K-context coordinator (haiku), not a realistic choice. So the dollar payoff of B's flat
coordinator lands only at **extreme scale** (>100 tasks, where A's re-read tax compounds), not at the
measured 24.

Why B grows at all: A runs the SDD loop **in-session**, so every task's impl+review accumulates in
its transcript (intrinsic). B's relay session holds only the prompt (inlined task-list) + the
returned result JSON, the build runs in disposable off-session subagents, so it grows ~0.8K/task
purely because the **returned result carries more task-results** as task count rises (I/O, not
execution; flat if tasks are passed by reference and the result is summarized).

## Solid vs hypothesis (be explicit, council change #3/#4)

- **SOLID (measured, model-fair):** the 6× slower context accumulation (3 monotonic points each);
  opus cache-read 14.08M (A) vs 4.91M (B) = **2.87×** at prefix-24; metering exact + reproducible.
- **HYPOTHESIS (N=1, extrapolated, do not headline):** the 8% cost gap (within ±20% single-run
  noise, the prefix-12 point even *reverses* to B 0.8% dearer); the 600K-window / ~$170-at-100-task
  projection from a 3-point accelerating power-law; "B trending cheaper" as a trend.
  - The full projection to the 1M wall (~task 180: A ~$395 vs B ~$219 ≈ 1.8×, band 1.3-2.4×) is in
    `bench/plot-cost-projection.py` → `docs/benchmarks/cost-projection-2026-06-14.svg`. Model:
    `A(n)=1.018n+0.00655n²`, `B(n)=1.061n+0.000867n²`, anchored on the measured prefix-24 totals +
    the 14.08M/4.91M opus cache-read split. **Projected, not measured**, labeled as such in the README.

## Corrections folded from the /council review

1. **Context flat ≠ cost flat.** B's *context window* grows ~6× slower than A's, but B's *total
   cost* still scales ~linearly (~4×) over 6→24 tasks, building 4× more modules costs ~4×. The win
   is **flat $/task** (no growing re-read tax), and at 6-24 tasks it is only just emerging (A $/task
   1.12→1.17 vs B 1.06→1.08). Never say "B's cost is flat", say "B's *context* is flat."
2. **The 8% is coordinator-locus, not model-routing.** B's $2.24 net win is the coordinator
   re-read tax: A's opus coordinator re-reads its growing window (14.08M opus cache-read) vs B's
   bounded 4.91M (2.87×). B's haiku line ($2.14) is **extra** cost that *offsets* the win, not its
   cause. (An earlier draft inverted this; the council corrected it from the token data.)
3. **Window-peak provenance.** The 82K/107K/172K (A) and 43K/51K/59K (B) figures are the **peak
   per-turn window** (`input + cache_read + cache_creation` over top-level coordinator turns),
   transcript-derived, archived under `bench/runs-ladder/20260614-161529/prefix-*.runs/`. They are
   NOT the summary `meterA.input` (~18K fresh input for A), a different metric. Do not conflate
   with the older *sonnet*-coordinator scale run (34K→135K in `scale-and-rewitness-2026-06-14.md`).
4. **The haiku in B is a Workflow-sandbox artifact, not an inherent need.** Haiku ($2.14, ~8% of
   B's bill) runs only the **mechanical** steps, `verify` (run `node --test`, read exit code) and
   `re-witness` (git diff → classify test/prod by path → `git checkout` revert → re-run → restore).
   None need an LLM; haiku is there because the Workflow JS coordinator is **sandboxed (no shell /
   git / fs)** and can only delegate shell work to a subagent. A **standalone Node runner** (the v2
   re-host) makes verify + re-witness **free deterministic code** and removes the haiku line,
   directionally widening B's lead. Recorded as a design note, not a benchmark adjustment.
5. **No long-context premium (corrected).** `claude-opus-4-8` is **1M-context at standard pricing**
   (`[VERIFIED claude-api catalog]`: $5/$25 per MTok, no long-context premium); the `[1m]` tag on
   B's opus line is **not** a documented price tier. The small realized per-token differences between
   the two opus lines (~$5.96 vs ~$6.36/MTok effective) are billing artifacts (e.g. cache-write TTL),
   not a 200K-premium, so there is **no** "200K wall / 1M premium" penalty in this benchmark.

## What is genuinely defensible to claim

> "On a model-fair build (same implementer + reviewer models), the deterministic-coordinator harness
> keeps its session context growing ~6× slower than the in-session coordinator (~0.8K vs ~5K
> tokens/task). On a 1M-context coordinator neither walls in normal use, so at realistic scales it is
> cost + quality parity; the architectural benefit is **bounded coordinator footprint, headroom and
> predictability for very long autonomous runs**, and the token-efficiency property belongs to the
> underlying Workflow primitive. The dollar payoff lands only at extreme scale, not at ≤24 tasks."

NOT defensible: a single-number "X% cheaper" headline (N=1, within noise), or the 100-task cost
projection as a finding (it is a labeled hypothesis).

## Provenance / reproduce

```
# session window per arm/prefix (the headline metric):
jq -s '[.[]|select(.type=="assistant" and (.parent_tool_use_id|not))
        |.message.usage|((.input_tokens//0)+(.cache_read_input_tokens//0)+(.cache_creation_input_tokens//0))]|max' \
   bench/runs-ladder/20260614-161529/prefix-<N>.runs/<arm>/1/transcript.jsonl
# billed cost + per-model decomposition: bench/runs-ladder/20260614-161529/prefix-<N>.results.json
# quality: .../prefix-24.runs/<arm>/1/output/verify.txt  (both: node --test exit 0, 0 fail)
```
