# ultrapowers

**Unattended, flat-coordinator SDD/TDD build harness for Claude Code.** Hand it a goal or a
task list; it plans, builds each task under strict TDD, reviews every task with a separate
capable model, loops a critic until the goal is satisfied, and gates the whole change behind
a final adversarial review — with the human only at plan-approval and critical-review gates.

> **Status: alpha.** One developer's tool, hardening in the open. Expect sharp edges.

---

## What it is

ultrapowers is a Claude Code **Workflow** (a deterministic JavaScript coordinator) that runs
[Superpowers](https://github.com/obra/superpowers)' SDD/TDD discipline on disposable subagents:

```
goal ─▶ plan
        ⏸ GATE 1 — you approve the plan, then walk away
        ─▶ per task (SERIAL):
             implement (cheap model, strict TDD red-green-refactor)
               ─▶ deterministic gate (run the real test suite)
               ─▶ re-witness RED   (strip the impl, prove the test fails without it)
               ─▶ spec review  (capable model, fail-closed, "do not trust the report")
               ─▶ quality review (capable model, fail-closed, YAGNI/anti-gaming)
               ─▶ fix-loop
        ─▶ dry-until-clean critic adds tasks until the goal is met
        ─▶ final adversarial integration review
        ⏸ GATE 2 — every finding from the run surfaces to you, before merge
```

The build runs **unattended between the two gates**: a Workflow takes no mid-run human
input, so the harness never stops to ask. Anything it hits — a failed task, a BLOCKED
implementer, gaps the critic reopened, the integration verdict — is collected and surfaced
to you at GATE 2, as a reviewable branch + verdict, not a stream of interruptions.

Because the coordinator is a script (not an LLM turn), the **main session's context stays
flat** for the whole run — only the final result lands in your window. The work tokens are
paid by disposable subagents, which run on cheap, role-routed models.

## Why it exists (and how it relates to Superpowers)

ultrapowers stands on **Superpowers** by Jesse Vincent ([@obra](https://github.com/obra)).
Its discipline — watch-it-fail TDD, two-stage fail-closed review, least-powerful-model
routing — is Superpowers', adopted **verbatim**, with gratitude. See [`NOTICE`](./NOTICE).

Superpowers is, by design, **prompt-driven and in-session**, and its maintainer has been
deliberate about that. Asked whether orchestration should move to an external coordinator, obra
answered: *"It's purely prompt driven. It seems to work quite well in practice and is improving as
the models improve. I think there is a ton of value in external orchestrators, but moving to that
model is dramatically more complicated for most users"*
([#1041](https://github.com/obra/superpowers/issues/1041)). For Superpowers' broad audience that is
the right call, and we respect it.

**ultrapowers' very name comes from a proposal Superpowers declined.** Issue
[#1647](https://github.com/obra/superpowers/issues/1647) — *"a new workflow-driven-development
skill-command … the workflow-native sibling of SDD"* — was opened by
[@codename-cn](https://github.com/codename-cn) and closed **not-planned** by obra, who noted it was
an untested, agent-authored RFC (*"made up by an agent that didn't even test it"*). **That critique
is the spec.** ultrapowers is that declined idea actually **built and tested**: SDD/TDD discipline
hosted on Anthropic's deterministic **Workflow** primitive (flat coordinator, survives arbitrarily
long), proven by a reproducible re-witness-RED self-test and a measured N=5 benchmark — for the
narrower audience that wants to hand off a **whole goal and walk away**. It adds two things
Superpowers doesn't ship: a **dynamic loop-until-clean critic** and a **mechanical re-witness-RED**
test-integrity check.

This is **complement, not replace** — with thanks to [@obra](https://github.com/obra) for the
discipline ultrapowers runs and for a principled decline, and to
[@codename-cn](https://github.com/codename-cn) for the original workflow-driven-development idea.

**Honest scope of the contribution** (see [`docs/research/oss-landscape.md`](./docs/research/oss-landscape.md)):
- The **flat coordinator** is a property of Anthropic's Workflow primitive — **not our invention**.
  Our contribution is *choosing to host SDD/TDD on it*, which Superpowers structurally won't.
  This is a **scaling/capability** property, not a cost discount: on a measured head-to-head
  (N=5, two small tasks/run) total cost was a **tie** — $3.90 vs $4.03 median, ranges fully
  overlap (`[V docs/benchmarks/campaign-n5-2026-06-14.md]`). The flat coordinator pays off on
  **long/many-task builds**, where Superpowers' in-session controller grows until it overflows
  the model's context window and must compact or fail — not as a per-bill saving at normal sizes.
- Dynamic task-adding critics already exist elsewhere (CAMEL Workforce, Magentic-One). Novel
  only *in this combination*.
- **re-witness RED** is the one mechanism we could not find shipped in any comparable build
  loop. It's the headline.
- The SDD/TDD discipline is **inherited**, not invented.

**If you want interactive, human-in-the-loop development, use Superpowers** — it's the parent
and it's better at that. ultrapowers is for unattended hand-offs.

## Where it fits in the Superpowers lifecycle

ultrapowers doesn't replace the front of the lifecycle — it **continues** it. Use Superpowers for
the interactive, judgment-heavy front end (where its friction is load-bearing), then hand the plan
to ultrapowers to build unattended:

```
SP brainstorming ─▶ SP writing-plans ─▶ UP /workflows-driven-development ─▶ SP finishing-a-branch
   (tease out         (break into          (build it — unattended —            (merge / PR
    the spec)          bite-size tasks)      until the goal is met)              decision)
```

It begins exactly where you'd otherwise reach for `subagent-driven-development` — same plan, same
discipline — but runs on a flat coordinator, so the build survives arbitrarily long. You can also
hand it a raw goal and let it plan; the front-end skills just give it a sharper spec to start from.

## Design philosophy — a flat orchestrator

One idea underneath everything: **the coordinator is code, not a model turn.**

- **Zero LLM calls in the loop** — the controlling session's context never grows with the build,
  so it can't compact or overflow. The reasoning happens in subagents, elsewhere.
- **Disposable subagents pay the token cost** — once, then they're discarded; heavy context never
  accumulates in your window.
- **Durable state lives in files** (task list, per-task logs), not in a growing conversation — the
  run is crash-resumable and unbounded in length.
- **Least-powerful-model routing** — cheap models implement, capable models review; you don't pay
  top-tier rates for mechanical work.

That is what makes "hand off a whole goal and walk away" actually hold.

## Cost: measured to 24 tasks, projected to a 1M window

Model-fair head-to-head — **same** implementer (sonnet) and reviewers (opus) on both arms; the
*only* structural difference is where the orchestration loop lives. In the figure, **solid lines are
measured** (an N=1 ladder at 6/12/24 tasks, billed `total_cost_usd`); past the **task-24 cutoff** the
**dashed lines are a projection** (`[V docs/benchmarks/cost-and-context-ladder-2026-06-14.md]`,
`/council`-reviewed). One frame, before and after.

![measured then projected — cost on par early; coordinator context and cost diverge at scale](docs/benchmarks/cost-projection-2026-06-14.svg)

**Measured (≤24 tasks) — the two numbers for users:**

- **Total cost is on par** — within ~6% the whole way to 24 tasks ($25.95 vs $28.19; the 12-task
  point even *reverses*), at **equal quality** (both 24/24 tasks green; ultrapowers wrote 192 tests
  vs 145). There is **no per-bill discount** at normal sizes.
- **The coordinator's session context grows ~6× slower** — **0.8K vs 5K tokens/task** (at 24 tasks,
  59K vs 172K). superpowers runs the loop *in-session*, so its context climbs with every task;
  ultrapowers' coordinator is a script, so its session only carries the task list in and the result
  out. On a 1M-context model **neither arm walls in normal use** — at realistic sizes this is a
  *tie* you'd pick on features, not cost. N=1 per point — these locate the shape, not a CI.

**Projected (past task 24) — where the flat coordinator becomes a cost win:** a *single
long-running goal* runs for hundreds of tasks. superpowers' coordinator window grows every task and
is **re-read by the model on every turn** (a cache-read tax that grows with the window); ultrapowers'
coordinator is bounded, so its cost stays ~linear. Extrapolating the measured ladder by that
mechanism, up to where superpowers' coordinator approaches its 1M ceiling:

| tasks | SP window | **SP cost** | **UP cost** | ratio |
|--:|--:|--:|--:|--:|
| **24** (measured) | 172K | **$28.19** | **$25.95** | 1.09× |
| 48 | 292K | ~$64 | ~$53 | 1.21× |
| 96 | 532K | ~$158 | ~$110 | 1.44× |
| 144 | 772K | ~$282 | ~$171 | 1.65× |
| **~180** (SP nears 1M) | ~950K | **~$395** | **~$219** | **~1.8×** |

**Projected headline:** by the time superpowers' coordinator fills toward 1M (~task 180 in one
hand-off), ultrapowers runs it for **~$219 vs ~$395 — roughly 1.8× / ~$175 / ~45% cheaper.** UP's
coordinator at that point is still ~188K (bounded; never walls).

> **The dashed region is PROJECTED, not measured — honest disclosure.** It is an extrapolation from
> an **N=1** ladder via the cache-read-tax mechanism; the band on the plot is the single-run
> uncertainty (~1.3×–2.4× at task 180, central 1.8×). The clean *measured* signal is the
> window-growth rate (5K vs 0.8K tok/task); the dollar curve rides on it. It is **sizable, not
> "massive"** — a 3×+ gap would only appear *past* the 1M wall, in superpowers' forced-compaction
> regime, which we do **not** model. Reproduce/audit the model in
> [`bench/plot-cost-projection.py`](./bench/plot-cost-projection.py) and
> [`docs/benchmarks/cost-and-context-ladder-2026-06-14.md`](./docs/benchmarks/cost-and-context-ladder-2026-06-14.md).

## Install

```
/plugin marketplace add 7xuanlu/claude-plugins
/plugin install ultrapowers@7xuanlu
```
Or install this repo directly (it is its own single-plugin marketplace, also named `7xuanlu`):
```
/plugin marketplace add 7xuanlu/ultrapowers
/plugin install ultrapowers@7xuanlu
```
Start a new session so the SessionStart hook runs — it symlinks the engine into
`~/.claude/workflows/ultrapowers-development.js`. Then:
```
/workflows-driven-development help
```
If the command does not resolve by name in a freshly-installed session, it falls back to
dispatching the engine by `scriptPath` automatically (see the command's dispatch fallback).

**Requirements:** Claude Code with the Workflow tool, and Node (the engine is checked on Node 20;
newer is fine). The default implementer (`claude`) needs no external CLI. The optional `codex` /
`gemini` implementers require those CLIs installed plus a sandbox carve-out — see **Safety** below.

## Safety — it runs code unattended

ultrapowers **writes files, runs your `verifyCmd`, and makes git commits** in the target repo
across many disposable subagents, with the human only at plan-approval and critical-review gates.
Before you run it, read **[`SECURITY.md`](./SECURITY.md)** — it is the threat model. In short:

- **Run it only on code and in a repo you trust**, in an isolated worktree/branch (the command
  creates one if you're on `main`). Review the branch before merging.
- **`verifyCmd` executes with your permissions** — never point it at untrusted scripts.
- **External implementers (`codex`/`gemini`) run unsandboxed** and need an explicit allow-list +
  sandbox carve-out. The default `claude` implementer does not. Details and rationale in
  [`SECURITY.md`](./SECURITY.md).

## Layout

| path | what |
|------|------|
| `.claude-plugin/` | `plugin.json` + `marketplace.json` — installable plugin manifests |
| `commands/workflows-driven-development.md` | the `/workflows-driven-development` command (user-only; owns the human gates) |
| `workflow/ultrapowers-development.js` | the harness (the deterministic coordinator) |
| `hooks/` | SessionStart hook — symlinks the engine into `~/.claude/workflows/` |
| `reference/` | load-on-demand command docs (task-list, harness, re-witness-red, gating) |
| `docs/decisions/` | architecture decision records |
| `docs/research/oss-landscape.md` | competitive / novelty analysis (evidence-tagged) |
| `docs/benchmarks/token-benchmark.md` | token-cost model + measured results |
| `tests/re-witness-red/` | reproducible proof of the re-witness-RED catch path |
| `docs/DISCUSSION.md` | running design log / open questions |

## Contributing

Contributions are held to the same bar ultrapowers enforces on the code it builds — TDD,
re-witness-RED, surgical changes. Start with [`CONTRIBUTING.md`](./CONTRIBUTING.md) and
[`AGENT.md`](./AGENT.md) (the agent/operator manual); all participation is under the
[`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md) (Contributor Covenant).

## License

ultrapowers is [MIT](./LICENSE). Per that license, the source of the embedded discipline is
credited: it embeds verbatim MIT-licensed text from Superpowers (© 2025 Jesse Vincent), whose
license is reproduced in [`LICENSE-superpowers`](./LICENSE-superpowers) and whose embedded files are
enumerated in [`NOTICE`](./NOTICE).
