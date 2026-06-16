# Design: what gates replan / extra verification / human escalation

Answering the sharp question: *is the harness gated by **confidence** in deciding to replan, to
spend more verifier subagents on a task, or to escalate to a human, and where are those
boundaries?* Grounded in `workflows/ultrapowers-development.js` (line refs below).

## TL;DR, it is NOT confidence-gated

```
The harness has ZERO calibrated-confidence anywhere. Every decision is:

      deterministic signal   +   binary fail-closed verdict   +   bounded retry
   ───────────────────────────────────────────────────────────────────────────
   No reviewer emits a probability. The critic emits {clean: true|false}, not a score.
   "Spend more subagents" is triggered by a HARD signal (red gate / blocking finding),
   never by "I'm only 60% sure." Escalation fires on NAMED terminal conditions, not a
   confidence threshold.
```

This is a deliberate trade: **auditable + fail-closed-safe + cheap**, at the cost of **uniform
verification depth**, a borderline review gets exactly as much scrutiny as an obvious one.

## The three gates

| gate | question | what actually gates it | bound |
|------|----------|------------------------|-------|
| **A, verify more** | does this task need another implement/review pass? | deterministic test exit code + re-witness RED + **blocking review findings** (severity-tiered, fail-closed) | `MAX_FIX = 3` + thrash guard |
| **B, replan** | is the whole goal done, or inject new tasks? | `critic()` binary `{clean}` (opus judgment) | `loopUntilClean` opt-in · `MAX_ROUNDS` · budget |
| **C, escalate to human** | give up to a person? | a NAMED terminal condition (table below) | graduated: decompose → then human |

## Gate A, extra verification per task (`buildTask`, ~570-616)

Each fix-round re-runs the full ladder. More subagent work is spent **only** when a hard signal fires:

```
verify()        exit code ≠ 0           → re-implement   (deterministic; haiku copies the int, never judges)
re-witness RED  test passes w/o impl     → re-implement   (mechanical, not a judgment)
reviewSpec      blocking finding         → re-implement   (blocking = severity ∈ {critical, important})
reviewQuality   blocking finding         → re-implement   (runs only after spec passes)
reviewer ERRORED → treated as BLOCKING (fail-CLOSED), unavailable review never counts as a pass
```

Key point on "confidence": blocking is derived from the **finding's severity tier**, not the
model's `approved` boolean and not a confidence (`blocking = findings.filter(critical|important)`,
schema line 59). A reviewer that is *unsure* has only one lever, emit a finding at a severity,
so uncertainty collapses to a binary block/no-block. There is **no path** where "the reviewer is
uncertain" spins up *additional* verifier subagents. Verification breadth is fixed: exactly one
spec reviewer + one quality reviewer per round (+ retries only on tool error, `REVIEW_RETRY`).

**Bound + anti-thrash:** the loop runs at most `MAX_FIX = 3` rounds. A stall counter tracks whether
the blocking-finding count is *shrinking*; if it does not shrink for 2 consecutive rounds
(`stall >= 2`), the harness stops burning rounds and escalates `no-progress` (line ~610). So the
"spend more" decision is bounded by a count, not by a confidence that more spending would help.

## Gate B, replan / the dry-until-clean critic (`critic()` 635-648; loop 763-769)

```
critic() → opus inspects the real tree (git diff + read files + run verifyCmd) and returns:
              { clean: true }                      → stop
              { clean: false, gaps[], newTasks[] }  → queue newTasks, loop
```

- **Binary, not confidence.** `CRITIC` schema (55-56) is `{clean: boolean, gaps, newTasks}`. There
  is no "how sure are you it's clean", a single opus pass decides. If the critic *errors*, it
  returns `clean:true` with a logged gap (line 647), i.e. it fails **open** (stops) to avoid an
  unbounded loop. (Contrast Gate A, which fails **closed**. Different risk: a runaway critic costs
  money; a missed review ships a bug.)
- **Now opt-in.** As of the `loopUntilClean` flag, goal-mode defaults to a single plan→build pass;
  the critic only runs when `loopUntilClean:true`. Tasks-mode never ran it.
- **Bounded** by `MAX_ROUNDS`, `MAX_TASKS`, and a budget reserve; prior gaps are passed back so the
  critic can't re-emit the same gap as "new" (N7 dedup, 636-638).

## Gate C, human escalation boundaries

Escalation is **graduated** (try to self-resolve before bothering a human) and fires on these
named conditions, every one sets `needsHuman:true`, which the `/ultrapowers` command surfaces at
GATE 2 (a Workflow cannot ask mid-run, constraint N5):

| trigger | where | graduated first? |
|---------|-------|------------------|
| implementer `blocked` / `needs_context` | `escalateBlocked` 531 | **yes**, tries `decompose()` into subtasks first; human only if atomic/declined |
| `no-progress` (blocking findings not shrinking ≥2 rounds) | ~610 | the thrash guard *is* the early-stop |
| `max-fix-exhausted` (3 rounds, still blocking) | ~616 |, surfaces the stuck findings |
| `spec-review-unavailable` / `quality-review-unavailable` | 585 / 592 | fail-closed → human (never silently pass) |
| `integration.approved === false` | final gate ~786 | the pre-merge adversarial review vetoes |
| `stopped` = `max-tasks` / `budget` ceiling | loop |, ceiling hit, ask to raise/stop |
| `degraded` (≥3 consecutive implementer fallbacks) | `OUTAGE_STREAK` | likely correlated outage |

The top-level `ok` flag (≈799) is true only if **none** of these fired AND integration approved.
So the escalation boundary is: *deterministic terminal condition*, not *low confidence*.

## Honest critique, where confidence-gating COULD help (design options, NOT current)

The current binary design is robust and cheap, but it cannot **adapt verification depth to
uncertainty**. Four places a confidence/uncertainty signal would change behavior, all are
*proposals*, none are implemented:

1. **N-verifier voting on contested findings (the diverse-lens panel).** Today a single opus spec
   reviewer + single quality reviewer decide. A confidence-gated version would spin up *more*
   verifiers **only when** a finding is borderline (reviewer flags low certainty, or spec/quality
   disagree), paying for extra scrutiny exactly where it's uncertain, not uniformly. This is the
   panel idea from the discussion log.
2. **Adaptive re-witness depth.** re-witness RED (P1-strip) is all-or-nothing. A confidence-gated
   version would escalate to a **P2 mutant** only when the P1 result is suspicious (e.g. the test
   touches the impl but asserts thinly), see ADR-0002's boundary.
3. **Replan confidence.** The critic's `{clean}` is binary. A `{clean, confidence}` could loop only
   on *low-confidence-clean*, and stop early on *high-confidence-clean*, fewer wasted rounds.
4. **Calibrated escalation.** Today each trigger is independent. Co-occurring weak signals (a
   `done_with_concerns` + a near-stall + a thin test) could escalate *earlier* than any single
   trigger would, instead of grinding to `max-fix-exhausted`.

**Why not already?** Calibrated confidence from an LLM is itself unreliable, and a binary
fail-closed gate is easier to audit and harder to game. The honest position: the current design is
the right *default*; confidence-gating is a worthwhile *opt-in escalation* for high-stakes runs,
and it composes naturally with the panel + P2-mutant features already on the roadmap.
