# Adversarial fairness critique of the ultrapowers-vs-superpowers benchmark

> Produced by an adversarial reviewer agent (run wf_978f5f60-f3c). Captures the confounds
> the benchmark must control before any token-savings number is honest. Drives the F1-F16
> fairness controls in bench/README.md.

Confirmed: the SDD model selection is **prose guidance** ("Use the least powerful model that can handle each role"), not an enforced parameter — exactly the §0 confound the methodology names. And critically, SDD says implementers are cheap, **but reviewers are "most capable available model"** — which is opus, matching ARM B. So the routing the methodology pins (impl=sonnet, review=opus) is what SDD *itself* recommends. That's defensible. But "standard model" for integration/judgment tasks is a third tier the methodology collapses.

I now have everything I need to verify the load-bearing claims. The structural facts hold. Let me write the brutal review.

---

# ADVERSARIAL REVIEW: ultrapowers-vs-superpowers eval

**Verdict up front:** This design can yield an **honest qualitative comparison and ONE honest headline number — but only the Meter-A (coordinator-context) number, and only if reframed as a property of Anthropic's Workflow primitive, not of "ultrapowers beats superpowers."** Every Meter-B ("total billed") headline this design could produce is confounded past the point of an honest single number at N=2. The design *already concedes* most of this in §9 — which is intellectually honest, but it means the "head-to-head eval harness" framing oversells what the harness can deliver. Below, ranked by how badly each flaw misleads, each with the concrete fix.

I verified the load-bearing `[VERIFIED]` claims against source. They substantively hold (`if (!goal) break` at line 763 → tasks-only skips the critic; reviewers hardcoded `opus` at 457/498; `IMPL_MODEL` default `'sonnet'` at 99; `redWitness:false` off-switch at 123; SDD model-routing is unenforced prose at SKILL.md:89-102). Some cited line numbers are off by a few, but no claim is *fabricated*. Good. That's the floor, and it's met. Now the attacks.

---

## RANKED ATTACK LIST

### A1 — [FATAL to any Meter-B headline] The two token meters do not measure the same population of work, and the design knows it but still calls this a "head-to-head … measuring token cost"

ARM A's coordinator **runs the test command itself, reads files, does TodoWrite/scene-setting, and dispatches** — all billed at the **opus coordinator rate** (you set `--model opus`). ARM B's coordinator makes **zero LLM calls** (verified: deterministic JS), and offloads the equivalent bookkeeping to **dedicated `haiku` agents**: `verify` (line 399), `capture-head` (512), `resume-load` (655), `checkpoint` (664), `sp-version-check` (673), `preflight` (692/710), plus the `haiku` CLI-wrapper (131) when external — none of which exist as separable line-items in ARM A. So Meter B for A folds coordinator overhead into opus turns; Meter B for B splits it into cheap haiku agents. **You are not summing the same work at the same prices.** A raw token sum (your §6 jq) treats a haiku token and an opus token as equal — they bill ~**1:60+** apart. A "total tokens" headline is therefore meaningless and a "total cost" headline is only valid if you weight by per-model price.

**Fix:** Kill the raw-token Meter-B headline entirely. Report Meter B **only as `total_cost_usd`** (price-weighted), AND publish the **per-model `modelUsage` breakdown** for both arms so a reader sees *where* the cost lives (A: all-opus; B: opus-reviewers + haiku-bookkeeping + sonnet-impl). Then state explicitly: "B's architecture moves coordinator overhead from opus to haiku; this is a real cost lever, not a measurement artifact — but it is a *consequence of the model routing the JS hardcodes*, available to A only if A's coordinator also delegated bookkeeping to haiku, which SDD-in-session does not." That sentence is the honest finding. The number alone lies.

---

### A2 — [FATAL] Subagent-token rollup into `total_cost_usd` is `[UNKNOWN]`, and the two arms have *opposite* topologies, so a naive `total_cost_usd` comparison double-counts one arm or zero-counts the other

The token-accounting work you did already flagged this and it is the single biggest metering landmine: **whether Task/subagent tokens roll up into the top-level `claude -p` `result.total_cost_usd` is undocumented** `[UNKNOWN per docs]`. For ARM A (SDD-in-session, subagents are Task children of the same `query()`) rollup *might* include them. For ARM B, the JS-Workflow subagents run in a **separate Workflow runtime**; the `claude -p` `result.total_cost_usd` for B is "~2k coordinator delta," explicitly **excluding** the 471k of subagent work `[VERIFIED token-benchmark.md framing]`. **If you naively compare `result.total_cost_usd` A-vs-B, you compare A's whole tree against B's coordinator stub — a ~100× artifact that would falsely make B look free.** This isn't a subtle bias; it's a wrong-by-orders-of-magnitude trap baked into the most obvious field to grab.

**Fix:** Do **not** use `result.total_cost_usd` as Meter B for either arm. For *both* arms, compute Meter B by **summing `usage` across all messages deduplicated by message `id`, including `parent_tool_use_id`-tagged subagent messages** (the dedup-by-ID step is mandatory — parallel calls share an id and the docs warn they carry identical usage). Cross-check ARM B's stream-derived sum against the Workflow's own `subagent_tokens`/`agent_count` (the `wf_7ad7c92f-406` field) — **two independent counts**; if they disagree, the metering is broken, stop and fix before any campaign. Until you have demonstrated on a real transcript that your sum equals an authoritative count, every cost number is `[UNVERIFIED]`. The design says "pin the field names once against a real transcript" — that pinning is not optional polish; it is the difference between a benchmark and a fabrication.

---

### A3 — [SEVERE, and the design half-admits it] Stage-count asymmetry: ARM B runs MORE review stages, so "more tokens" is "more work," not "less efficient" — and B-parity does **not** actually equalize the stage set

The design claims B-parity's pipeline ≈ A's: "impl → gate → spec → quality → fix-loop → integration." False in two ways that both inflate B's token count for reasons unrelated to the coordinator IV:

1. **The deterministic `haiku` gate (line 399) is an extra stage A doesn't have as a billed agent.** In A, the coordinator runs `node --test` inline. In B, a whole haiku agent is spawned to run it and copy the exit code. That's a B-only agent dispatch.
2. **`capture-head` (haiku, 512) and per-task `checkpoint` (haiku, 664) are B-only** crash-resume machinery with no A counterpart. They're cheap, but they're real agents in Meter B.

So even "B-parity" runs strictly more *agent dispatches* than A. A skeptic says: "Of course B costs more total — it does more discrete steps. That's not inefficiency, and it's not the coordinator architecture; it's the bookkeeping the JS chose to make explicit." Conversely, if B-parity comes out *cheaper*, it's because haiku bookkeeping is cheaper than opus-coordinator bookkeeping — again a routing story, not a coordinator story.

**Fix:** (a) Add a third meter — **agent/dispatch count per arm** — and report it alongside tokens, so "more tokens" is decomposed into "more dispatches" vs "more tokens per dispatch." (b) In the writeup, **attribute the gate/checkpoint/capture-head overhead explicitly to B's crash-resume + determinism features**, and concede they are not present in A. (c) Do **not** claim B-parity has "the same stage set as A." It has the same *review* stage set (spec→quality→integration); it has *additional* deterministic-infrastructure stages. State that precisely. The honest comparison isolates the **review** stages (which are identical, same opus model, same prompts) and treats infra stages as a named B-side cost.

---

### A4 — [SEVERE] Coordinator-model asymmetry: you pinned A's coordinator to `--model opus`, which is a *choice that loads the dice on Meter B*, and the justification is circular

You set `--model opus` for ARM A's coordinator and justify it as "SDD's coordinator is a judgment role → most-capable per its own guidance." But SDD's guidance (verified, SKILL.md:89-102) has **three** tiers and explicitly reserves "most capable" for *architecture/design/review*, while calling *integration and judgment / multi-file coordination* a **"standard model"** task. The SDD **coordinator's per-turn job** — read implementer report, decide pass/dispatch-reviewer, run a test command — is closer to "integration/judgment → standard" than to "architecture → most capable." **By pinning the coordinator to opus you inflate ARM A's Meter B with the most expensive possible coordinator, then compare against B's free coordinator.** A hostile reader: "You handicapped A by making its coordinator opus when SDD says standard, to make B's zero-LLM-coordinator look better." Conversely, if you'd run A's coordinator on sonnet/haiku, A's Meter B drops and B's advantage shrinks. The result is *sensitive to a knob you chose by appeal to a guideline that doesn't unambiguously say opus.*

**Fix:** Run ARM A's coordinator at **two settings** — `--model sonnet` (SDD "standard" reading) and `--model opus` (your "most capable" reading) — and report both. Disclose that the coordinator-model choice moves A's Meter B materially and that there is no single "fair" setting because SDD leaves it to in-session judgment. This converts a hidden thumb-on-the-scale into a reported sensitivity. *Note:* the Meter-A story is robust to this (A's coordinator context grows with task count regardless of which model it is), which is exactly why Meter A is the only honest headline.

---

### A5 — [SEVERE] The implementer-routing pin on ARM A is *soft and audited, not enforced* — and the design treats post-hoc audit as if it neutralizes the confound. It doesn't; it only measures it

§0 is admirably honest that ARM A's "dispatch implementer with model=sonnet" is a **prompt instruction the session may disobey**, audited from the transcript. But an audit that *flags* deviations does not make the arms comparable on the runs where A deviated — and the design's plan ("flag, don't average in") creates a **survivorship/selection problem**: if opus-coordinator-A tends to "upgrade" the implementer to opus on the harder Task 2 (because it judged the task non-mechanical), then the *clean* (100%-routing-match) A runs are systematically the *easier-perceived* executions, biasing the surviving A sample. You'd be comparing B-on-all-tasks against A-on-the-tasks-A-decided-were-mechanical.

**Fix:** Pre-register the rule: a run with **any** routing deviation is **not silently dropped and not silently kept** — it's reported as a **separate stratum** ("A-as-instructed" vs "A-as-it-actually-routed") with its own N, and the **deviation rate itself is a headline finding** ("on the medium task, the in-session coordinator overrode the sonnet pin X% of the time — evidence that framework-enforced routing and guidance-routing diverge in practice"). That turns the unfixable confound into the *most interesting result the eval can produce*. Do not report a single pooled A number that mixes obeyed and disobeyed runs.

---

### A6 — [HIGH] N=2 tasks is the regime where ultrapowers' actual Meter-B claim does NOT live, so a Meter-B headline here is a strawman against ultrapowers' own thesis

The benchmark doc predicts (verified framing) that Meter B at small N is a wash-or-A-win because there's no "N² coordinator tax to amortize." The Meter-B story for ultrapowers is a **large-N / long-build** claim. Running 2 tasks and reporting "Meter B was a wash" is technically honest but **rhetorically a strawman**: a HN skeptic flips it — "you picked the task count where the tool's headline claim is *designed not to show up*, so your 'wash' tells us nothing about the regime the tool is for." Either direction (pro or anti ultrapowers) the N=2 Meter-B number is non-load-bearing and invites misreading.

**Fix:** Two options, pick one and state it. (a) **Drop the Meter-B headline at N=2 entirely**; present Meter B only as a *per-task cost curve* and explicitly say "extrapolating the coordinator-context (Meter A) growth, Meter B crossover is predicted at ~N tasks; this 2-task fixture does not reach it." (b) Add a **third task tier or a 10-task synthetic run** specifically to show the Meter-A growth slope (cheap pure functions; the point is run-length, not difficulty). The Meter-A slope across N=2/5/10 is the *honest* quantitative headline; a single N=2 Meter-B point is not.

---

### A7 — [HIGH] Task-selection bias: two pure, dependency-free, fully-specified functions are the *best case for SDD-in-session* and erase the dimension where a coordinator architecture would actually differ

`slugify` and `parseDuration` are isolated, single-file, zero-dependency, completely-specified — i.e. exactly the "mechanical, cheap-model, 1-2 files" tier of SDD where **the coordinator has almost nothing to coordinate**. The entire value proposition of a *coordinator* (in-session LLM vs JS) shows up under **cross-task coupling, ambiguous specs, mid-build replanning, integration friction** — all of which you deliberately engineered *out* ("no cross-task coupling → fair to run as independent"). You've selected tasks that minimize the independent variable's effect on quality and maximize prompt-discipline parity. That's "fair" in the sense of controlled, but it's **cherry-picked toward the null result you predict in §9** ("near-parity on quality"). A skeptic: "You chose tasks guaranteed to produce parity, then reported parity."

**Fix:** Acknowledge the fixture probes **only the mechanical tier** and name what it cannot see. If quality differentiation is a goal, add **one task with genuine cross-task coupling** (Task 2 imports/depends on Task 1's output, or a deliberately under-specified spec that forces a judgment call) — that's where in-session-coordinator context vs stateless-JS-coordinator would actually diverge on quality, and where ultrapowers' critic (which you turned OFF) earns or doesn't earn its keep. At minimum, scope every headline to "on isolated, fully-specified, single-file tasks…" and forbid generalizing beyond it.

---

### A8 — [HIGH] Quality-judge bias: opus grading opus, and the rubric is mostly objectively-checkable (so the judge is near-redundant where it's reliable and biased where it isn't)

You flagged "opus grading opus" and proposed a cross-family second judge — good. But two deeper issues remain: (1) **Q1 Correctness is determined by `node --test` exit code**, which is objective and needs no LLM judge at all; the LLM judge only adds value (and bias) on Q2-Q4 (test-integrity / YAGNI / idiom) — *exactly the subjective axes where same-family self-preference bites hardest*. (2) **ARM B-full's quality edge is structurally guaranteed by re-witness-RED**, a mechanism that mechanically removes vacuous tests; if the judge rewards "tests are non-vacuous" (Q2), B-full wins Q2 *by construction*, not by judgment — that's not the judge discovering quality, it's the judge re-deriving a property you already enforced. Reporting it as a "quality win" double-counts the mechanism.

**Fix:** (a) Compute Q1 **deterministically from the test runner**, not the LLM — reserve the LLM judge for Q2-Q4 only, and disclose Q1 is mechanical. (b) **Mandate** the cross-family judge (gemini/codex), not "ideally"; report inter-judge agreement (κ), and treat any Q-score where the two families disagree as `[INCONCLUSIVE]`, not averaged. (c) For B-full's re-witness advantage, report it as a **mechanism presence/absence fact** ("B-full caught N vacuous tests that survived A's two-stage review") measured *directly from the red-witness agent's output*, **not** laundered through the quality judge's Q2. The honest claim is "re-witness mechanically removed vacuous tests," with a count, not "the judge thinks B-full's tests are better."

---

### A9 — [MEDIUM] Superpowers (ARM A) is run in a structurally *handicapped* configuration vs how a human actually uses it — and ARM B in a *stripped* config vs how it ships — so neither arm is "the product"

Three asymmetries: (1) ARM A is forced to run **two specific tasks and forbidden** from adding its own decomposition/critic ("Do NOT add … any task beyond the two below") — but a real SDD session *would* plan and might split Task 2; you've disabled A's adaptive behavior while B-full keeps re-witness. (2) `--permission-mode acceptEdits` / `bypassPermissions`: if A hits *any* permission friction B doesn't (B runs as a Workflow), A eats extra turns. (3) You forbid A's "extra reading/TodoWrite/scene-setting" implicitly by prompt but call that overhead "a real architectural cost difference correctly attributed to A" — which is fair *only if* A is otherwise run idiomatically; pinning A to a rigid 2-task script while letting B keep its shipped re-witness means **B-full is "as shipped" but A is "as constrained."**

**Fix:** Make the constraint **symmetric and explicit**: either both arms run "as shipped" (A allowed to decompose/critic-equivalent; compare against B-full with all extras) **or** both run "stripped to the identical stage set" (A forbidden extras; B-parity). The current design mixes them (constrained-A vs shipped-B-full in the same tables). Run and report the two matched pairs: **{constrained-A vs B-parity}** for the clean coordinator comparison, and **{idiomatic-A vs B-full}** for the "what you actually get" comparison. Never put constrained-A and B-full in the same headline row.

---

### A10 — [MEDIUM] N and variance: N=10 with ±20% intrinsic noise and a non-normal, possibly-bimodal distribution (success vs BLOCKED) is underpowered for any small effect, and the stats plan can over-claim

±20% run-to-run noise (verified) with N=10 gives a wide CI; if the true Meter-B difference at N=2 is "a wash" (your prediction), you are powered to detect basically nothing, and a Mann-Whitney U on N=10 vs N=10 with overlapping ±20% spreads will (correctly) say "no significant difference" — which a careless writeup could spin as "proven equivalent" (absence of evidence ≠ evidence of absence). Worse, including quality-0 BLOCKED runs as data points (correct for honesty) makes the distribution **bimodal**, and median/Mann-Whitney on bimodal data can mislead.

**Fix:** Pre-register the effect size you care about and **power for it** (or state "this N can detect a ≥X% cost difference; smaller differences are reported as 'not distinguishable at this N,' never as 'equivalent'"). Report **completion rate separately** from cost (don't blend a 2/2-pass run and a BLOCKED run into one cost distribution — stratify: cost *conditional on success*, plus an independent success-rate comparison). Bootstrap CIs on the difference, and **state the null explicitly** so no reader reads non-significance as proof of parity.

---

### A11 — [MEDIUM] Counting human-session tokens for one arm but not the other — partially handled, but the `/ultrapowers` plan-approval turns and A's branch-creation turns are an unbilled asymmetry

You correctly run A headless (F8) so no interactive session pollutes it. But the realistic ARM-B usage includes a **human plan-approval gate** (the `/ultrapowers` command's interactive turns before the Workflow launches) that your scripted B invocation bypasses by calling the Workflow directly. And ARM A's prompt makes it do **branch creation + the two-task scaffolding inline** (billed to A) while B gets the branch created *outside* the measured command (F11: "B run on a checked-out `eval` branch" — created by `git checkout` in the harness, **not** billed to B). Small, but it's the exact "count session tokens for one arm not the other" trap the brief warns about, in miniature: A pays in-band for branch+scaffolding, B's harness does it out-of-band.

**Fix:** Equalize the boundary. Either (a) create the branch out-of-band for **both** arms (don't make A's prompt do `git checkout -b eval`; have `provision()` do it for A too, unbilled), **or** (b) bill it to both. Same for any plan-approval turns: if B-as-shipped has a human gate, either measure it for B or explicitly scope the comparison to "post-approval execution only" for both. Pick one boundary, apply identically, state it.

---

### A12 — [LOW] `--output-format stream-json` schema is assumed identical across both arms, but the Workflow path may emit a different event shape, silently zeroing one meter

Your §6 jq assumes the same `.message.usage` / `.parent_tool_use_id` schema for both arms. ARM B's subagents run inside the Workflow runtime; it is `[UNKNOWN]` whether their per-message usage surfaces in the *same* `claude -p` stream with the *same* field names, or only via the `/workflows` UI / `subagent_tokens` field. If B's subagent usage is **absent** from the stream you parse, your Meter B for B silently reads ~2k and B looks free — the A2 trap again, via a different door.

**Fix:** Before the campaign, run one B execution and **prove** the stream contains every subagent's usage (count agents in the stream == `agent_count` from the Workflow result). If it doesn't, you **cannot** use stream-parsing for B's Meter B; you must read `subagent_tokens` from the Workflow result object directly, and then you must confirm that field is in the **same units** (raw tokens? cost? cache-inclusive?) as A's stream sum. Document the exact source of each arm's Meter B; they may legitimately need *different extraction paths*, and that's fine **only if** you've proven they yield the same quantity.

---

## SUMMARY TABLE

| # | Severity | Attack | One-line fix |
|---|----------|--------|--------------|
| A1 | FATAL (Meter B) | Two meters sum different work at different prices (opus-coordinator vs haiku-bookkeeping) | Report Meter B only as price-weighted `total_cost_usd` + per-model breakdown; never raw tokens |
| A2 | FATAL (Meter B) | Subagent rollup `[UNKNOWN]`; opposite topologies → naive `total_cost_usd` is ~100× wrong for B | Sum dedup-by-ID across all messages incl. subagents; cross-check vs `subagent_tokens`; prove on a real transcript first |
| A3 | SEVERE | B runs more stages (gate/checkpoint/capture-head agents A lacks) → "more tokens = more work" | Add dispatch-count meter; isolate *review* stages; attribute infra stages to B explicitly |
| A4 | SEVERE | A's coordinator pinned to opus inflates A's Meter B; SDD says "standard," not opus, for that role | Run A coordinator at both sonnet and opus; report sensitivity |
| A5 | SEVERE | A's implementer routing is soft/audited not enforced → surviving A runs are selection-biased | Stratify "A-as-instructed" vs "A-as-routed"; report deviation rate as a finding, don't pool |
| A6 | HIGH | N=2 is the regime ultrapowers' Meter-B claim explicitly does NOT live in | Drop N=2 Meter-B headline; report Meter-A growth slope across N=2/5/10 instead |
| A7 | HIGH | Tasks cherry-picked to the mechanical tier where the coordinator IV barely matters → engineered parity | Add one coupled/under-specified task, or scope every claim to "isolated single-file tasks" |
| A8 | HIGH | Opus-grades-opus; Q1 needs no LLM; B-full's Q2 edge is enforced-by-mechanism, not judged | Q1 mechanical; mandate cross-family judge + κ; report re-witness as a direct count, not a Q-score |
| A9 | MEDIUM | constrained-A vs shipped-B-full mixed in one table (asymmetric configs) | Two matched pairs only: {constrained-A vs B-parity}, {idiomatic-A vs B-full} |
| A10 | MEDIUM | Underpowered at ±20% noise; bimodal (BLOCKED) distribution; risk of "non-sig = equivalent" | Power for a pre-registered effect; stratify cost|success vs success-rate; state the null |
| A11 | MEDIUM | A pays in-band for branch/scaffolding; B's branch created out-of-band → asymmetric billing boundary | Same setup boundary for both arms (out-of-band for both, or billed for both) |
| A12 | LOW | Assumes identical stream-json schema; B's subagent usage may be absent → silent zero | Prove B's stream carries all subagent usage; document each arm's extraction source + units |

---

## THE VERDICT (honest headline vs qualitative-only)

**One honest quantitative headline survives all twelve attacks:**

> **Coordinator-context (Meter A) is flat-and-tiny for the JS-Workflow arm and grows with run length for the in-session arm — a structural property of Anthropic's Workflow primitive, demonstrated here on a controlled task set.**

This is honest because Meter A is (a) robust to the coordinator-model choice (A4), (b) not dependent on the rollup `[UNKNOWN]` (A2 — Meter A is the *non*-subagent slice you can isolate cleanly), (c) the claim ultrapowers' own doc makes, and (d) explicitly **credited to the Workflow primitive, not ultrapowers' invention** — which your HONESTY RULES require and which is also just true. To make it land, report it as a **slope across N=2/5/10**, not a single N=2 point (A6).

**Everything Meter-B is qualitative-only at this fixture.** No honest single "B is X% cheaper/more expensive total" headline is extractable at N=2, because: the rollup question is unresolved (A2), the meters sum different model-priced work (A1), B runs more discrete stages (A3), and A's coordinator-model knob swings the result (A4). The most you can honestly say about Meter B is the *shape* prediction your §9 already states: "a wash or slight A-win at small N, with B's advantage a large-N/long-build property not reached here." That is a qualitative claim with a directional cost-curve, **not** a headline number.

**Quality is qualitative-parity-with-one-named-exception.** Identical prompts + identical pinned models ⇒ expected Q1-Q3 parity (and Q1 should be measured mechanically, not judged — A8). The single defensible quality *difference* is **B-full's re-witness-RED removing vacuous tests**, reported as a **direct count of caught vacuous tests**, not as an LLM Q-score — and credited as ultrapowers' *one* scarce mechanism on top of superpowers' inherited SDD/TDD discipline.

**Net:** The design is unusually self-aware (the §0 confound disclosure and §9 expectation-setting are better than most published evals) and its `[VERIFIED]` claims check out against source. But as written it **invites a Meter-B headline it cannot honestly support**, mixes constrained-A with shipped-B-full, and leans on a soft-pinned routing audit as if it neutralized rather than merely measured the confound. Apply A1-A5 and A8 and you have a benchmark that yields **one honest number (Meter-A growth) + a credible qualitative cost-curve + a mechanism-level quality finding** — and that is genuinely publishable, *as long as the headline is the Workflow-primitive context property and not "ultrapowers beats superpowers."* The discipline this all rests on is obra/Jesse Vincent's; ultrapowers' measurable contribution here is hosting it on a zero-LLM coordinator, and the eval should say exactly that and nothing more.
