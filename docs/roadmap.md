# Roadmap, the OSS-credibility path

The honest gap between what Ultrapowers **is** today (a well-documented single-file harness
with an unusually mature *intellectual* story) and what it needs to be to stand as a credible
OSS peer (a *shippable, safe, testable* toolkit). This is the prioritized, contributor-actionable
list. Evidence tags follow the house style: `[V src]` = verified (primary source read this session),
`[I]` = inferred, `[ESTIMATE: calc]`, `[U]` = unknown. "I did not find X" is used in place of
"nobody does X."

> **Read this first:** Ultrapowers *complements* [Superpowers](https://github.com/obra/superpowers)
> by Jesse Vincent ([@obra](https://github.com/obra)); it does not replace it. The token flatness
> is **Anthropic's Workflow primitive's** property, not our invention. The SDD/TDD discipline is
> **inherited** from Superpowers. re-witness RED is the one scarce mechanism we found shipped
> nowhere else (`[V docs/research/oss-landscape.md, ~80% confidence]`). Every section below holds
> to that framing, and so must every PR.

---

## 1. Vision, what "ultra powerful" means, honestly scoped

"Ultra powerful" here is **narrow and earned**, not a superlative. It means exactly one thing:

> **You hand off a whole goal and walk away.** The build runs unattended, for as long as it
> needs, without the controlling session's context growing, without compaction killing it, and
> without a vacuous test sneaking a green check past review.

That is the entire claim. It decomposes into four properties, three of which we did **not**
invent and say so plainly:

- **Flat coordinator context** (Meter A), a property of Anthropic's deterministic **Workflow**
  primitive `[V docs/decisions/README.md ADR-0001]`. Our move is *choosing to host SDD/TDD on
  it*, the path Superpowers structurally declined (`[V #1041]`, `[V #1647]`). Not our saving.
  Measured **~8× flatter** coordinator context than Superpowers (B holds ~6-7 turns vs A's
  46-56, flat across all 5 runs) `[V docs/benchmarks/campaign-n5-2026-06-14.md]`. This is a
  **scaling/capability** property, it lets a long build survive where Superpowers' growing
  controller would overflow the context window, **not** a per-bill discount (see below).
- **Inherited discipline**, watch-it-fail TDD, two-stage fail-closed review, least-powerful-model
  routing. Superpowers', adopted verbatim, with gratitude (`[V NOTICE]`).
- **A dynamic loop-until-clean critic**, exists elsewhere (CAMEL Workforce, Magentic-One)
  `[V oss-landscape.md]`; novel only *in this combination*.
- **Mechanical re-witness RED**, strip the impl, prove the test fails without it. The one
  mechanism we could not find shipped in any comparable build loop. **This is the headline.**

What "ultra powerful" explicitly is **not**: it is not "better than Superpowers," not "near-zero
tokens" and not "cheaper", on a measured N=5 head-to-head total cost was a **tie** ($3.90 vs
$4.03 median, ranges fully overlap `[V docs/benchmarks/campaign-n5-2026-06-14.md]`; consistent
with the Meter-B model at small N `[V docs/benchmarks/token-benchmark.md]`), and it is not a
novel orchestration paradigm. It is a disciplined, safe, unattended hand-off harness
that slots into the Superpowers lifecycle. Marketing that erodes any of those qualifiers is a
regression, not a feature.

---

## 2. Prioritized roadmap

Effort: **S** = hours, **M** = a focused day, **L** = multi-day. Priority: **P0** = launch-blocker,
**P1** = ship-soon, **P2** = later. Sequenced view at the end of this section.

### Essential skills, depend, don't re-port

The toolkit story is **"we slot into Superpowers' lifecycle,"** not "we own 14 skills." SDD's own
`SKILL.md` names its required siblings; Ultrapowers embeds only the few it has a *structural*
reason to (the sandbox subagents have no filesystem access, so TDD + reviewer prompts must be
handed to each disposable agent's brief verbatim, that's why they're embedded `[V NOTICE]`).
For everything interactive, **depend on Superpowers and document the seam**, re-porting obra's
prose multiplies drift surface (the harness already ships a drift-detector, `SP_VERSION='5.1.0'`,
precisely because verbatim-embedding is a liability `[V workflows/ultrapowers-development.js:88]`)
and contradicts the complement-not-replace thesis.

| Item | Why | Effort | Priority |
|------|-----|--------|----------|
| Embed `systematic-debugging` into the fix-loop brief | The single genuine *functional* skill gap. When a fix-loop thrashes (`stall>=2`) or a task is BLOCKED, the implementer gets *no* debugging discipline, and the fix-loop is where unattended runs actually fail. Embed verbatim (like TDD) or inject a pointer. | M | **P1** |
| Document depend-on-Superpowers seams: `brainstorming` → `writing-plans` → `/ultrapowers` → `finishing-a-development-branch` | Ultrapowers begins at *plan/goal*; brainstorming/writing-plans are the interactive upstream that produces it (friction is load-bearing, exactly what the README says to use Superpowers for). A reader should see Ultrapowers as *one stage in the Superpowers lifecycle*, not a reinvention of all of it. | S (doc) | **P1** |
| Wire GATE 2 → `superpowers:finishing-a-development-branch` | Today the command tells the human to "eyeball the integration verdict + the diff before merging" (`[V commands/ultrapowers.md:66]`) but never offers the structured merge/PR/discard menu that SDD's flow *ends* in. Hand off instead of re-porting. | S | **P1** |
| Keep `test-driven-development` + the two reviewer prompts embedded | Already done, verbatim, for the structural reason above. Maintenance only: keep them synced to the `SP_VERSION` pin. |, | P0-maintained |
| Align worktree creation to Superpowers' native-first convention | The command creates a worktree/branch off main `[V commands/ultrapowers.md:14]` but doesn't match Superpowers' native-tool-first detection or `.worktrees/` convention. Harden. | S | **P2** |

`requesting-code-review` / `receiving-code-review` need no separate skill, the two-stage reviewers
**are** that discipline, ported.

### Council / multi-CLI support

The multi-CLI plumbing is proven (the harness already drives `codex exec` and gemini as
*implementers*). A council is a **robustness/quality feature, not a novelty claim**, multi-model
voting panels are not new. Frame it that way; re-witness RED stays the headline, council is hardening.

| Item | Why | Effort | Priority |
|------|-----|--------|----------|
| Council at the **final integration review** | The one gate before merge, where diverse lenses (correctness / security / cross-task coupling, or cross-model Opus+Codex+Gemini consensus) catch what a single model's family-correlated blind spot misses. The harness already flags this as future work (`[V docs/DISCUSSION.md item 3]`). Highest-value council slot. | M | **P1** |
| Council at the **plan gate** (adversarial critique of the decomposition) | Cheap robustness before the human approves; lower value (the human is already the gate). | S | **P2** |
| **Do NOT** put council on the per-task two-stage review | Documenting *why not* is credibility: it multiplies Meter-B cost (already ~157k tok/task at N=3 `[V token-benchmark.md]`) by the panel size on the highest-frequency operation. Council belongs at the *rare* gates, never the hot loop. |, | (decided) |

### Pluggable implementers as a clean extension point

"Pluggable implementers" is in the harness's own meta-description but the code doesn't yet deliver
it: the implementer is a `let IMPLEMENTER` string with `if (IMPLEMENTER === 'codex')` branches
interleaved across `implement()` and `preflight()` `[V workflows/ultrapowers-development.js:94,303]`.
Adding a fourth implementer means editing three functions. For an OSS project, **the extension
point IS the contribution surface.**

| Item | Why | Effort | Priority |
|------|-----|--------|----------|
| Implementer **interface/registry**, `{ name, preflight(repoDir)→{ok,detail,downgradeTo?}, buildBrief(brief,task,repoDir)→cliPrompt, wrapperModel }` | `implement()`/`preflight()` loop over a registry instead of `if/else`. The codex `--cd`/`--ephemeral`/timeout logic and gemini's no-cwd downgrade move *into* their entries. Behavior-preserving refactor, re-witness + two-stage review protect against regression. This is the unlock; ship it first. | M | **P1** |
| Add an `aider` adapter | Large install base (`[V oss-landscape.md: 46,151★]`), fills the non-Claude-family external slot alongside codex/gemini. | M | **P2** |
| Add a **generic `cli` adapter** (command template + cwd flag) | What truly makes it an extension point rather than a fixed menu, any batch CLI without a code change. | M | **P2** |
| Ship every external adapter with a **security note** | Each external implementer needs sandbox carve-outs (`Bash(codex *)` allow + `sandbox.excludedCommands`). The seam must come with the threat note, not just the code. | S | **P1** |

### Packaging, make it installable

| Item | Why | Effort | Priority |
|------|-----|--------|----------|
| `.claude-plugin/plugin.json` + `marketplace.json` | **The launch-blocker for distribution.** Superpowers ships exactly this `[V superpowers .claude-plugin/]`; Ultrapowers has neither, so it can't be `/plugin install`ed, it relies on hand-copying JS + command into `~/.claude/`. Model on Superpowers' manifest, credit-preserving: separate author, obra linked in the description. | S | **P0** |
| `package.json` + a real test runner for the **harness's own** tests | There is no `package.json`; the only "test" is `seed.sh` + a manual prompt-replay (`tests/re-witness-red/`). A harness that gates *other people's* code on a green suite but has **no executable suite of its own** is the single biggest credibility self-own. Add `npm test` that runs the re-witness seed and asserts vacuous→CAUGHT, good/weak→pass. Match Superpowers' bar (`[V tests/claude-code/run-skill-tests.sh]`). | M | **P0** |

### CI + self-tests

| Item | Why | Effort | Priority |
|------|-----|--------|----------|
| GitHub Actions: typecheck/lint + the automated re-witness self-test | Note Superpowers itself has no `.github/workflows` in the cached copy `[V: ls empty]`, but a tool that **runs code unattended** makes CI table-stakes here. CI must at minimum run the re-witness self-test so the *headline mechanism* can't silently break. (Authored-once: per the project's own CI rule, don't churn it.) | S (once tests exist) | **P0** |

### Security posture, unattended code execution

**The highest-stakes gap.** Ultrapowers runs code unattended via `codex exec ... -s workspace-write`
and **explicitly requires disabling the sandbox for codex** (`Bash(codex *)` allow +
`sandbox.excludedCommands:['codex']`, `[V workflows/ultrapowers-development.js:309-311]`: "codex's
in-process app-server cannot start under the CC sandbox, so codex itself must run unsandboxed").
The repo documents this **nowhere user-facing**.

| Item | Why | Effort | Priority |
|------|-----|--------|----------|
| `SECURITY.md`, threat model for unattended execution | An OSS tool that tells users to punch a hole in their sandbox MUST own it: what runs unsandboxed and *why*, the blast radius, how to scope `repoDir`, mandatory worktree/branch isolation (**never main**, the command enforces this `[V commands/ultrapowers.md:14]`, but the doc must state it), allow-list guidance, and secret-guarding awareness. **Without this the project is not safe to recommend.** Both a P0 safety item and a P0 credibility item. | M | **P0** |

### Docs + examples

| Item | Why | Effort | Priority |
|------|-----|--------|----------|
| One end-to-end **worked example** in `examples/` | goal → plan → build → integration verdict, with the real `wf_7ad7c92f-406` numbers `[V token-benchmark.md]`. Turns the README from claims into a demo. | M | **P1** |
| Surface the honest comparison from the README | `oss-landscape.md` is exemplary but buried in `docs/research/`. Link a trimmed version from the README; keep obra's "declined this direction" framing (`#1041`/`#1647`) front-and-center, that IS the positioning. | S | **P1** |
| Fix `mcp__codex__codex` → `codex exec` **doc drift** in the command | The command still names `mcp__codex__codex` (`[V commands/ultrapowers.md:40,46,64]`) while the harness moved codex to `codex exec` batch because the persistent-MCP path wedged (`[V workflows/ultrapowers-development.js:304-308]`). A doc/code drift bug in the *public, user-facing* command, exactly what reviewers pounce on. | S | **P0** |
| Full docs site | Nice-to-have after the worked example lands. | L | **P2** |

### Privacy / telemetry-off

| Item | Why | Effort | Priority |
|------|-----|--------|----------|
| Telemetry-off / privacy statement | Ultrapowers ships **no telemetry** (it's a JS file). State it: "no telemetry, no phone-home, runs entirely in your Claude Code session." Cheap trust win, especially for a tool that runs code unattended. | S | **P2** |

### Semver / releases

| Item | Why | Effort | Priority |
|------|-----|--------|----------|
| Semver + tagged release + `RELEASE-NOTES.md` / CHANGELOG | The harness pins `SP_VERSION='5.1.0'` and ships a drift-checker `[V workflows/ultrapowers-development.js:88]`; versioning *against* that pin tells users which Superpowers it's synced to. Superpowers ships `RELEASE-NOTES.md` `[V]`. Tag `v0.1.0-alpha`. | S | **P1** |

### CONTRIBUTING / CoC

| Item | Why | Effort | Priority |
|------|-----|--------|----------|
| `CONTRIBUTING.md` | An extension point (pluggable implementers) is worthless without a doc on how to add one, run the self-test, and the TDD bar contributors are held to (eat your own dog food). | S | **P1** |
| `CODE_OF_CONDUCT.md` (Contributor Covenant) | Superpowers ships one `[V]`. Cheap, expected, signals seriousness. | S | **P1** |

### Attribution

| Item | Why | Effort | Priority |
|------|-----|--------|----------|
| Close the `NOTICE` legal-name TODO | `NOTICE` line 29 still says "set your own legal name / org before any public release" `[V NOTICE:29]`. A literal launch-blocker. The attribution *itself* is already complete and well-done, it enumerates every verbatim-embedded file and thanks Jesse Vincent. | S | **P0** |
| Keep obra linked in the plugin manifest | When `plugin.json` lands, link the parent in its description; never let positioning drift into "Ultrapowers > superpowers." |, | P0-maintained |

### Sequenced view

- **P0 (launch-blockers):** plugin manifest + marketplace.json · `package.json` + automated
  re-witness self-test · CI running that self-test · `SECURITY.md` · close the `NOTICE`
  legal-name TODO · fix the `mcp__codex__codex`→`codex exec` doc drift in the command.
- **P1:** embed `systematic-debugging` into the fix-loop brief · document the depend-on-Superpowers
  seams · wire GATE 2 → `finishing-a-development-branch` · implementer registry interface ·
  council at the integration review · CONTRIBUTING + CODE_OF_CONDUCT · semver tag +
  RELEASE-NOTES · surface the comparison page · one worked example · security note for adapters.
- **P2:** `aider` + generic-CLI adapters · council at the plan gate · harden the worktree flow ·
  telemetry-off statement · full docs site · P2 mutant probe (deferred per ADR-0002 until a
  harder corpus shows real weak-but-dependent tests).

---

## 3. The 5 things that make us ultra powerful

1. **Mechanical re-witness RED**, strip *this task's* production files, re-run the suite; if it
   still passes, the test never exercised the code → back to the implementer. The one mechanism
   we found shipped nowhere else as a per-task build-loop step (`[V oss-landscape.md, ~80%
   confidence]`), proven in `tests/re-witness-red/` (vacuous test CAUGHT, good test passed). The
   genuine contribution. Lead with it; automate its test; protect it.
2. **Flat-coordinator unattended execution**, the JS Workflow coordinator makes **0 LLM calls**;
   471k work-tokens stayed out of the controlling session, ~2k returned (`[V run
   wf_7ad7c92f-406]`). Measured **~8× flatter** coordinator context than Superpowers head-to-head
   (~6-7 turns vs 46-56, flat across all 5 runs `[V docs/benchmarks/campaign-n5-2026-06-14.md]`).
   Runs survive arbitrarily long without compaction, a **scaling/capability** win on long builds,
   **not** a per-bill saving (total cost was a tie at small N, same campaign). *Credit where due:
   this flatness is Anthropic's Workflow primitive's property, our move is choosing to host
   SDD/TDD on it, which Superpowers structurally declined.*
3. **Two-stage fail-closed adversarial review, enforced in code**, spec-compliance THEN
   code-quality, both with "do not trust the report," fail-CLOSED on error, with blocking derived
   from the findings (not the model's `approved` boolean) and severity-tiered. Inherited from
   Superpowers SDD; our part is that it's mechanically enforced, not merely prompted.
4. **Dynamic loop-until-clean critic that injects net-new tasks**, turns "execute a fixed plan"
   into "hand off a whole goal and walk away." *Not novel as a mechanism (CAMEL Workforce,
   Magentic-One have it `[V oss-landscape.md]`), novel only in this combination* with the
   pure-code coordinator + SDD/TDD + re-witness RED.
5. **A clean pluggable-implementer extension point** (once the registry lands), codex/gemini/claude
   today, any batch CLI tomorrow, with cheap-model routing per role. What turns a personal harness
   into a *platform* others extend.

---

## 4. The 3 things that protect credibility

1. **Honesty, keep the Meter-A/B split and the novelty grading un-spun.** Never claim
   total-token savings or "cheaper" (a measured N=5 head-to-head was a **tie**, $3.90 vs $4.03
   median, ranges fully overlap `[V campaign-n5-2026-06-14.md]`; consistent with the Meter-B model
   at small N `[V token-benchmark.md]`); never claim the flat coordinator as an invention; frame it
   as a **scaling/capability** property (survives long builds), never a discount; keep re-witness
   RED as the sole headline and mark the dynamic critic and coordinator flatness as inherited or
   platform-provided. The docs already do this, the launch-day risk is *marketing* eroding it. The
   honest comparison page is the moat.
2. **Attribution, keep obra / Jesse Vincent credited and "complement, not replace" central.**
   `NOTICE` + `LICENSE-superpowers` already enumerate every embedded verbatim file and thank obra;
   the README cites `#1041`/`#1647` to show Superpowers *chose* this trade-off. Close the legal-name
   TODO, keep the parent linked in the plugin manifest, and never let positioning drift into
   "Ultrapowers > superpowers."
3. **Safety, own the unattended-code-execution risk in a `SECURITY.md`.** The tool tells users to
   disable the sandbox for codex (`-s workspace-write`, `sandbox.excludedCommands:['codex']`) and
   runs code with no human in the loop. A serious project documents the threat model, mandates
   worktree/branch isolation (never main, already enforced in the command), gives allow-list
   guidance, and adds secret-guarding awareness. Currently undocumented and the most dangerous gap.

---

## 5. Non-goals, what we do NOT try to beat Superpowers at

- **Interactive, human-in-the-loop development.** Superpowers is the parent and is **better** at
  it. Brainstorming, mid-build conversation, watching a plan take shape, tight feedback, use
  Superpowers. Ultrapowers is for *unattended hand-offs*; a Workflow cannot even pause for mid-run
  human input (constraint N5 `[V ADR-0001]`).
- **Owning the whole lifecycle as our own skills.** We deliberately **depend** on Superpowers for
  brainstorming → writing-plans → finishing-a-branch rather than re-porting obra's prose. Fewer
  moving parts, less drift, more honest.
- **Total-billing savings (Meter B).** We do **not** claim to be cheaper-per-bill. A measured N=5
  head-to-head was a **tie** ($3.90 vs $4.03 median, ranges fully overlap
  `[V campaign-n5-2026-06-14.md]`). The scale payoff is a **capability**, not a discount:
  Ultrapowers' flat coordinator lets long/many-task builds *complete at all*, where Superpowers'
  growing controller would overflow the context window and force compaction or failure
  (`[V token-benchmark.md]` scaling model; the Meter-B crossover itself is **unmeasured**). Claiming
  a billing saving would be false.
- **Inventing the flat coordinator or the dynamic critic.** The coordinator flatness is Anthropic's
  Workflow primitive; the critic pattern exists in CAMEL/Magentic-One. We host and combine; we don't
  claim the parts.
- **Being a general multi-agent framework.** No swarm, no agent marketplace, no broad
  orchestration surface, one disciplined SDD/TDD build loop on a flat coordinator. **No
  speculative surface.**
