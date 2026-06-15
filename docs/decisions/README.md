# Architecture Decision Records

Short, dated records of the load-bearing choices. Each: context → decision → consequences
(including the honest trade-offs). Append new ones; don't rewrite history.

---

## ADR-0001 — Host SDD/TDD on Anthropic's deterministic Workflow primitive

**Date:** 2026-06 · **Status:** accepted

**Context.** Superpowers runs its SDD controller in the *main session* — an LLM loop that
extracts tasks, dispatches subagents, and reads back every impl + review report. That context
grows O(tasks×reviews), forces compaction, and exhausts long runs (`[V superpowers #1152]`:
"consumes full 5h token budget in a single run"). Superpowers' maintainer declined moving off
this model (`[V #1041]`: "dramatically more complicated for most users").

**Decision.** Implement the harness as a Claude Code **Workflow** — a deterministic JS
coordinator. Intermediate `agent()` results live in script variables and never re-enter an LLM
context; only the final return lands in the user's session.

**Consequences.**
- (+) Main-session / coordinator context stays ~flat for the whole run → no compaction, runs
  survive arbitrarily long, the human session doesn't bloat. This is the **Meter-A** win in
  `docs/benchmarks/token-benchmark.md`.
- (+) Orchestration costs zero LLM tokens (it's code).
- (−) The token efficiency is the **Workflow primitive's** property, not ours. Honest framing:
  we *chose to host discipline on it*; we didn't invent the saving.
- (−) A Workflow cannot pause for mid-run human input (constraint N5). We move the human gates
  into the `/ultrapowers` command (plan approval + critical review), with the autonomous
  Workflow in between.
- (−) Fresh subagent per fix-round (constraint N4) loses the warm context Superpowers keeps; we
  re-ground each fix agent with `git diff` instead.

---

## ADR-0002 — Mechanical re-witness RED (P1-strip) after the gate goes green

**Date:** 2026-06 · **Status:** accepted (default-on, cheap tier)

**Context.** In same-agent TDD, the agent that writes the test also writes the implementation —
a known bias toward easy-to-pass tests. Superpowers enforces "watch it fail" *in prose* and
trusts the agent's word; no shipped build harness mechanically verifies it. A 14-chain study
(haiku+sonnet, 7 pure-function tasks) found 0 weak tests — so two-stage review + honest TDD
already handles easy cases — but the decisive metric was 0/0 (degenerate), proving neither a gap
nor its absence on harder code.

**Decision.** After a task's suite is green, revert *only* this task's production files to their
pre-task state (keeping the new tests on HEAD) and re-run the suite. If it still passes, the test
does not depend on the implementation → send it back to the implementer. Gated on `commit:true`
+ a `verifyCmd`; near-zero cost (one haiku agent); fail-open (an inapplicable/errored check never
blocks green work).

**Consequences.**
- (+) Catches the worst failure mode review can miss — a test that never exercises the code.
  **Proven** in `tests/re-witness-red/` (the vacuous test was caught; good test passed).
- (−) **Boundary:** P1-strip only catches *non-dependent* tests. A test that imports the code but
  asserts weakly (e.g. only the return *type*) still slips through — that needs a P2 mutant,
  deliberately not shipped (the study said the mutant's cost isn't yet justified).
- (−) Relies on the agent restoring the tree (mandatory step); validated clean in the proof.
- Nearest prior art: swarm-orchestrator's base-vs-patch "Differential Gate" — distinct (proves
  dependence on *the change*, not *the implementation*) and post-hoc, not in-loop.

---

## ADR-0003 — Dry-until-clean critic that injects net-new tasks

**Date:** 2026-06 · **Status:** accepted

**Context.** Superpowers executes a *pre-written* plan; its fix-loops retry the same task and
never add new ones. Unattended whole-goal builds need to discover and fill gaps without a human.

**Decision.** After each batch, a critic checks the goal against completed work, and if not
clean, emits net-new tasks that are queued and built — looping until the critic says clean or a
`maxRounds` ceiling is hit.

**Consequences.**
- (+) Closes gaps a fixed plan would miss; enables true "hand off a goal" use.
- (−) **Not novel as a mechanism** — CAMEL Workforce (quality-gated decompose/inject),
  Magentic-One (ledger replan), and others ship dynamic task injection. Novel only *in
  combination* with the pure-code coordinator + SDD/TDD discipline + re-witness RED.
- Bounded by `maxRounds` / `maxTasks` to prevent runaway.
