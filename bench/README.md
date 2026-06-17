# Head-to-head bench, superpowers (ARM A) vs ultrapowers (ARM B)

A **reproducible**, apples-to-apples harness that runs the *same* fully-specified task list through
both architectures and measures **token cost** (two meters) and **quality** (a blind pairwise
judge), with N repeats for variance.

> **Honest scope, up front.** The thing this bench can prove cleanly is the **Meter-A
> (coordinator-context) growth difference**, and that is a property of **Anthropic's Workflow
> primitive**, *not* an ultrapowers invention (see [ADR-0001](../docs/decisions/README.md) and
> [`token-benchmark.md`](../docs/benchmarks/token-benchmark.md)). Everything Meter-B at this fixture
> size is a **cost *curve*, not a headline number**, read [§ What this can and cannot
> prove](#what-this-can-and-cannot-prove) before quoting any number. The SDD/TDD discipline both
> arms run is **inherited verbatim from Superpowers** (Jesse Vincent / [@obra](https://github.com/obra)).

---

## 0. What's being compared (and the one irreducible confound)

Both arms execute the **identical SDD/TDD discipline**, the implementer/reviewer prompt text is the
same Superpowers content (`[VERIFIED workflow/ultrapowers-development.js:82-88,146-273]`, ultrapowers
embeds it verbatim, anti-drift-pinned to superpowers `5.1.0`; ARM A invokes the live skill). What
differs is **the coordinator** and **the model routing**.

| axis | ARM A, superpowers | ARM B, ultrapowers | equalizable? |
|------|---------------------|---------------------|--------------|
| coordinator | LLM, the `claude -p` session itself runs SDD | JS Workflow, **0 LLM calls** `[VERIFIED .js:65 (deterministic args parse), :803-828 return-only]` | **NO**, this *is* the independent variable |
| implementer model | chosen by the session per SDD "least-powerful" *guidance*, **not framework-enforced** `[VERIFIED superpowers SKILL.md model-routing is prose, not a parameter]` | `implModel`, default `sonnet` `[VERIFIED .js:99]` | **soft**, pin both to `sonnet`, then **audit** A (§4 F4, §6) |
| reviewer model (spec + quality) | session's choice, SDD says "most capable available model" → opus | hardcoded `opus` `[VERIFIED .js:457,498]` | **YES**, pin A to opus |
| verify / checkpoint | the coordinator runs the test command inline | dedicated `haiku` agents `[VERIFIED .js:399,512,664]` | partial, A has no separable verify agent; this is a real topology difference (§A3) |
| extra mechanisms | none shipped | re-witness-RED + dry-until-clean critic `[VERIFIED README.md:50-51]` | run **two B configs**: `B-parity` (off) + `B-full` (on) |

**The irreducible confound:** ARM A's implementer model is chosen *by an LLM coordinator at dispatch
time*. We can *instruct* the headless prompt to pin implementer=sonnet / reviewers=opus, and that
pin matches what SDD itself recommends, but we cannot *guarantee* obedience the way ultrapowers'
hardcoded `agent(..., {model:'opus'})` guarantees it. We **audit it post-hoc from the transcript**
(§6) and report deviations as a finding, not scrub them. This is a *measurement-honesty* control,
not a fix.

---

## 1. What it measures

### MUST-HAVE metrics (a first benchmark is not credible without these)

1. **Correctness against the spec's own tests**, `node --test` exit 0 *and* all numbered
   acceptance criteria covered. The arm's self-report is **not** the oracle; the fixed task tests
   are. Q1 in the judge is computed **mechanically from the test runner**, never from the LLM judge
   (§A8).
2. **Cost-per-passing-task (price-weighted $)**, total spend (failed attempts, fix-loops,
   escalations included) ÷ externally-verified passes. This is the number that makes a "token-lean"
   claim honest. Reported as `total_cost_usd` (price-weighted) **plus** the per-model breakdown,
   never a raw flat token sum (a haiku token and an opus token bill ~1:60+ apart; §A1).
3. **Variance across seeds (pass@k + cost spread)**, one run is an anecdote; the existing anchor is
   N=1 with no variance bars `[VERIFIED token-benchmark.md:82-83]`. N repeats, full distribution
   published.
4. **re-witness-RED catch count, with the `redWitness:false` A/B**, ultrapowers' *one* headline
   differentiating mechanism. Measured as a **direct count** from the red-witness agent's output, not
   laundered through the quality judge (§A8c).
5. **Failure taxonomy**, *how* it fails, not just that it did. The harness already emits the
   `reason` codes (`impl-failed | fix-failed | no-progress | max-fix-exhausted |
   spec-review-unavailable | budget | max-tasks`) `[VERIFIED .js:812]`; the bench aggregates them.

### Metrics the owner didn't originally track (added here)

The harness return object emits pass/fail + autonomy signals (`needsHuman`, `fallbacks`,
`escalated`, `selfReviewed`, `degraded`, `integration`) but **no** cost, wall-clock, variance,
dispatch-count, or diff-size number `[VERIFIED .js:803-828]`. The bench adds:

- **`total_cost_usd` + per-model `modelUsage` breakdown** (§A1), where the cost actually lives.
- **Meter A (coordinator context) vs Meter B (total billed)** as two *separate* numbers (§6), the
  benchmark doc's own framing `[VERIFIED token-benchmark.md:5-23]`.
- **Dispatch / agent count per arm** (§A3), decomposes "more tokens" into "more dispatches" vs
  "more tokens per dispatch," so B's bookkeeping agents (gate, checkpoint, capture-head) are
  attributed honestly, not smuggled into an efficiency claim.
- **Wall-clock** (`duration_ms`) and, where populated, `duration_api_ms` (better than wall-clock for
  parallel work).
- **Coordinator-model sensitivity**, ARM A run at *both* `--model sonnet` and `--model opus`
  (§A4), because SDD's "standard vs most-capable" tiers leave the coordinator model genuinely
  ambiguous and it swings A's Meter B.
- **Routing-audit / deviation rate** for ARM A (§A5), the fraction of A's subagents that actually
  matched the pinned routing; a finding in its own right.

**Deliberately *not* in this fixture** (scoped out, named so the gap is visible): scaling slope
across large N (needs a 10-/25-task synthetic run, the most strategically important number but
not reachable at N=2; §A6), mutation score, per-task regression rate, crash-resume, reviewer
precision/recall. These are offline/periodic studies, not per-build axes.

---

## 2. Fairness controls (addressing every attack from the fairness critic)

Each control below is keyed to the adversarial review (A1-A12). Where an attack named a flaw that
**cannot** be fixed, the control is to *disclose and attribute it correctly* rather than pretend it
away.

| # | attack it answers | control |
|---|-------------------|---------|
| **F1** | task drift | `bench/tasks.json` is the **only** task source. ARM B reads it as `args.tasks`; ARM A gets it pasted verbatim. `run.sh` asserts a `sha256sum` on it before every run. |
| **F2** | environment variance | every arm/run gets a **fresh `cp -R`** of the byte-identical template (§3), same `package.json`, same pinned Node (`.nvmrc`). **`--bare` is NOT used.** It was the original plan (skip `~/.claude` auto-discovery for isolation) but is non-viable here: `--bare` reads auth only from `ANTHROPIC_API_KEY`/`apiKeyHelper`, so on this OAuth/keychain setup it yields `"Not logged in"` `[VERIFIED claude --help + probe 2026-06-14]`, and it also skips the very auto-discovery both arms depend on, ARM A's superpowers plugin and ARM B's Workflow `[VERIFIED probes: non-bare → superpowers skill loads + Workflow runs by scriptPath]`. **Residual confound, disclosed not pretended away (per §header):** non-bare loads the global `~/.claude/CLAUDE.md` into **both** arms, a *symmetric* shared condition that advantages neither arm differentially, and the same condition under which the accepted pilot ran. |
| **F3** | verify-command parity | `node --test` for both, *and* it is the same command the judge's Q1 re-runs. |
| **F4** | implementer-model parity | both pinned to **sonnet** (B: `implModel:'sonnet'`; A: prompt mandate). **Not** codex/gemini for B, that would change model *and* provider and destroy the comparison. `claude`-direct is the only B implementer that lets us pin the same model as A. The pin is **soft on A → audited** (§6, A5). |
| **F5** | reviewer-model parity | both spec+quality reviewers pinned **opus** (B hardcoded `[VERIFIED .js:457,498]`; A: prompt mandate). |
| **F6** | stage-set parity for the cost comparison | `B-parity` runs `redWitness:false` `[VERIFIED .js:123]` and a **task list** (not a goal) so the critic loop is skipped `[VERIFIED .js:763 \`if (!goal) break\`]`. **Caveat (A3):** this matches the *review* stage set, **not** the full stage set, B still runs gate/checkpoint/capture-head haiku agents A lacks. We do not claim identical stages; we isolate the review stages and attribute B's infra agents to B explicitly. |
| **F7** | commit-discipline parity | both commit per task (B `commit:true` `[VERIFIED .js:77]`; A prompt mandate; SDD commits natively). |
| **F8** | session pollution | ARM A runs in a **fresh `claude -p` process**, the measuring human's interactive session is never the coordinator. |
| **F9** | tool/network variance | tasks are pure-function, zero-dep; nothing fetches. |
| **F10** | fix-loop bound parity | B caps fix rounds at `MAX_FIX=3` `[VERIFIED .js:69]`; A's prompt sets the same cap. |
| **F11** | branch / setup-boundary parity (A11) | the `eval` branch is created **out-of-band by `provision()` for BOTH arms** (not billed to either) so A's prompt does **not** pay in-band for `git checkout -b` while B's branch is set up for free. Plan-approval turns are scoped out of *both* (this measures **post-approval execution only**). |
| **F12** | coordinator-model thumb-on-scale (A4) | ARM A is run at **two** coordinator models (`sonnet` *and* `opus`) and **both** are reported; there is no single "fair" setting because SDD leaves it to in-session judgment. Meter A is robust to this; Meter B is not, which is itself the finding. |
| **F13** | metering topology (A1, A2, A12) | **Headline cross-arm cost = `result.total_cost_usd` + per-model `modelUsage`**, VERIFIED (N=5 campaign, 20 runs) to roll up subagent work for **both** arms (ARM B's `modelUsage` shows haiku+opus+sonnet its JS coordinator never ran). The self-summed stream meter (`meterB`) is cross-arm-valid **only** for arms whose stream carries subagent messages: **ARM A yes** (`agentCount` 7-11), **ARM B no** (`agentCount` **0**, the Workflow runs subagents OFF the `claude -p` stream, so `meterB`==`meterA`). Comparing A's `meterB` to B's is the ~100× trap. `meterA` (coordinator context) stays the decisive flat-vs-growing axis. **Earlier guidance here was inverted; corrected 2026-06-14 against the real transcript.** |
| **F14** | constrained-A vs shipped-B mixing (A9) | results are reported as **two matched pairs only**: `{constrained-A vs B-parity}` (clean coordinator comparison) and `{idiomatic-A vs B-full}` (what-you-actually-get). **Never** a row mixing constrained-A with B-full. |
| **F15** | task cherry-picking (A7) | the fixture probes **only the mechanical, single-file, fully-specified tier**, exactly where a coordinator's value-add is smallest. Every headline is scoped to "on isolated, fully-specified, single-file tasks…" and **must not** be generalized. (A coupled/under-specified task is the named next step, not in this fixture.) |
| **F16** | judge self-preference (A8) | Q1 is mechanical (test runner, not LLM); the LLM judge scores only Q2-Q4. The blind pairwise judge runs **dual-order** (position-bias control) and a **cross-family** second judge is mandated, with inter-judge agreement reported; material disagreement → `INCONCLUSIVE`, not averaged. |

**What stays a confound after all controls (disclosed, not erased):** (a) F4's soft-pin on A's
implementer model, *audited*, not enforced; (b) the coordinator itself, *intentional*, it is the
IV; (c) A's coordinator does extra reading/TodoWrite/scene-setting the JS skips, a **real
architectural cost** correctly attributed to ARM A.

---

## 3. The fixed target-repo template

One template, byte-identical across all arms and runs, lives in `bench/fixtures/target-repo-template/`:

```
package.json   {"name":"bench-target","type":"module","scripts":{"test":"node --test"}}
.nvmrc         the exact `node --version` of the measuring machine (record it)
src/.gitkeep
test/.gitkeep
README.md      one line: "Bench target. Implement tasks under src/, test under test/."
.gitignore     node_modules
```

`node --test` is the verify command, no install step, no dependency-resolution variance,
deterministic exit code. `type: module` so `import` works. Empty `src/`/`test/` so every task
starts blank. A Node minor bump can change `node:test` output and perturb the judge, so the version
is pinned and recorded.

`provision()` (identical for every arm/run): `cp -R` the template, `git init`, an initial commit,
then `git checkout -b eval` **out-of-band** (F11). The template ships in this repo; `run.sh`
re-creates it if missing.

---

## 4. The benchmark tasks

Two fixed, dependency-free, `node:test`-verifiable tasks, both embedding red/green criteria:

- **`bench/tasks/string-utils.md`**, `slugify` (small, mechanical; tests the cheap-model tier).
- **`bench/tasks/parse-duration.md`**, `parseDuration` (medium; decimals, error/throw paths, an
  explicit YAGNI/single-responsibility constraint, so the *reviewer* role does observable work and
  the quality judge has something to discriminate on).

The machine-readable single source of truth is **`bench/tasks.json`**, the `[{id, spec}]` shape
ultrapowers' `args.tasks` wants `[VERIFIED .js:48,73]`, and the same bytes pasted into ARM A's
prompt. The `.md` files mirror it for humans; `run.sh` regenerates `tasks.json` from a heredoc and
`sha256sum`-pins it.

Both tasks are self-contained (no cross-task coupling) → fair to run as an independent 2-task list
in either coordinator. **This is also the fixture's ceiling (F15/A7):** it cannot see the
cross-task-coupling / ambiguous-spec regime where a coordinator architecture would actually diverge
on quality.

---

## 5. How to run both arms

Prereqs: `node` ≥ 18 (pin matches `.nvmrc`), `jq`, `git`, and the `claude` CLI on `PATH`. ARM B
additionally needs the `ultrapowers-development` Workflow + `/ultrapowers` command loaded in the
session that `claude -p` starts (they load at session start).

```bash
# one run of each arm (smoke test)
bash bench/run.sh --runs 1

# the real campaign (N per arm; see §7 on N)
bash bench/run.sh --runs 10
```

`run.sh` is idempotent: it writes everything under `bench/results/<timestamp>/` and a fresh
`bench/runs/<arm>/<id>/repo` per execution; re-running never reuses a dirty tree. For each
`run_id × arm ∈ {A-sonnet, A-opus, B-parity, B-full}` it:

1. **PROVISION** a fresh template (§3).
2. **EXECUTE** the arm's `claude -p` command (both arms are launched headless, so both emit the same
   stream-json event shape, the premise of identical metering, which F13/A12 says you must
   *prove*, not assume).
3. **METER** Meter A + Meter B from the transcript (§6).
4. **COLLECT** `src/` + `test/` + `verify.txt` + `gitlog.txt` for the judge (§8).

### ARM A, superpowers, headless

```
( cd "$repo" && claude -p \
    --model "$COORD_MODEL"   # sonnet AND opus, two runs (F12/A4)
    --output-format stream-json --verbose \
    --permission-mode bypassPermissions \
    --append-system-prompt "Headless bench run; no human is watching; never ask to continue." \
    "$PROMPT" ) > transcript.jsonl 2> stderr.log
```

`$PROMPT` invokes `superpowers:subagent-driven-development` on the **same `tasks.json` bytes**, and
**mandates the fairness pins** (implementer=sonnet, both reviewers=opus, verify `node --test`,
per-task commit, ≤3 fix rounds, **no** added tasks/critic/re-witness, do the final integration
review). The `eval` branch already exists (F11), so A is told to work on it, A does **not** create
it in-band.

### ARM B, ultrapowers (`B-parity` and `B-full`)

```
( cd "$repo" && claude -p --output-format stream-json --verbose \
    --permission-mode bypassPermissions \
    "Call the Workflow tool with scriptPath <repo-root>/workflow/ultrapowers-development.js and args:
       { tasks: <tasks.json>, repoDir: <repo>, verifyCmd: 'node --test',
         implementer: 'claude', implModel: 'sonnet', commit: true,
         <redWitness:false for B-parity only> }
     Return the Workflow's final JSON result verbatim." ) > transcript.jsonl 2> stderr.log
```

`tasks` (not `goal`) ⇒ critic skipped `[VERIFIED .js:763]`. `redWitness:false` strips re-witness for
`B-parity` `[VERIFIED .js:123]`; `B-full` leaves it on (the *only* delta, still tasks-only, so no
critic). **Report `B-full` separately; never average it with `B-parity`** (F14): its extra tokens
buy the re-witness test-integrity guarantee, a feature comparison, not a cost-fairness comparison.

### B-v5 vs B-v6 (merge A/B)

Measures the cost/dispatch delta of the v6 engine rewrite relative to the pre-upgrade v5 baseline,
without shipping any dead v5 code. Both arms mirror `B-parity` exactly — same `tasks.json`,
`implementer:'claude'`, `implModel:'sonnet'`, `commit:true`, `redWitness:false`, tasks-only (no
critic). The only difference is the engine path supplied to `scriptPath`:

- **B-v5**: pre-upgrade engine materialized from git history via
  `git show <PRE_UPGRADE_SHA>:workflow/ultrapowers-development.js` into a temp file. `PRE_UPGRADE_SHA`
  is the merge-base of `main` and the upgrade branch (`bce9dc53b1d79bd5a6f7fdca94caf1f79a5e1ff1`).
- **B-v6**: current engine at `workflow/ultrapowers-development.js` (the post-upgrade source of truth).

**Primary metrics:**

| Metric | Description |
|---|---|
| `reviewDispatches / task` | Count of `review-(task\|spec\|quality):` subagent labels per task — the v6 structural change merges two review stages, so this should drop from ~2/task (v5) to ~1/task (v6). |
| `total_cost_usd` | Headline cost rollup (includes all subagents); derived from `result.total_cost_usd` in the transcript. |

**Guard:** quality parity via the existing judge (same `src/` + `test/` collect + `verify.txt`
output). A regression in `node --test` pass rate invalidates the cost saving.

**Reporting requirements (N≥5):**

1. Raw per-run table: `arm`, `run`, `reviewDispatches`, `total_cost_usd`, `wallMsScript`.
2. Bootstrap CI (1000 resamples, 95%) on both primary metrics.
3. Judge quality scores by arm (must be non-inferior: B-v6 ≥ B-v5 mean − 0.5 points).

Run: `bash bench/run.sh --runs 5 --arms "B-v5 B-v6"`.

---

## 6. Token-accounting recipe

Two meters (the benchmark doc's framing `[VERIFIED token-benchmark.md:5-23]`):

- **Meter A, coordinator / main-session context:** tokens accumulating in the *controlling*
  context. The axis ultrapowers wins structurally (flat ~2k `[VERIFIED token-benchmark.md:65]`).
- **Meter B, total billed:** Σ of every subagent's usage. The bill.

### The non-negotiable rule (F13 / A1 / A2), CORRECTED 2026-06-14

> **The cross-arm cost headline IS `result.total_cost_usd` + per-model `modelUsage`.** VERIFIED
> against the N=5 campaign (`bench/results/20260613-205219.json`, 20 runs): it rolls up subagent work
> for **both** arms, ARM B's `modelUsage` carries haiku+opus+sonnet tokens its JS coordinator never
> spent (the disposable review/verify subagents ARE included). The earlier rule here (forbid
> `total_cost_usd`, self-sum the stream) was **backwards for this CLI** and is retracted.
>
> **The self-summed stream meter (`meterB`) is cross-arm-valid ONLY when the stream carries subagent
> messages.** ARM A: yes (`agentCount` 7-11, `meterB` ≫ `meterA`). ARM B: **no**, the Workflow runs
> subagents off the `claude -p` stream, so `agentCount==0` and `meterB`==`meterA` (coordinator-only).
> Cross-comparing A's `meterB` (subagents in) to B's `meterB` (subagents out) is the ~100× artifact.
> `run.sh meter()` now emits `streamCarriesSubagents` + `headlineCostUsd` per record to make this
> explicit.
>
> `meterA` (coordinator context, `parent_tool_use_id==null`) remains the decisive **flat-vs-growing**
> axis and is unaffected.

Meter B, **identically for both arms**, sum `usage` over **all** assistant messages, **deduplicated
by message `id`** (parallel tool calls share an id and the docs warn they carry identical usage),
*including* subagent messages:

```bash
# Meter B, total billed (cache-aware), dedup-by-id, subagents included.
jq -s '
  [ .[] | select(.type=="assistant") | .message ] | unique_by(.id)
  | { input:        ([.[].usage.input_tokens]                       | add),
      output:       ([.[].usage.output_tokens]                      | add),
      cache_create: ([.[].usage.cache_creation_input_tokens // 0]   | add),
      cache_read:   ([.[].usage.cache_read_input_tokens // 0]       | add) }
' transcript.jsonl
```

```bash
# Meter A, coordinator context only: usage on TOP-LEVEL (non-subagent) events.
# For ARM B this is ~the return object; for ARM A it is the SDD coordinator's own growing turns.
jq -s '
  [ .[] | select(.type=="assistant" and (.parent_tool_use_id|not)) | .message ] | unique_by(.id)
  | { input:[.[].usage.input_tokens]|add, output:[.[].usage.output_tokens]|add }
' transcript.jsonl
```

```bash
# Price-weighted $ + per-model breakdown, the honest Meter-B headline (NOT raw tokens, A1).
jq -s '.[] | select(.type=="result") | {total_cost_usd, duration_ms, duration_api_ms, modelUsage}' \
  transcript.jsonl
```

> **TODO (pin before any campaign, do NOT fabricate):** the exact stream-json field names
> (`.message.usage.*`, the subagent-tagging field, assumed `parent_tool_use_id`) are
> **`[UNKNOWN]` until pinned against a real transcript** from *your* installed `claude` version.
> `headless.md` confirms `--output-format json` carries `total_cost_usd` + a per-model cost
> breakdown and that `stream-json --verbose` emits per-message events, but does **not** spell out
> the `usage`/`parent_tool_use_id` field names. The cost-tracking/subagents docs do
> `[VERIFIED]`, but versions drift. `run.sh` marks every place a real CLI value must land with a
> `TODO(real-cli)` so a fabricated number can never slip in. **Prove the B stream actually carries
> every subagent's usage** (`count(assistant subagent messages) == agent_count` from the Workflow
> result) before trusting B's Meter B (A12); if it doesn't, read `subagent_tokens` from the Workflow
> result and confirm it is the *same quantity/units* as A's stream sum.

**Cross-check (A2):** for ARM B, compare the stream-derived Meter B against the Workflow's own
reported `subagent_tokens`/`agent_count` (the `wf_7ad7c92f-406` anchor came from that field
`[VERIFIED token-benchmark.md:54,61]`). Two independent counts catch metering bugs; **if they
disagree, stop and fix before the campaign.**

**Routing audit (A5, F4):** for each ARM-A run, parse the transcript for the `model` of every
implementer/reviewer subagent; report `% matched the pinned routing`. Runs with <100% match are a
**separate stratum** ("A-as-instructed" vs "A-as-routed"), each with its own N, the deviation rate
is itself a headline finding, **never pooled** into one A number.

**Expected shape (so a bug is obvious):** Meter A, large & task-growing for A, tiny & flat for B
(~2k `[VERIFIED token-benchmark.md:65]`). Meter B at this small N, A *may be cheaper total* (B has
more review stages, no N² tax to amortize at N=2; the benchmark doc predicts exactly this
`[VERIFIED token-benchmark.md:35,74-77]`). Report it honestly; a Meter-B "win" here would be false.

---

## 7. How variance is reported

- **N per arm.** The harness's own run-to-run token noise is ±20% `[VERIFIED token-benchmark.md:20]`;
  the anchor was N=1 with "no variance bars" `[VERIFIED token-benchmark.md:82-83]`. **N = 10**
  recommended (4 arms × 10 = 40 runs); **N = 5 minimum**; **never N = 1**.
- **Per arm, per meter:** median (robust to a runaway outlier), mean, SD, min/max, **and the full
  N×raw table** (publish the table, not just summary stats, OSS honesty).
- **Stat test:** N is small and the distribution is non-normal (and bimodal once BLOCKED runs are
  included), so use a **bootstrap CI on the difference** (and/or Mann-Whitney U), and **state the
  null explicitly**, non-significance is reported as *"not distinguishable at this N,"* **never** as
  "proven equivalent" (absence of evidence ≠ evidence of absence; A10).
- **Stratify cost by success (A10):** a 2/2-pass run and a BLOCKED run are **not** blended into one
  cost distribution. Report *cost | success* separately from an independent *success-rate*
  comparison.
- **Failure accounting:** a run that didn't reach 2/2 passing (`node --test` red, or a task BLOCKED)
  is a **quality-0 / incomplete** data point, **not dropped**, dropping failures biases cost toward
  the easy runs.
- **Power honesty:** at ±20% noise, N=10 detects only a sizeable cost gap. State the minimum
  detectable effect; anything smaller is "not distinguishable here."

---

## 8. The blind quality judge

`bench/judge.mjs` is a thin wrapper over the repo's existing, verified
[`tools/quality-diff.mjs`](../tools/quality-diff.mjs) (blind, dual-order position-bias control,
fail-closed evidence-bearing rubric, TIE/INCONCLUSIVE as first-class verdicts). The wrapper adds
**Q1-is-mechanical** and the **cross-family second judge** the fairness review demands (A8/F16).

Flow per matched pair (`A vs B-parity`, `A vs B-full`), per task:

1. **Q1 mechanical**, re-run `node --test` in each arm's collected output; `exit 0` *and*
   coverage of every numbered acceptance criterion is a deterministic pass/fail. The LLM judge is
   **not** consulted for Q1 (A8a).
2. **Blind pairwise Q2-Q4**, feed each arm's diff into `tools/quality-diff.mjs` (the judge sees only
   `LEFT`/`RIGHT`, randomized order, twice with orders swapped). Dimensions: `test_integrity`,
   `yagni`, `idiom`, `edge_cases` (the existing rubric; `spec_correctness` is downweighted because
   Q1 already covers correctness mechanically).
3. **Cross-family**, run the same blind prompts on a second judge family (opus **and** a
   gemini/codex CLI) and report inter-judge agreement; material disagreement → that dimension is
   `INCONCLUSIVE`, not averaged (A8b).
4. **re-witness-RED count (A8c)**, B-full's test-integrity edge is reported as a **direct count of
   vacuous tests caught** (read from the red-witness agent output / the harness `minors`/return),
   **not** as an LLM Q2 score. The honest claim is "re-witness mechanically removed N vacuous tests,"
   with N, not "the judge thinks B's tests are better."

**Blinding:** outputs are copied into `judge-pool/<uuid>/` with a sealed `uuid → (arm, run)` map;
arm labels and `[task:…]`-style commit hints are stripped before judging. Aggregate per-arm Q-means
+ pairwise win-rate, with per-item raw scores published.

---

## 8.2 Safety-path fixture (B-v6 only, H4)

`bench/safety-run.sh` is a second fixture that exercises the v6 engine's risky paths. It is
**B-v6 only** — these paths do not exist in v5 — and asserts **pass/fail outcomes, not cost**.

### What it covers

| Scenario | Task ID | Assertion |
|---|---|---|
| `cannot_verify` routing | `cross-task-coupled` | `result.cannotVerify` must be non-empty |
| Spec-fail block | `spec-incomplete` | `"spec-incomplete"` must NOT appear in `result.passed` |
| Multi-commit `BASE..HEAD` | `config-module` + `cross-task-coupled` | Integration review sees ≥2 commits; ⚠️ checklist item must surface |

The three tasks live in `bench/fixtures/safety-tasks.json`. Human-readable mirrors:

- `bench/tasks/cross-task-coupled.md` — cross-task coupling that triggers `cannotVerify`
- `bench/tasks/multi-commit.md` — documents the multi-commit integration scenario
- `bench/tasks/spec-incomplete.md` — intentionally omissible export for spec-fail testing

### Running

```bash
# syntax check + offline file-shape assertions only (no claude required):
bash -n bench/safety-run.sh
bash bench/safety-run.sh   # exits 0 with "skipping live run" if claude not on PATH

# live run (requires claude CLI + Workflow):
bash bench/safety-run.sh
# → "safety-path ok" on success
```

### What it does NOT measure

This fixture measures correctness of the safety paths, not token cost or quality. Do not cross-compare
its outcomes against the cost metrics in `§5` / `§6`. Cost measurements for B-v5 vs B-v6 use the
standard `bench/run.sh --arms "B-v5 B-v6"` harness with `bench/tasks.json`.

---

## What this can and cannot prove

**CAN prove (survives every fairness attack):**

> **Coordinator-context (Meter A) is flat-and-tiny for the JS-Workflow arm and grows with run
> length for the in-session arm.** This is robust to the coordinator-model choice (A4), independent
> of the subagent-rollup `[UNKNOWN]` (A2, Meter A is the non-subagent slice you can isolate
> cleanly), and is **a property of Anthropic's Workflow primitive, not ultrapowers' invention**
> `[VERIFIED ADR-0001, token-benchmark.md:12]`. ultrapowers' contribution is *choosing to host SDD
> on it.* To land it, report it as a **slope across N**, not a single N=2 point (A6).

**CANNOT prove (qualitative-only at this fixture):**

- **No honest single "B is X% cheaper/more expensive total" headline at N=2.** The rollup question is
  unresolved (A2); the two meters sum different model-priced work (A1); B runs more discrete stages
  (A3); A's coordinator-model knob swings the result (A4). The most you can say is the *shape*: a
  wash-or-slight-A-win at small N, with B's total-billing advantage a **large-N / long-build**
  property this fixture does not reach `[VERIFIED token-benchmark.md:35,74-77]`. Quoting an N=2
  Meter-B number as a verdict would be false.
- **Quality is expected to be near-parity**, identical SDD prompts + identical pinned models ⇒
  identical discipline. The one defensible *difference* is **B-full's re-witness-RED removing vacuous
  tests**, reported as a count (above), and that is ultrapowers' *one* scarce mechanism on top of
  superpowers' inherited discipline. If `B-parity` beats A on quality at matched models/prompts,
  that is a **surprising** result demanding scrutiny, not a victory lap.
- **Generalization beyond isolated, fully-specified, single-file tasks is out of scope** (A7). The
  coordinator's real value-add (cross-task coupling, ambiguous specs, mid-build replanning) is
  exactly what this fixture engineered out.

**Honest headline:** *same discipline, same models, same quality, the difference is
coordinator-context cost (Meter A), which is structural and grows with run length.* Credit to Jesse
Vincent / [@obra](https://github.com/obra) for the discipline this entire comparison rests on;
ultrapowers complements Superpowers for the unattended-long-build niche, it does not replace it.
