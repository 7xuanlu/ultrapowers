# Token-cost benchmark

The honest user-facing claim, the model behind it, and measured numbers.

> **Strongest evidence:** the N=5 head-to-head in
> [`campaign-n5-2026-06-14.md`](./campaign-n5-2026-06-14.md), quality TIE, total cost TIE at
> small N ($3.90 vs $4.03 median), and a decisive **~8× flatter** coordinator (Meter A). The
> scaling model below is what predicts those results and what happens beyond small N.

## Two meters, don't conflate them

| Meter | what it measures | why it matters |
|-------|------------------|----------------|
| **A, coordinator / main-session context** | tokens that accumulate in the *controlling* context over the run | this is what forces compaction and kills long unattended runs |
| **B, total billed tokens** | sum of every (disposable) subagent's work | this is your bill |

- **ultrapowers, Meter A:** ~flat (the coordinator is JS; only the final return lands in your
  session). *Independent of task count.*
- **ultrapowers, Meter B:** **not** near-zero, it is Σ(impl + verify + re-witness + 2 reviews
  + critic + integration + fixes) per task. *More* stages than Superpowers, but on cheaper
  role-routed models.
- **Superpowers (+ PR #1717), Meter A:** grows O(tasks), an LLM controller re-sends its
  growing context each turn (`[V #1152]`: ~1.3MB context, "half the context"; 5h budget).
- **Superpowers (+ PR #1717), Meter B:** ~20-25% below its own baseline (`[V PR #1717]`), but
  that sits barely above the harness's own ±20% run-to-run noise and went −3% on one scenario.

> "ultrapowers uses near-zero tokens" is **true for Meter A, false for Meter B.** Claim the
> Meter-A flatness (a scaling/capability property that lets long builds survive); do **not** claim
> total-billing savings or "cheaper", total cost was a measured **tie** at small N
> (`[V campaign-n5-2026-06-14.md]`).

## The scaling model, why PR #1717 ≠ a substitute

`[ESTIMATE: model shown]` Total cost as a function of N tasks:

```
  Superpowers ≈ a·N²  +  w·N      ← N² term = growing controller context re-sent each turn
  PR #1717    ≈ 0.8·(a·N² + w·N)  ← trims ~20% off BOTH terms; the N² term remains
  ultrapowers ≈   0   +  w'·N      ← no N² term (JS coordinator); w' > w (more review stages)
```

- small N (e.g. 3 tasks): `w'·N` may exceed `0.8·(a·N²+w·N)` → **PR #1717 likely cheaper total**.
  Borne out by the N=5 head-to-head: total cost was a **tie** ($3.90 vs $4.03 median, ranges
  fully overlap `[V campaign-n5-2026-06-14.md]`). No "cheaper" headline at small/normal sizes.
- large N (long build): the `a·N²` term doesn't just cost more, it grows the in-session
  controller until it **overflows the model's context window**, forcing lossy compaction or
  failure. ultrapowers' coordinator stays flat (measured ~8× flatter at N=5, same campaign), so
  the long build *completes at all*. The decisive property at scale is **capability/survival**,
  not a per-bill discount.

**PR #1717 trims a constant off a quadratic; ultrapowers deletes the quadratic.** ultrapowers'
measured, decisive win is on **Meter A** (coordinator flatness, a scaling/capability property);
on **Meter B** it is a tie at small N and the crossover point is **modeled, not yet measured**.
For its design target (long unattended whole-goal builds) the flat coordinator is what lets the
run survive; for a toy build, PR #1717 can be cheaper on Meter B.

## Real anchors

`[V from runs]`
- ultrapowers main-session delta per build = just the return object (~1-3k tokens), independent
  of N.
- per-agent ≈ 23k tokens (1,320,932 tok / 57 agents in the re-witness validation study).
- Superpowers controller disclosed at ~1.3MB context re-sent per turn (`[V #1152]`).

## Measured results

**Run `wf_7ad7c92f-406`** (launched 2026-06-13), 3-task build (slugify, truncate, wordCount)
on a clean node:test target, `implementer:claude`, `implModel:sonnet`, `commit:true`,
re-witness on. Methodology: read the Workflow's reported `subagent_tokens` + `agent_count`
(Meter B) and note the main-session return-object size (Meter A).

| metric | value |
|--------|-------|
| tasks | 3 (slugify, truncate, wordCount) |
| outcome | `ok:true`, 3/3 passed, integration **approved**, 14/14 tests green |
| **total subagent tokens (Meter B)** | **471,404** `[V run wf_7ad7c92f-406]` |
| agent count | 22 (~7.3 / task: impl + verify + re-witness + 2 reviews + capture-head, then 1 integration) |
| tokens / task | ~157,135 |
| tokens / agent | ~21,427 (matches the ~23k anchor) |
| **main-session delta (Meter A)** | **just the return object (~2k tokens). The coordinator made 0 LLM calls, none of the 471k work tokens entered the controlling session.** |
| wall-clock | ~10.8 min |
| re-witness RED | active (commit + verifyCmd preconditions met); no catch, the tests were discriminating (integration reviewer independently confirmed "no tautological assertions"). Per-task probe results are not surfaced in the return. |

### What this one run shows (and doesn't)

- **Meter A, measured:** 471k tokens of work were done; ~2k reached the controlling session.
  That is the flatness claim, demonstrated, independent of how many tasks ran, the coordinator
  context does not absorb the work.
- **Meter B, measured:** ~157k tokens/task on a 3-task build. This is the **small-N regime**,
  exactly where the scaling model predicts ultrapowers is *not* cheaper total than Superpowers
  (more review stages, no N² tax to amortize away yet). Consistent with the model, not a win on
  this axis at N=3.
- **Caveat:** `implementer:claude` flags the run `selfReviewed` (implementer + reviewers are the
  same model family), yet the reviewers still caught real nits (a dead-code branch in slugify,
  an unguarded `n<1` edge in truncate, ASCII-only slug handling). Review worked; spot-check still
  advised for self-reviewed runs.
- **N is small and N=1 run:** no variance bars. The Meter-B-crossover (where ultrapowers overtakes
  on total billing) is unmeasured, it needs a large-N build and a same-spec Superpowers baseline.

> A clean head-to-head against Superpowers' in-session orchestration is **not** practical to run
> here (it would pollute the measuring session); the Superpowers side is cited from its disclosed
> PR #1717 eval. A fair same-spec head-to-head is future work.
