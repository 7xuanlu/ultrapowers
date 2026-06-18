# Cost + context ladder, superpowers v6 vs ultrapowers, 24-task doc-DB (2026-06-17)

Model-fair head-to-head: **A-opus** (superpowers **v6**, in-session LLM coordinator on opus) vs
**B-full** (ultrapowers, deterministic JS Workflow coordinator). `impl=sonnet`, `reviewers=opus` on
both; the only structural difference is **where the orchestration loop lives**. Fixture: the
cumulative-prefix `longtasks-docdb` build, `node --test` per task. Points {12, 24}, **N=1**, plus a
single-task slugify reference. Cost = billed `total_cost_usd` + per-model `modelUsage.costUSD`
(rolls up subagents for both arms). This re-runs the 2026-06-14 v5 ladder against superpowers v6.

## Measured (N=1 per point, same fixture/config)

| tasks | SP v5 | UP v5 | **SP v6** | **UP v6** | v6 gap | quality (v6) |
|--:|--:|--:|--:|--:|--:|--|
| 1 (slugify*) | n/a | n/a | $0.88 | $0.76 | 1.16x | 3/3 pass both |
| 12 | $11.76 | $11.85 | **$20.72** | **$9.43** | 2.20x | SP 99 / UP 104 pass, 0 fail |
| 24 | $28.19 | $25.95 | **$38.49** | **$20.19** | 1.91x | SP 179 / UP 189 pass, 0 fail |

\* slugify is a different (single-task) fixture, so it is a parity reference, not a point on the
24-task curve.

**v5 -> v6 shift (same task counts):** SP **+76%** at 12 / **+36%** at 24; UP **-20%** / **-22%**.
Quality held equal (both arms green at every point); the comparison is mechanical (`node --test`
pass counts), the LLM blind-quality judge was not run.

### The mechanism, measured

| @ 12 tasks (v6) | SP (A-opus) | UP (B-full) |
|---|--:|--:|
| coordinator peak per-turn window | **184K** | **52K** |
| coordinator turns | **201** | **11** |
| opus cache-read tokens | 12.44M | 1.10M |
| opus cache-read @ 24 tasks | 26.6M | 2.5M |

SP's in-session opus coordinator does ~17 turns/task, each re-reading a window that grows ~11K/task
(184K by task 12, already above SP v5's 172K at task 24). UP's JS coordinator does ~1 turn/task and
holds ~52K flat. Cost tracks that re-read: SP's opus line is 86 to 88% of its bill.

### Why v6 widened a gap that was a tie in v5

Superpowers v6 merged its two per-task reviewers into one and added a **whole-branch final review on
the most-capable model**, a **file-handoff substrate** (`scripts/review-package`, `scripts/task-brief`)
that keeps artifacts out of the controller's context, and a **durable progress ledger**. The
merged-reviewer saving (~50%, obra's own hedged figure) is a review-stage cut.

- For **UP**, opus is used only for review, so the merge roughly halved its opus cache-read
  (4.91M -> 2.5M at 24, -49%) and lowered its bill.
- For **SP**, opus is also the in-session coordinator. The file-handoff features are mitigations for
  *that* coordinator's context cost, but the new top-tier whole-branch review plus per-turn
  bookkeeping outweighed the saving: SP opus cache-read rose 14.08M -> 26.6M at 24 (+89%) and its
  bill rose. The same v6 upgrade cut UP's cost and raised SP's.

## Prompt fidelity (fairness disclosure)

Both arms run the same discipline on the same models, but not byte-identical prompts. The A arm runs
superpowers' **verbatim** `task-reviewer-prompt.md`. The B arm runs ultrapowers' engine, which embeds
the TDD skill text verbatim (`workflow/ultrapowers-development.js:172`) but ports the merged reviewer
to a **condensed JSON-schema** form (`:466-484`): same two-verdict spec+quality structure, same
do-not-trust-the-report, same cannot_verify/warning tier, same read-only + don't-re-run-tests +
calibration, plus an explicit anti-gaming clause. UP's reviewer prompt is shorter, so it spends
marginally fewer reviewer-prompt tokens. This is an inherent consequence of hosting on the Workflow
primitive (structured output), and a confound to keep in view; it is small next to the coordinator
re-read difference.

## Projection to the 1M window (PROJECTED, not measured)

A long goal accumulates context in superpowers' in-session coordinator. The measured cost points are
N=1 and the 12-task run ran hot (per-task $1.73 at 12 vs $1.60 at 24, across two separate runs), so
the curve is **anchored on the measured window/cache-read mechanism, not fit to the two noisy cost
points**:

```
SP(n) = 1.425 n + 0.0075 n^2   central (anchored on measured cache-read 12.44M -> 26.6M, convex)
                               band 0.0045 (tax partly absorbed) .. 0.0110 (tax compounds)
UP(n) = 0.897 n - 1.33         (bounded coordinator)
SP window(n) = 52 + 11 n K     UP window(n) = 45 + 0.6 n K
```

SP's coordinator window crosses ~700K near **task 60** and the opus 1M ceiling near **task 86**. We
**stop the projection there** rather than model the forced-compaction regime beyond 1M.

| tasks | SP cost | UP cost | ratio | SP window |
|--:|--:|--:|--:|--:|
| **12** (measured) | **$20.72** | **$9.43** | 2.20x | 184K |
| **24** (measured) | **$38.49** | **$20.19** | 1.91x | ~316K |
| 48 | ~$86 | ~$42 | ~2.1x | ~580K |
| 72 | ~$142 | ~$63 | ~2.2x | ~844K |
| **86** (SP at 1M) | **~$178** | **~$76** | **~2.4x** | ~1M |

Central ~2.4x at the 1M window (task 86), band ~2.0x (tax partly absorbed) to ~2.7x (tax compounds).
The gap **compounds** within the range as context accumulates. The robust, measured signals are the
**window/turn split** (184K/201 turns vs 52K/11 turns at 12 tasks) and the **~2x cost gap already
present at 12 and 24 tasks**; the dollar curve past 24 rides on them. Reproduce:
`python3 bench/plot-cost-projection-v6.py` -> `docs/benchmarks/cost-projection-2026-06-17.svg`.

## Provenance / reproduce

```
# v6 ladder rungs: bench/ladder.sh (PREFIXES="12"), arms A-opus B-full, fixture longtasks-docdb
# 24-task point:  earlier session, archived numbers (SP $38.49 / UP $20.19; opus cache-read 26.6M / 2.5M)
# 12-task point:  bench/results/20260617-184206.json + ladder-20260617-184206.jsonl
# window/turns:   jq over bench/runs-ladder/20260617-184206/prefix-12.runs/<arm>/1/transcript.jsonl
# quality:        .../output/verify.txt  (both arms: node --test exit 0, 0 fail)
```
