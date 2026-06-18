# DRAFT plan, the "correct" SP-vs-UP benchmark: default-routing scaling study

> Status: DRAFT for council review. Not approved, not committed to the campaign.

**NOTE TO EXTERNAL EVALUATORS (council):** this document is **self-contained**. Judge the
experimental **design's logic** from this text alone. Do **NOT** grep any repository, the code it
references lives in an **uncommitted git worktree** and will not match the committed HEAD, so a
grep would falsely report cited symbols as "nonexistent." Line citations are provenance for the
human reader only, not claims to verify against a tree.

## Dimensions to stress-test hardest (the author has repeatedly failed here)
1. **Fairness / anti-strawman**, incl. the *mirror-image* risk (see "fairness trap" below).
2. **Metering rigor**, price-weighted vs raw-token-across-model-mix; reviewer-model parity; rollup.
3. **Statistical & inferential validity + scope**, slope-vs-point; N/variance/MDE; crossover; what it can vs cannot prove.

## Context (established by prior in-repo runs)
- Both systems run the **identical** superpowers SDD/TDD discipline. They differ in **one** thing:
  **where the orchestration loop runs.**
  - **superpowers (SP):** the loop **is** the main-session LLM; its context accumulates per task.
  - **Ultrapowers (UP):** the loop is **deterministic JS (0 LLM calls)**; its LLM calls are
    disposable subagents off the main transcript, so the main session stays ~6 flat turns.
- UP's shipped routing already = **opus**(plan/review/escalate) · **sonnet**(impl) · **haiku**(verify/checkpoint/wrapper).
- **Prior result #1, N=5 @ 2 tasks, fully matched models:** quality **TIE**; cost **TIE**
  (A-opus $4.16 median vs B-full $4.80 median, ranges overlap); coordinator-context ~**8× flatter**
  for UP. The cost tie is because at 2 tasks the coordinator context is tiny (~46 turns) and
  prompt-caching makes re-reads cheap.
- **Prior result #2, a 24-task scale run:** coordinator context A **34K→135K** vs B **flat ~40K**.
  But its cost comparison was **INVALID**: SP was given **sonnet** reviewers while UP ran **opus**
  reviewers (reviewer-parity violation), then raw token counts were compared across different model
  mixes (forbidden). Notably, even that SP-favoring-broken setup showed **SP cheaper** ($16 vs $30)
, so **"SP gets expensive at scale" has NO supporting data yet.**

## The question
Run each system the way it is actually used, **one shared routing policy on both** (opus = review &
SP-coordinate, sonnet = impl, haiku = trivial), at a build **long enough that the architectural
difference materializes.** What is the real difference?

## Independent variable (the only intended difference)
**Where the coordination loop lives.** Under "coordinate = opus": SP runs an opus main session whose
context accumulates; UP runs JS ($0) + disposable opus *planning* subagents. Everything else
(impl = sonnet, review = opus, per-task commit, ≤3 fix rounds, verify = `node --test`) is pinned
identical on both arms.

## Two hypotheses (with honest priors)
- **H1, cost.** SP pays a "coordinator-accumulation tax": every coordinator turn re-reads its
  growing context at the coordinator-model price (cache-discounted). UP pays $0 for the loop.
  **Prior: UNSUPPORTED**, the only scale data (24-task, broken) showed SP *cheaper*. We do **not**
  assume a UP cost-win; we test **whether/where** a crossover exists.
- **H2, capability ceiling.** SP's coordinator context climbs toward its window: sonnet ~200K →
  compaction/failure around task ~35-40 (measured slope ~4-5K/task; 135K at task 24); opus 1M →
  climbs far longer but at opus prices throughout. UP stays flat (~40K) forever. **Prior:
  WELL-SUPPORTED** (context curve already measured). This is the robust, model-fair differentiator,
  **capability/scaling, not cost.** **Confound (council #5):** a sonnet coordinator run *near* its
  ~200K window may also degrade coordination *quality*, so the wall is a **capability-OR-quality**
  limit, not a pure capability limit, labeled as such, and (budget permitting) probed with a
  continuity check at the wall rather than only disclosed.

## Arms (4; two honest matched pairs)
| Arm | coordinator | impl | review | trivial |
|-----|-------------|------|--------|---------|
| A-opus   | opus (main session, accumulates)   | sonnet | opus | inline (no separable tier) |
| A-sonnet | sonnet (main session, accumulates) | sonnet | opus | inline |
| B-full   | JS ($0, flat)                      | sonnet | opus | haiku |
| B-parity | JS ($0, flat)                      | sonnet | opus | haiku (re-witness off) |

Reported as matched pairs **only**: {A-opus vs B-full}, {A-sonnet vs B-parity}. Never a row mixing
A-constrained with B-full.

**B-parity operational definition (council #3), pinned.** B-parity = B-full with **re-witness OFF
only**; it **retains** the haiku verify + capture-head stages that ARM A has no separable equivalent
for. So B-parity is **review-stage-matched** to A, **not** full-stage-matched, its residual haiku
infra agents are attributed to B explicitly, never laundered into a cost-efficiency claim.

## The fairness trap we are guarding against (mirror image of a prior error)
A prior benchmark rigged **against** UP (gave SP cheap sonnet reviewers). The **new** risk is rigging
**for** UP by assuming SP *must* use an expensive opus coordinator. A savvy SP user runs a **cheap**
coordinator (sonnet/haiku) **+ opus review subagents**, keeping the main session cheap while still
getting opus-quality review. Mitigations: (1) run **both** A-opus and A-sonnet, report the envelope;
(2) state plainly that UP's margin over A-sonnet **<** its margin over A-opus; (3) acknowledge SDD
leaves the coordinator model to in-session judgment, so there is **no single "fair" SP coordinator**,
Meter A is robust to this, Meter B is not, and that itself is the finding. (4) **A-sonnet is a
bracket, not a guarantee (council #6):** it brackets the plausible *cheap-coordinator* case but does
not cover SP's full operating space (haiku/mixed coordination, manual context-pruning, compaction);
the envelope's lower bound is labeled an **ESTIMATE**, not ground truth.

## Known confounds (disclosed, not erased)
- **B runs more discrete stages per task** (haiku verify, opus re-witness, capture-head) that A
  lacks → fixed per-task overhead that makes B cost **more** at small N. So the cost curves **cross**:
  small N → B's stage overhead dominates (B costlier); large N → A's accumulation tax *may* dominate
  (A costlier). The benchmark must **find** the crossover N, not assume monotonicity.
- **Prompt caching:** SP's accumulated context is re-read at cache-read prices (~10× cheaper). This is
  why the Meter-A advantage did **not** translate to a $ win at small N. The tax must be **measured,
  not modeled.**
- A's coordinator does extra reading/TodoWrite/scene-setting JS skips, a real architectural cost
  correctly attributed to A.

## Metering rules (every rule a prior run broke)
- Headline cost = **price-weighted `total_cost_usd` + per-model `modelUsage` breakdown.** **Never** a
  raw flat token sum across arms (opus:haiku price ≈ 60:1).
- Report **Meter A** (coordinator context, `parent_tool_use_id==null`) **and Meter B** (total billed,
  dedup-by-message-id, subagents included) **separately.**
- **F5 enforced:** opus reviewers on **both** arms. Post-hoc audit A's actual subagent models from the
  transcript; report deviation rate; <100% match → separate stratum, never pooled.
- Before trusting B's Meter B, **prove** the stream carries every subagent's usage
  (`count(subagent msgs) == agent_count`) and cross-check vs the Workflow's own `subagent_tokens`. If
  they disagree, stop and fix.

## Scale design (a slope, not a point)
- Task-count ladder over the existing accumulating doc-DB fixture: **{6, 12, 24}**, extended to
  **{36, 48}** if needed to cross SP-sonnet's ~200K wall and push total billed past ~600K tokens.
- **Sampling/ordering (council #2), pre-registered.** Each ladder rung is a **cumulative prefix**
  (`run.sh --tasks <fixture> --prefix N` slices the **first N** of the **fixed** ordered fixture),
  **identical task bytes in identical order across every arm and repeat**, sha-pinned after slicing.
  The estimand is therefore **cumulative-work scaling**; per-task difficulty is held constant across
  arms so it cancels in the A−B delta rather than confounding the slope.
- N repeats per cell sized to budget (N ≥ 2; N = 3 preferred at smaller points). **Crossover honesty
  (council #4), pre-committed:** N=2-3 against ~20% run-to-run noise + a bimodal success/BLOCKED
  distribution **cannot localize a cost-crossover N**; we pre-commit to reporting a **null crossover**
  when one is not cleanly separated, and never read non-significant as "equivalent."
- **Primary deliverable:** context-vs-N slope + a **demonstrated** SP-sonnet wall (run until it
  actually compacts or fails) vs UP flatness. **Secondary:** cost-vs-N slope + the crossover N (if
  any) where A's tax overtakes B's stage overhead.
- Headline is the **slope + crossover**, never a single point (the prior N=5 scope error).

## What it CAN / CANNOT prove
- **CAN:** context-vs-N divergence + a demonstrated SP context wall vs UP flatness (capability,
  model-fair); a cost-vs-N slope + crossover that is model-fair (reviewers matched opus, cost
  price-weighted).
- **CANNOT:** a single "X% cheaper" headline (report slope + crossover); generalization beyond
  isolated, single-file, fully-specified tasks (fixture ceiling, the coordinator's real value-add,
  cross-task coupling and ambiguous specs, is engineered out); any quality difference beyond a direct
  count of vacuous tests removed by re-witness.

## Cost & authorization
From prior runs (N=5/2-task = $88/20 runs; 24-task pilot ≈ $20-30/run):
- **Minimal** (corrected single scale point: 24 tasks, 4 arms, N=2, F5-honored) ≈ 8-16 runs ≈ **$200-400**.
- **Full ladder** ({12,24,36,48} × 4 arms × N=3, incl. pushing SP to its wall) ≈ **$600-1200**.

Needs explicit budget authorization before any run. Recommend starting with the **minimal corrected
scale point** to settle the crossover question, then deciding the ladder.

---

## Council review, `wf_d5011584-12d` (approve-with-changes · medium · unanimous 3/3)

3 labs (claude / gpt-5.5 / gemini-3.1-pro) each returned **approve-with-changes**; judge confidence
**medium** (one revision: codex → needs-more-info, pending task-sampling + B-parity pre-registration;
effective standing 2 approve-with-changes vs 1 needs-more-info, plurality holds). No wrong-tree
false-positives (self-contained framing held). **Required changes before the COST campaign:**

> **Status 2026-06-14, ALL FIXED.** #1 ground-truthed + metering corrected in `run.sh meter()` +
> `bench/README.md §6`/F13; #2-#6 folded into the plan body (§Arms B-parity, §Scale design, §H2,
> §fairness trap) and the `--tasks`/`--prefix` cumulative-prefix mechanism added to `run.sh`. Validated
> end-to-end on a small set (see §Validation at the foot of this doc).

1. **Metering proof, CRITICAL, hard gate on the cost (secondary) deliverable.** *(GROUND-TRUTHED,
   resolved + the README rule was inverted; see next section.)*
2. **Task sampling / ordering pre-registration.** The {6,12,24,36,48} ladder must be **cumulative
   prefixes** in **fixed, identical task order across arms and repeats**. Estimand = cumulative-work
   scaling; per-task difficulty cancels in the A−B delta **only if** task identity is parity-pinned.
   Publish the protocol before running.
3. **B-parity operational definition.** Pin exactly which stages B-parity **retains** (haiku verify,
   capture-head) vs **drops** (re-witness only). It is **not** stage-matched to A, state that;
   do not claim full stage parity.
4. **Crossover statistical honesty.** N=2-3 vs ~20% noise + a bimodal success/BLOCKED distribution
   cannot localize a cost-crossover N. **Pre-commit to reporting a null crossover**; never read
   non-significant as "equivalent."
5. **SP-wall confound.** A sonnet coordinator run near its ~200K window may degrade *coordination
   quality* → label the wall a **"capability-OR-quality" limit**, or add a control. Disclosed ≠
   controlled.
6. **A-sonnet = bracket, not guarantee.** The envelope's lower bound is an **ESTIMATE**; it does not
   cover haiku/mixed coordination, manual context-pruning, or compaction.
7. **Framing.** Never let "context grows" (measured) read as "cost grows" (unmeasured, H1 prior);
   the A-vs-B cost-unit asymmetry is **contingent on the stream**, not structural.

**Contested (survived, per authors):** matched-pairs cancels per-task difficulty (conditional on #2);
F5 audit already operationalizes reviewer parity; "a crossover exists" was an attacker paraphrase,
not a design assumption (the proposal correctly frames it as an open empirical question).

## Metering: ground-truthed correction (the `README §6` rule is INVERTED)

Verified against the N=5 campaign results (`bench/results/20260613-205219.json`, all 20 runs):

| meter | ARM A (superpowers) | ARM B (Ultrapowers) |
|-------|---------------------|---------------------|
| stream-summed `meterB.in` | 48K-84K (subagents **in** stream) | 12-13K == `meterA` (subagents **absent**) |
| `agentCount` (from stream) | 7-11 | **0** |
| `total_cost_usd` / `modelUsage` | rolls up opus+sonnet | rolls up opus+haiku+sonnet |

- The Workflow runs B's subagents **off** the `claude -p` stream, so the self-summed `meterB` captures
  only B's ~6 coordinator turns. Cross-comparing A's `meterB` (subagents included) to B's `meterB`
  (excluded) understates B by ~5×, the README's feared "~100× trap," confirmed real.
- `result.total_cost_usd` + `modelUsage` **does** roll up all subagent work for **both** arms (B's
  `modelUsage` shows haiku+opus+sonnet the coordinator never ran). It is the rollup-correct cross-arm
  meter.
- **Therefore `bench/README.md §6`'s "non-negotiable rule" ("do NOT use `total_cost_usd`; sum the
  stream yourself") is BACKWARDS for this installed CLI.** This plan's headline (`total_cost_usd` +
  `modelUsage`) is the correct meter; `README §6` + `run.sh meter()` emphasis must be corrected before
  any cost campaign. **The N=5 campaign cost numbers are unaffected**, they already used
  `total_cost_usd`.
