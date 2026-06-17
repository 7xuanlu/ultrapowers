# Design spec: upgrade the ultrapowers harness to Superpowers v6 parity

*Status: design, approved after adversarial council review (Claude + Codex + Gemini). Date: 2026-06-17.*
*Re-syncs the embedded Superpowers discipline from the pinned 5.1.0 to 6.0.0, whose headline change
is **merging the two per-task reviewers into one**. The council returned approve-with-changes and
found four code-verified safety gaps in the first draft; all four are folded in here as
controller-level invariants (§6) — moving the merged reviewer's safety from prompt-trust into the
deterministic JS coordinator, which is the point of ultrapowers.*

## 1. Summary

Superpowers 6.0.0 collapses the two per-task reviewer prompts (`spec-reviewer-prompt.md` +
`code-quality-reviewer-prompt.md`) into **one** `task-reviewer-prompt.md` that reads the task's
scoped diff **once** and returns both a spec verdict and code-quality findings. It also adds a third
spec verdict tier (⚠️ "cannot verify from diff"), hardens the reviewer (read-only, don't re-run the
suite, anti-rationale), hands the diff as a file via a `review-package` script, and adds TDD-evidence
to the implementer report.

ultrapowers currently pins 5.1.0 `[VERIFIED workflow/ultrapowers-development.js:88]` and runs a
two-stage **gated** review: `reviewSpec` (opus) first, then `reviewQuality` (opus) **only if spec
passes** `[VERIFIED :440-510,597-605]`. This spec upgrades the harness to v6 parity, keeping every
existing safety property (severity-derived blocking, fail-closed-on-reviewer-error, the fix-loop +
thrash guard, re-witness RED, crash-resume) and adding the four hardenings the council required.

The upgrade is **full v6 parity** (user decision): the merge, the prompt hardening, the
`review-package` diff-file handoff, the durable-progress ledger, the implementer TDD-evidence, and
the pin re-sync. Items genuinely redundant for a deterministic JS coordinator are skipped with
rationale (§7).

## 2. Goals / non-goals

**Goals**
- Replace `reviewSpec` + `reviewQuality` with one `reviewTask` (opus), faithful to v6
  `task-reviewer-prompt.md`, with **no loss** of the existing blocking/fail-closed semantics.
- Handle the new ⚠️ `cannot_verify` tier safely in unattended mode (no human mid-run).
- Port the v6 reviewer hardening, the `review-package` diff-file handoff, the implementer
  TDD-evidence/cadence, and the durable-progress ledger.
- Re-sync the embedded-prompt pin 5.1.0 → 6.0.0.
- Validate with a benchmark that measures **both** the cost/dispatch win **and** the new
  safety-critical paths (§8).

**Non-goals**
- Changing the implementer routing, the codex/gemini delegation, re-witness RED, the critic, or any
  escalation/gate logic beyond what the merge requires.
- Confidence-gated verification, N-verifier panels, P2-mutant testing (separate roadmap items —
  `[VERIFIED docs/design/gating-and-escalation.md:92-115]`).
- Re-running the public superpowers-vs-ultrapowers A-vs-B comparison (a later, separate study).

## 3. Current state (what changes)

Per-task path today `[VERIFIED workflow/ultrapowers-development.js:566-624]`:

```
captureHead(BASE) → implement → triageConcerns → gate(verify) → re-witness-RED
   → reviewSpec(opus)            [blocking = findings{critical|important}; fail-CLOSED on error]
   → if spec passes: reviewQuality(opus)   [same blocking rule; fail-CLOSED]
   → blocking? fix-loop (MAX_FIX=3, stall/thrash guard) : pass
final (if passedIds): integration review(opus)  [approved:false gates top-level ok]
crash-resume: JSONL checkpoint {id,ok,by,reason} via loadDone()/checkpoint()
```

Key invariants that MUST survive the merge:
- `blocking = rev.findings.filter(critical|important)` `[VERIFIED :59]` drives the fix-loop; minor
  logged not fixed.
- A reviewer tool-error returns `{approved:false, unavailable:true}` → `needsHuman`, never a silent
  pass `[VERIFIED :468,509,592,599]`.
- `ok` (top-level safe-to-merge) is true only if no failures/needsHuman, integration not
  disapproved, no ceilings, not degraded `[VERIFIED :816-818]`.

## 4. What Superpowers v6.0.0 changed (verified verbatim, this turn)

Sources: local 5.1.0 `~/.claude/plugins/cache/claude-plugins-official/superpowers/5.1.0/skills/`;
v6 `raw.githubusercontent.com/obra/superpowers/main/skills/` (plugin.json version `6.0.0`).

1. **Reviewer merge.** Two prompts → one `task-reviewer-prompt.md`: one subagent, one diff read, two
   verdicts (Part 1 Spec Compliance, Part 2 Code Quality).
2. **⚠️ third spec tier.** `pass` / `fail` / **`cannot_verify`** — the latter when "a requirement
   cannot be verified from this diff alone (it lives in unchanged code or spans tasks)"; the reviewer
   reports it instead of crawling; the controller resolves it (v6 SKILL §"Handling Reviewer ⚠️
   Items").
3. **Reviewer hardening:** read-only on the checkout; do **not** re-run the full suite (the
   implementer already ran it + reported TDD evidence — run a focused test only on a named doubt);
   anti-rationale ("a stated rationale never downgrades a finding's severity"); read the diff file
   **once**, don't crawl.
4. **Diff as a file** via `scripts/review-package BASE HEAD`: commit list + `git diff --stat` +
   `git diff -U10 BASE..HEAD`, using the recorded **BASE** (not `HEAD~1`, which drops all but the
   last commit of a multi-commit task).
5. **Implementer:** brief as a file; test-cadence ("focused test while iterating, full suite once
   before commit"); mandatory **TDD-Evidence** (RED cmd+failing output / GREEN cmd+passing output) in
   the report; after-review fixes re-run covering tests and append results.
6. **Durable-progress ledger** (`progress.md` under the git dir); **model-required on every
   dispatch** (omitted model inherits the priciest).
7. **Embedded bodies:** TDD `SKILL.md` byte-identical except one `@import`→markdown-link;
   implementer "Code Organization" + "When You're in Over Your Head" byte-identical.

## 5. The upgrade design

### 5.1 The merged reviewer — `reviewTask`

Replace `reviewSpec` + `reviewQuality` with one opus agent. New schema:

```js
const TASK_REVIEW = { type:'object', required:['specVerdict','approved'], properties:{
  specVerdict: { enum:['pass','fail','cannot_verify'] },
  findings:    { type:'array', items:{ type:'object', required:['severity','dimension','issue'],
                 properties:{ severity:{enum:['critical','important','minor']},
                              dimension:{enum:['spec','quality']}, issue:{type:'string'}, fix:{type:'string'} } } },
  cannotVerify:{ type:'array', items:{ type:'string' } },   // ⚠️ items + what the controller should check
  strengths:   { type:'array', items:{type:'string'} },
  assessment:  { type:'string' },
  approved:    { type:'boolean' } } }
```

Prompt = faithful port of v6 `task-reviewer-prompt.md`: Part 1 Spec Compliance (missing / extra /
misunderstood; emit ⚠️ for out-of-diff requirements instead of crawling), Part 2 Code Quality
(separation of concerns, error handling, DRY-without-premature-abstraction, test validity, file
structure), Do-Not-Trust-the-report incl. the anti-rationale clause, Tests (do **not** re-run the
suite — impl already reported TDD evidence), read-the-diff-file-once + read-only + don't-crawl, and
the calibrated severity tiers. Output carries `specVerdict`, `findings[{severity,dimension}]`,
`cannotVerify[]`, `strengths`, `assessment`.

Cost effect: one combined opus review per round vs today's 1 (spec-fail) to 2 (spec-pass). Net fewer
dispatches; one diff read instead of two.

### 5.2 Control flow in `buildTask`

```
gate → re-witness-RED → reviewPackage(BASE) [haiku] → reviewTask(diffFile) [opus]
   blockingNow = rev.findings{critical|important}
   specFail   = rev.specVerdict === 'fail'                 (H1)
   if (specFail || blockingNow.length)  → fix-loop          (H1: fail blocks even with 0 findings)
   else                                  → pass; accumulate rev.cannotVerify[]   (H2: also persisted)
```

The thrash guard, `MAX_FIX`, and fix-loop are unchanged; the only change is `specFail` joining the
block condition. Reviewer-error fail-closed (`{approved:false, unavailable:true}` → `needsHuman`) is
unchanged.

### 5.3 ⚠️ `cannot_verify` → integration review (fail-closed, §6 H3)

The per-task reviewer **never blocks** on a `cannot_verify` item (it's "I can't see this from my
slice", not a defect). The harness accumulates `cannotVerify[]` across passed tasks and hands the
list to the final integration review as an explicit checklist: *"Confirm each of these
cross-task / unchanged-code requirements is actually satisfied in the whole tree; set
`approved:false` with a critical finding if any is a real gap."* The integration review already has
the whole-tree context the diff-scoped per-task reviewer deliberately lacks. **Made fail-closed in
§6.**

### 5.4 `reviewPackage` (diff-file handoff)

New cheap helper (haiku): runs `git -C <repo> log --oneline BASE..HEAD`, `git diff --stat BASE..HEAD`,
`git diff -U10 BASE..HEAD`, writes them to `$(git rev-parse --git-path sdd)/review-<base7>..<head7>.diff`,
returns the path. `reviewTask` is handed the path and told to read it once; prompt fallback: "if the
file is missing, run `git diff BASE..HEAD` yourself" (matches v6). Uses the recorded **BASE** so
multi-commit tasks stay intact.

### 5.5 Implementer brief

Add to the brief: the test-cadence line; a required **TDD-Evidence** block in the report
(`IMPL` schema gains optional `tddEvidence:{red,green}`); and an after-review-findings instruction in
fix-loop briefs ("re-run the tests covering the amended code; include the results"). This is what
licenses the reviewer's "don't re-run the suite" discipline.

### 5.6 Durable-progress ledger (additive)

Alongside the JSONL checkpoint (which stays the **functional resume source of truth**), also append
a human-readable line `Task <id>: complete (commits <base7>..<head7>, review clean)` to
`$(git rev-parse --git-path sdd)/progress.md`. Folded into the existing `checkpoint` haiku agent (no
new dispatch).

### 5.7 Pin re-sync → 6.0.0

`SP_VERSION='6.0.0'`. Re-point the header re-sync comment to v6 paths (`task-reviewer-prompt.md`;
`requesting-code-review/code-reviewer.md`). The embedded `TDD_SKILL` and `SDD_GUIDANCE` bodies are
byte-identical to v6, so **no text change** — only the pin + comment. `checkSpDrift()` is unchanged
(it lists installed version dirs and compares to the pin).

## 6. Required hardenings (council, code-verified) — controller-level invariants

The first draft relied on the reviewer **prompt** to keep three safety invariants. The council
verified against the engine that the **controller** does not enforce them. All four move into code.

- **H1 — `specVerdict='fail'` is an unconditional controller-level block.** `blocking()` derives
  blocking from `findings[].severity` only `[VERIFIED :59]`; a `fail` verdict with empty/minor
  findings would return `ok:true` and ship a spec violation. Fix: the pass condition is
  `specVerdict !== 'fail'` **AND** no critical/important findings. A `fail` always enters the
  fix-loop regardless of finding severity.
- **H2 — persist `cannotVerify[]` across crash-resume.** `checkpoint()` persists only
  `{id,ok,by,reason}` `[VERIFIED :669]` and `loadDone()` reads back ids only `[VERIFIED :660-663]`;
  resume skips done tasks and never regenerates them, so accumulated ⚠️ items are lost and the
  integration review never sees them. Fix: write `cannotVerify` (+ `base`/`head`) per task line in
  the JSONL; on resume, rebuild the accumulated `cannotVerify[]` from the log.
- **H3 — fail-closed ⚠️ gate.** Integration runs only `if (passedIds.length)` `[VERIFIED :797]` and
  a null integration does **not** block `ok` (`!integration` passes) `[VERIFIED :817]`. A last-task
  ⚠️ or a zero-passed run orphans ⚠️ resolution. Fix: if accumulated `cannotVerify[]` is non-empty,
  require `integration && integration.approved === true`; otherwise `ok:false` + `needsHuman` (a new
  `reason:'unverified-cross-task'`).
- **H4 — benchmark must exercise the risky paths.** slugify/parseDuration are pure single-file
  happy-path tasks that never emit `cannot_verify`, never multi-commit, never spec-fail. Fix: add a
  **safety-path fixture** (§8.2).

## 7. Deliberately skipped (redundant for a deterministic JS coordinator)

- **Implementer-brief file-handoff.** ultrapowers dispatches a **fresh** subagent per task with only
  minimal threaded context (issues + changed files + summary), never pasted accumulated history
  `[VERIFIED :289-303,345-360]`, so the v6 "pasted text stays resident in the coordinator context"
  motivation does not apply. (The *reviewer* diff-file IS adopted — §5.4 — for the read-once
  discipline + a deterministic snapshot, per the full-parity decision.)
- **Narration cap** — no LLM coordinator to narrate.
- **Model-required-on-dispatch** — already satisfied: every `agent()` call pins a model
  `[VERIFIED :347,359,368,406,432,464,505,519,535,554,637,653,662,671,680,699,717,800-810]`.

## 8. Benchmark

### 8.1 Happy-path A/B (cost / dispatch) — the existing harness

**B-v5** (pre-upgrade engine: two-stage gated review, invoked via `scriptPath` pointing at the
pre-upgrade git ref so the shipped engine carries no dead v5 path) vs **B-v6** (merged reviewer).
Held constant: same `tasks.json` (slugify, parseDuration), `implementer:'claude'`,
`implModel:'sonnet'`, reviewers `opus`, tasks-only (critic skipped), byte-identical fixture
`[VERIFIED bench/README.md:122-143,209-224]`.

- **Primary:** review dispatches/task (expect 2→1 on spec-pass); `total_cost_usd` + per-model
  `modelUsage` (expect lower opus review tokens); wall-clock.
- **Guard:** quality parity via the existing blind dual-order judge with mechanical Q1
  `[VERIFIED bench/README.md:336-361]`.
- **N ≥ 5**, full raw table + bootstrap CI on the cost delta `[VERIFIED bench/README.md:314-331]`.
- **Hypothesis:** same quality, fewer review dispatches, lower review cost/task.

### 8.2 Safety-path fixture (H4) — new

A second fixture that actually generates the new paths, run B-v6-only (these paths don't exist in
B-v5) with pass/fail assertions, not a cost comparison:

- **⚠️ generator:** a task whose acceptance criterion references **another task's unchanged module**
  → the per-task reviewer must emit `cannot_verify`, and the integration review must resolve it
  (assert: ⚠️ accumulated, integration ran, gap caught or confirmed).
- **multi-commit task:** a task committed in ≥2 commits → assert the review package spans
  `BASE..HEAD` (not just the last commit).
- **spec-fail task:** a deliberately spec-incomplete implementer brief → assert `specVerdict='fail'`
  blocks (H1) even if findings are empty/minor, and the fix-loop fires.
- **crash-resume of ⚠️:** kill after a ⚠️-emitting task, resume → assert `cannotVerify[]` is rebuilt
  from the log and still reaches the integration review (H2).

### 8.3 Watch-item

A single merged reviewer is one fewer independent opus draw and may dilute spec-vs-quality
attention (council caveat; v6 accepts the tradeoff). The §8.2 spec-fail + a quality-discriminating
task partially cover it; report quality-parity explicitly and flag any regression rather than
assuming parity.

## 9. Acceptance criteria

1. `reviewTask` replaces both reviewer functions; `tests/check-engine.sh` and any schema checks pass.
2. H1: a `specVerdict='fail'` with empty findings enters the fix-loop and never yields `ok:true`
   (unit/path test).
3. H2: after a simulated crash-resume, a prior task's `cannotVerify[]` is present in the rebuilt
   accumulator (test against a seeded JSONL).
4. H3: a run with a non-empty `cannotVerify[]` and a null/disapproved integration returns
   `ok:false` + `needsHuman:['…']` with `reason:'unverified-cross-task'`.
5. `reviewPackage` writes a `BASE..HEAD` diff file; multi-commit BASE is honoured.
6. Pin = `6.0.0`; `checkSpDrift` reports no drift against an installed 6.0.0; embedded bodies
   unchanged.
7. §8.1 happy-path A/B run (N≥5) shows ≤ the v5 review-dispatch count and no quality regression;
   §8.2 safety-path assertions all pass.

## 10. Risks

- **Merge dilutes review quality** (council) — mitigated by §8.2/§8.3; reversible (the v5 two-stage
  path is preserved in git history if a split must return).
- **`cannot_verify` over-emission** on a large existing codebase could flood the integration review —
  acceptable for the unattended/greenfield-leaning target; monitor the count, cap if needed.
- **`review-package` adds one haiku dispatch/review round** — council confirmed this is a cost nit,
  rolled up in `modelUsage`, not a correctness issue.

## 11. Provenance

SDD/TDD discipline inherited verbatim from Superpowers (Jesse Vincent / @obra, MIT). This upgrade
re-syncs that discipline to 6.0.0 and adapts the merged-reviewer architecture to a deterministic JS
coordinator. The four hardenings (§6) came from an adversarial three-lab council (Claude + Codex +
Gemini, 2026-06-17): verdict approve-with-changes, all four findings code-verified against
`workflow/ultrapowers-development.js`.
