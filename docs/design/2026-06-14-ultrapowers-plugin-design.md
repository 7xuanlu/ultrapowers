# Design spec: the `ultrapowers` Claude Code plugin (v1, pre-launch)

*Status: design — corrected after adversarial review + platform verification. Date: 2026-06-14.*
*Packages the existing Workflow-coordinator harness as a lean, command-driven Claude Code plugin.
Authoring rules from the official `plugin-dev` skill + the `superpowers` plugin; structure mirrors
the sibling `council-rigor` plugin spec. The original draft was reworked after an adversarial
review found three criticals (see §14) — all confirmed against source and folded in here.*

## 1. Summary

Package **ultrapowers** — an unattended SDD/TDD build harness implemented as a Claude Code
**Workflow** (deterministic JS coordinator hosting Superpowers' discipline on disposable
subagents) — as an installable plugin whose **user-only entry is a slash command**,
`/workflows-driven-development`. The command owns the human gates and dispatches the Workflow;
a SessionStart **hook** symlinks the bundled engine into `~/.claude/workflows/` so the Workflow
resolves by name (Workflows are **not** a plugin component — §7).

ultrapowers **complements, does not replace, superpowers**. The SDD/TDD discipline is inherited
verbatim from Superpowers (Jesse Vincent / @obra, MIT). ultrapowers' contribution: (a) hosting that
discipline on the Workflow primitive so coordinator context stays flat over long runs (the
Workflow's property, framed as such), and (b) one scarce mechanism — **re-witness RED**.

## 2. Goals / non-goals

**Goals (v1)**
- One user-only entry: `/workflows-driven-development`, a **command** with
  `disable-model-invocation: true` (it spends real tokens → user-initiated; this field is
  **command-only** — skills can't be made user-only `[VERIFIED: command-development/SKILL.md:196;
  skill-development/SKILL.md:28-33 lists only name/description]`).
- A SessionStart **hook** that idempotently symlinks the bundled engine `.js` into
  `~/.claude/workflows/` so `Workflow({name:'ultrapowers-development'})` resolves (§7).
- Lean progressive disclosure: a thin command body + reference docs the command `Read`s on demand.
- Two modes: **default** (one disciplined pass) and **`--thorough`** (opt-in completeness-critic
  loop) — the latter is **goal-mode only** (it is a no-op on a raw task list — §5, C2).
- Built-in mechanisms always on: TDD, two-stage opus review (fail-closed), **re-witness RED**
  (default-on, ~free), deterministic gating/escalation, per-task commit.
- `bench/` retained as the eval moat. Standard packaging: `.claude-plugin/plugin.json` +
  `marketplace.json` (marketplace name `ultrapowers-dev`), MIT, attribution preserved.

**Non-goals (deferred)**
- ❌ Discovery/bootstrap skill (a `using-ultrapowers` injector) — dropped for v1.
- ❌ `parity` as a product mode — it is a `bench/`-only fairness control (`redWitness:false` to match
  superpowers' review-stage set), never a product flag.
- ❌ Making the Workflow a "real" plugin artifact — not supported by the platform (§7).
- ❌ `scriptPath` + `${CLAUDE_PLUGIN_ROOT}` dispatch — that var does **not** expand in a Workflow
  tool argument `[VERIFIED: plugins-reference §Environment variables]`; we dispatch by **name**.
- ❌ P2 mutant / diverse-lens panel / pluggable-implementer registry — roadmap, not v1.

## 3. Architecture

```
ultrapowers/                          ← plugin root = repo root
├── .claude-plugin/
│   ├── plugin.json                   name "ultrapowers", v0.1.0, MIT, "complements superpowers"
│   └── marketplace.json              marketplace "ultrapowers-dev", lists ultrapowers (source "./")
├── commands/
│   └── workflows-driven-development.md   USER-ONLY (disable-model-invocation:true). Renames the
│                                         existing commands/ultrapowers.md. Lean body: the human
│                                         gates (plan approval, critical review) + dispatch of
│                                         Workflow({name:'ultrapowers-development'}) + pointers.
├── hooks/
│   ├── hooks.json                    SessionStart matcher
│   └── session-start                 idempotent: ln -sf "$CLAUDE_PLUGIN_ROOT/workflow/
│                                     ultrapowers-development.js" ~/.claude/workflows/ (§7)
├── workflow/
│   └── ultrapowers-development.js     the engine — SINGLE SOURCE OF TRUTH (symlinked out by the hook)
├── reference/   ── docs the command Reads on demand ──
│   ├── task-list.md                  args.tasks = [{id,spec}] format + the string-drops footgun
│   ├── harness.md                    Workflow coordinator: args, model routing, ADR-0001
│   ├── re-witness-red.md             headline mechanism (ADR-0002): built-in, ~free, boundary, evidence status
│   └── gating.md                     deterministic replan / verify / escalate (binary, bounded)
├── bench/         ← the EVAL MOAT (existing) — proof, NOT loaded at runtime
├── docs/          ← ADRs, benchmarks, research, roadmap, this spec
├── tests/re-witness-red/             mechanism proof (existing)
└── README · NOTICE · LICENSE · LICENSE-superpowers · package.json
```

**Progressive disclosure (corrected — not automatic):** "loaded on demand" means *the command body
instructs a `Read`* of a `reference/*.md` at the step that needs it — there is no per-pointer
auto-loader. The footprint claim ("the command never pays for docs it doesn't read") holds only for
files the command does not `Read`. Standing context cost is ~0 because the command is user-only and
never auto-fires.

`[impl-verify]` Whether `${CLAUDE_PLUGIN_ROOT}` expands inside **command body** content (the
verified contexts are skill/agent content, hook/monitor commands, MCP/LSP configs — command body
was not enumerated). If it does not, the command keeps essential guidance inline and references the
repo's `docs/` by relative path; deep `reference/` files may instead be wrapped in a thin skill
(skills support `references/` load-on-demand) — decided at impl time, not assumed here.

## 4. Invocation surface (UX)

```
/workflows-driven-development <goal>                     plan → build the planned tasks → stop
/workflows-driven-development <goal> --thorough          + completeness-critic loop until clean (goal mode)
/workflows-driven-development --tasks <tasks.json>       advanced: run a pre-decomposed [{id,spec}] list
/workflows-driven-development help                       modes, cost, task-list format
```

Goal-first, because `--thorough` (the completeness critic) **only runs in goal mode** — in
task-list mode the critic never runs (C2). The command: (1) for a goal, plans and presents the plan
at the human-approval gate (ADR-0001: a Workflow can't pause mid-run, so approval happens *before*
dispatch); (2) for `--tasks`, validates the list and **rejects bare strings** (the footgun),
warning that `--thorough` is ignored; (3) dispatches `Workflow({name:'ultrapowers-development',
args:{…}})`; (4) surfaces the final JSON, the per-model token/cost report, and any `BLOCKED`/
escalation at the critical-review gate.

## 5. Modes

| mode | what runs | applies to |
|---|---|---|
| **default** | per task: TDD → impl (cheap model) → 2-stage opus review (fail-closed) → bounded fix-loops → **re-witness RED** → per-task commit; then a final integration review | goal **and** `--tasks` |
| **`--thorough`** | after the build, a completeness critic inspects the tree, injects net-new tasks, and **loops until no new findings** (`loopUntilClean:true`) | **goal mode only** — silently inert on `--tasks` `[VERIFIED: engine :779 `if(!goal)break` before the loop gate; comment :127 "Tasks-mode never ran the critic"]`; the command warns if combined with `--tasks` |

## 6. Built-in mechanisms (always on — not modes, not toggles)

- **Hosted on the Workflow primitive** (ADR-0001): deterministic JS coordinator; intermediate
  `agent()` results live in script variables, never re-enter an LLM context → flat coordinator
  context (the Meter-A property; **the Workflow's property, not ours**).
- **Model routing** (SDD least-powerful-per-role): implementer cheap (`implModel`); reviewers /
  critic / integration `opus`; verify + re-witness `haiku`; graduated escalation to `opus` on
  repeated implementer failure.
- **Two-stage review, fail-closed** (Superpowers reviewer prompts, verbatim): spec-compliance then
  code-quality; reviewer error fails *closed*.
- **re-witness RED** (ADR-0002): after green, revert this task's prod files (keeping the tests),
  re-run; if still green the test never exercised the impl → send back. **Default-on, one haiku
  call/task, fail-open; gated on `commit:true` + a `verifyCmd`** (silently inert without them).
  **Evidence status (honest):** *proven on a seeded vacuous test* (`tests/re-witness-red/`); it has
  **not yet fired on an organic benchmark task** (HANDOFF: "not exercised; tasks lacked the
  weak-test failure mode"). Headline = the mechanism + the model-fair eval, with this caveat stated,
  not hidden.
- **Deterministic gating/escalation** (`docs/design/gating-and-escalation.md`): replan / verify /
  escalate are binary + bounded, never confidence-gated.

**Implementer default:** the engine defaults to `codex` `[VERIFIED: engine :94]`. For the product
we **propose** `implementer:"claude"` (sonnet) so a clean install has no external-CLI dependency;
`codex`/`gemini` stay opt-in. Unratified (D9, §13) — narrated as proposed, not settled.

## 7. Packaging & the Workflow bridge (the load-bearing correction)

Workflows are **not** a plugin component `[VERIFIED: plugins-reference — components are
skills/agents/hooks/MCP/LSP/monitors/themes/bin; no `workflows/`]`, and `${CLAUDE_PLUGIN_ROOT}`
does **not** expand in a `Workflow({scriptPath})` arg. So the engine cannot be shipped as a plugin
artifact dispatched by path. Bridge:

- The plugin bundles the engine at `workflow/ultrapowers-development.js` (single source of truth).
- A **SessionStart hook** (`hooks/session-start`) idempotently symlinks it into `~/.claude/workflows/`
  (`${CLAUDE_PLUGIN_ROOT}` **does** expand in hook commands). By-name dispatch then resolves. This is
  the same SessionStart-hook mechanism `superpowers` itself uses, and it **eliminates the old
  "two copies in sync" burden** — the symlink always points at the plugin's current engine.
- **Uninstall:** document the symlink as a side-effect; provide a cleanup (the symlink dangles
  harmlessly if the plugin is removed; a guard in the hook can prune a dangling self-symlink).
- `[impl-verify]` SessionStart ordering: the Workflow name-registry is built at session start and
  the hook also runs at session start — confirm the symlink exists *before* the registry is read
  (else it resolves on the *next* session). If racy, the command falls back to `scriptPath` with a
  resolved absolute path it computes at runtime.

## 8. Migration plan (implementation phase — POST-benchmark)

⚠️ **Hard constraint:** `workflows/ultrapowers-development.js` is invoked **right now** by the
running benchmark (B-full arms call it by name). **No moves until the ladder completes**, on a
dedicated worktree/branch (not `fix-bench-bare`). **Three** live references to reconcile (the draft
missed the third):

1. `bench/run.sh` `WORKFLOW_JS` path.
2. `~/.claude/workflows/ultrapowers-development.js` (now produced by the symlink hook, not a manual copy).
3. **`commands/ultrapowers.md`** — the existing consolidation command that dispatches the engine
   **by name** `[VERIFIED: commands/ultrapowers.md:23,30,65]`. It is **renamed** to
   `commands/workflows-driven-development.md`, not duplicated. (Keeping `/ultrapowers` as a short
   alias is an open UX question, §11.)

Steps: create manifests + hook → move engine to `workflow/` → rename/rewrite the command → lift
`reference/*.md` from existing ADRs/gating/the task-args memory (no new prose invented) → update
`bench/run.sh` + `HANDOFF.md` → `node --check` + a `bench/` dry-run smoke → verify the symlink hook.

**Name reconciliation** (reviewer flagged "three names"): engine workflow stays
`ultrapowers-development` (renaming `meta.name` breaks by-name dispatch — avoid); user-facing
command is the verb `/workflows-driven-development`; plugin/brand is `ultrapowers`. Documented so
the mapping is intentional, not drift.

## 9. Eval moat

`bench/` stays as the published, model-fair benchmark — the durable credibility asset. It enforces
the fairness controls (F1–F16), the corrected metering (headline = `total_cost_usd` + `modelUsage`),
and the cumulative-prefix scaling ladder. The pre-launch ladder (A-opus vs B-full, prefixes
{6,12,24}, `/council`-reviewed) is the first published result —
`docs/benchmarks/cost-and-context-ladder-2026-06-14.md`. Its honest headline is **session-context
accumulation rate** (A ~5K vs B ~0.8K tok/task, ≈6× slower; on a 1M-context coordinator neither
walls in normal use — opus 4.8 is 1M at standard pricing), NOT a cost percentage (cost is ≈parity,
within N=1 noise; the bounded-coordinator payoff is at extreme scale). Never loaded at runtime.

## 10. Positioning / attribution (must not drift)

"Complement, not replace." Credit obra throughout; keep `NOTICE` + `LICENSE-superpowers`; close the
`NOTICE` legal-name TODO (roadmap P0). The token-efficiency win is **the Workflow primitive's**
property. Honest headline = **re-witness RED (with its evidence caveat, §6)** + the model-fair eval.
Pre-launch P0 blockers: these manifests + the hook, `NOTICE` legal name, `SECURITY.md` (unattended
code execution).

## 11. Open questions / impl-verify flags

- `[impl-verify]` `${CLAUDE_PLUGIN_ROOT}` in **command-body** content (§3) — drives whether deep
  references live in the command, the repo `docs/`, or a thin skill.
- `[impl-verify]` SessionStart symlink vs Workflow-registry **ordering** (§7).
- `[open]` Short alias `/ultrapowers` alongside `/workflows-driven-development`? (§8)
- `[open]` Product default implementer `claude` vs the engine's `codex` (D9, §6).
- `[design-note]` **Mechanical steps pay an LLM tax under the Workflow sandbox.** The Workflow JS
  coordinator has no shell/git/fs, so even `verify` (run tests, read exit code) and `re-witness`
  (git revert → re-run → restore — all deterministic) must run through a cheap `haiku` subagent
  relay (~8% of the harness's bill in the 2026-06-14 ladder). A v2 **standalone Node runner**
  (the re-host path, §forward-compat) makes these **free deterministic code** and removes the haiku
  line. Open trade-off: the free flat-context coordinator (the Workflow primitive's win) vs the
  forced-LLM-for-shell cost it imposes. See `docs/benchmarks/cost-and-context-ladder-2026-06-14.md`.

## 12. Testing strategy

- **Command dispatch:** `help` lists modes; bad/empty `--tasks` rejected with `{id,spec}` guidance;
  `--thorough` warns on `--tasks`; `--thorough` sets `loopUntilClean:true` in goal mode.
- **Hook:** symlink created idempotently; by-name dispatch resolves; dangling-symlink guard works.
- **Engine unchanged:** `node --check` after the move; `bench/` dry-run green after the path update.
- **Mechanism proof:** `tests/re-witness-red/seed.sh` still catches a seeded vacuous test.
- **Plugin loads:** install from the local marketplace; the command resolves.

## 13. Decision log

| ID | Decision | Status |
|---|---|---|
| D1 | User-only entry = **command** `/workflows-driven-development` (`disable-model-invocation:true`); **not** a skill (skills can't be user-only) | ✅ accepted (corrected from draft) |
| D2 | Progressive disclosure: lean command body + `reference/*.md` Read on demand | ✅ accepted (auto-load claim softened) |
| D3 | Two modes: `default` + `--thorough`; `--thorough` is **goal-mode only** | ✅ accepted (scoped after C2) |
| D4 | `redWitness` built-in/default-on (~free); never a user toggle; evidence caveat stated | ✅ accepted |
| D5 | `parity` is bench-only; dropped from product | ✅ accepted |
| D6 | No discovery/bootstrap skill in v1 | ✅ accepted |
| D7 | `bench/` retained as the eval moat | ✅ accepted |
| D8 | All file moves deferred until the running benchmark completes | ✅ accepted (operational) |
| D9 | Product default implementer = `claude`/sonnet | 🟡 proposed (§11) |
| D10 | Engine reaches `~/.claude/workflows/` via a **SessionStart symlink hook**; dispatch **by name** (Workflows aren't pluginnable; `${CLAUDE_PLUGIN_ROOT}` doesn't expand in Workflow args) | ✅ accepted |
| D11 | Engine `meta.name` stays `ultrapowers-development`; command renamed from `/ultrapowers` | ✅ accepted |

## 14. Adversarial review — changes folded

A fresh-eye review (verdict: **needs-rework**) found three criticals, all confirmed against source
and corrected above:

1. **`disable-model-invocation` is command-only, not a skill field** → entry is now a command (D1).
2. **`--thorough` is a no-op on a task list** (`engine :779/:127`) → scoped to goal mode (D3, §4/§5).
3. **The file-move missed `commands/ultrapowers.md`** (dispatches by name) and the Workflow-packaging
   reality → §7 symlink-hook bridge + §8 three call-sites + by-name dispatch (D10/D11).

Important fixes also folded: progressive-disclosure auto-load claim softened (§3); re-witness
evidence caveat added (§6); D5/D9 cross-ref corrected; marketplace name set (`ultrapowers-dev`);
three-names reconciliation (§8). Platform facts independently verified via the Claude Code docs
(Workflows not a plugin component; `${CLAUDE_PLUGIN_ROOT}` non-expansion in Workflow args;
`disable-model-invocation` command-only).
