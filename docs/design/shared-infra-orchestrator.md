# Shared-infra orchestrator — one engine, hosted by CC or Codex (design exploration)

Status: fork DECIDED (2026-07-07, user-approved) — **B now (reuse CC's Workflow runtime,
headless), C on trigger (bespoke shim)**. B mechanics validated live the same day (probes
below, ~$1.4). No *build* trigger has fired — validation de-risks P2, it does not pull it
forward. This doc completes the exploration split
across [`agnostic-implementer-orchestrator.md`](./agnostic-implementer-orchestrator.md) (the
*implementer* axis) and the README roadmap line "hosting the coordinator on other agents is
the main open goal, not a promise yet" (the *host* axis). Provenance: the 2026-07-06/07
harness-optimization session (OMC/OMO forensic eval; 5-stage intent→completion field survey)
and `~/.claude/harness-retro/optimal-setup-blueprint.md` (settled: per-platform foundations
unified by portable rules; OMC's cross-CLI team layer shelved with a trigger). This doc is
the in-house design that settlement anticipated — steal ideas, build thin, adopt nothing
wholesale.

## The question, made precise

"Support not just CC but also Codex" is three different products. Naming them removes the
ambiguity that has blurred every prior discussion of "multi-CLI":

| layer | meaning | status |
|---|---|---|
| **L1 — implementer-agnostic** | one coordinator drives claude / codex / gemini as interchangeable **workers** | designed (agnostic doc) + partially built: "Now" hardening shipped; the interface/registry refactor is roadmap **P1 "the unlock"** `[V docs/roadmap.md §Pluggable implementers]` |
| **L2 — host-agnostic** | the coordinator itself **runs under** CC (Workflow tool), Codex (plugin skill), or bare node | README roadmap goal — **this doc** |
| **L3 — cross-CLI peer teams** | claude+codex agents talking as peers (OMC's tmux team layer) | **non-goal** `[V docs/roadmap.md §Non-goals: "no general multi-agent framework"]`; blueprint shelf item with trigger; OMC is the quarry if that trigger ever fires — not a build here |

L2 is the "shared infra" ask. The payoff is strategic, not cosmetic: the engine's
verified-completion machinery (deterministic gate, re-witness RED, fail-closed two-stage
review, descope guard) is the strongest stage-4 tooling in this stack, and the 2026-07-06
field survey found stage 4 shipped by **nobody** as software. Making the engine host-agnostic
makes that machinery portable infrastructure — the same discipline reachable from whichever
CLI the operator (or a cron job, or CI) happens to live in.

## The fork — A/B/C, decided

The Workflow tool does not expose its runtime: `agent()`/`pipeline()` are globals injected
into the script, **not** SDK exports `[V @anthropic-ai/claude-agent-sdk 0.3.202 sdk.d.ts]`.
So "host elsewhere" forks three ways:

| fork | mechanism | verdict |
|---|---|---|
| **A — adopt** a foreign substrate (durable-exec engine, LLM framework, whole product) | replace the coordinator | **rejected** — blueprint settlement + the sweep below: nothing fits zero-infra + files-as-state |
| **B — reuse** CC's own Workflow runtime, headless | Agent SDK `query()` (or `claude -p`) dispatches the Workflow tool from any process | **chosen + validated** — see "Fork B" under Design |
| **C — replicate** the runtime kernel | `bin/up-run.mjs` shim: `agent()` + `log()` + journal + budget | **trigger-owned** — spec kept under Design |

B costs a dispatch skin; the engine *and the runtime* travel unchanged. C stays a specified
blueprint until a trigger fires:

- **(a)** a coordinator must run on a box with **no CC install/auth** — B's hard dependency,
  by construction;
- **(b)** ACP ships **schema-typed final results** (today it has recoverable per-call
  permission semantics — the L1 prize — but no typed result channel, a GATE-2 blocker) and
  codex lands native ACP (still an open request `[V openai/codex#9085]`);
- **(c)** the adopt candidate below passes a forensic eval — which flips C to *adopt*, not build.

### Is C worth building? — audit-sweep verdict (73 agents, adversarially verified, 2026-07-07)

- **Durable-exec engines** (Temporal, Inngest, Restate, trigger.dev, DBOS) all fail the
  zero-infra bar — DBOS closest, but its TS SDK mandates Postgres. The bespoke JSONL journal
  stands; DBOS's checkpoint model is the design template to steal.
- **LLM orchestration frameworks** (LangGraph et al.) are API-shaped and heavy — wrong layer.
- **The C kernel already exists as official SDKs**: `@anthropic-ai/claude-agent-sdk`
  (structured outputs fail CLOSED) + `@openai/codex-sdk` (`outputSchema` exists but has **no
  fail-closed retry**, plus an open bug: silently dropped when MCP/tools are active). If C
  fires, it is SDK assembly, not CLI scraping.
- **bernstein** (sipyourdrink-ltd/bernstein, ★641, Python, active 2026-07): deterministic
  zero-LLM coordinator + Claude/Codex children + per-child sandbox + resume + gates + HMAC
  audit log — the one whole-product adopt candidate. Forensic eval required before any adopt
  call (the Ruflo/OMC lesson: stars ≠ wiring).
- **Direct replicas of the `agent()`/`pipeline()` surface exist**
  (six-ddc/codex-dynamic-workflows ★5, "Same agent()/parallel()/pipeline() API";
  betaHi/pi-loom ★1) — C is not greenfield, but both are API-backed rather than
  CLI-children: precedent, not adoption.

Sweep evidence: 61 confirmed / 6 refuted findings; no refutation load-bearing
`[V sweep output file, 2026-07-07]`.

## Why L2 is small — measured, not hoped

The engine is already nearly host-free. Its verified consumption of the Workflow runtime
(`workflow/ultrapowers-development.js`, 1105 lines, audited 2026-07-07):

| runtime API | engine use | shim obligation |
|---|---|---|
| `agent(prompt, opts)` | every dispatch, via the `agentSafe` wrapper (`:198-201`) with `{schema, label, model, effort, phase}` | spawn a child CLI, enforce the schema |
| `log(msg)` | ~40 sites, progress narration | print + append to a run log |
| `budget.total/remaining()` | **optional** — already guards `typeof budget === 'undefined'` (`:1002-1004`) | may omit; per-child cost sum if present |
| `args` as JSON string | parsed once into `_args` (`:88`) | argv or stdin JSON |
| `return <object>` | one rich result object (file tail) | print JSON to stdout |
| **not used** | `parallel()`, `pipeline()`, `workflow()`, fs, `Date.now()` | nothing — the loop is serial and pure by design |

No `parallel()`/`pipeline()` means a host shim is `agent()` + `log()` + a resume journal —
not a Workflow-runtime reimplementation. Under fork B even the shim column is moot — the
runtime itself travels; this table remains the honest scope estimate for fork C.

The two human gates are already host-side, not engine-side: GATE 1 (plan approval) and
GATE 2 (critical review of the returned object) live in
`skills/workflows-driven-development/SKILL.md` (`:11, :32, :69`), because a Workflow cannot
pause mid-run (ADR-0001, restated at SKILL `:38`). So a "host" is precisely: **collect args →
GATE 1 → dispatch engine → GATE 2 over the result object**. That contract already exists; L2
is implementing it twice more, thinly.

In-house precedents already prove every risky piece:

- Headless `claude -p` under OAuth works on this machine; `--bare` does not (auth +
  plugin-discovery holes), and unattended runs need `bypassPermissions`
  `[V docs/DISCUSSION.md, ARM-A/B verification 2026-06-14]`.
- `codex exec --ephemeral` batch dispatch under a process-group watchdog is production
  behavior today (`:380-399`, WATCHDOG_PERL `:345` — stock perl, host-portable).
- Dual-shipping a plugin to Codex's plugin system is a solved packaging problem: wenlan
  ships there (`~/.codex/plugins/cache/**/wenlan`), OMO proves it at scale
  (`~/.codex/plugins/cache/sisyphuslabs/omo`) `[V cache listing 2026-07-07]`.
- boule's conduit agents relay JSON verbatim to external CLIs (codex / agy) in production —
  the second in-house cross-CLI dispatch precedent `[V boule agents/]`.

## Design

```
                    ONE ENGINE  (workflow/ultrapowers-development.js)
                    consumes: agent() · log() · [budget] · args → result object
                          ▲                                ▲
            hosted by     │                                │ workers via L1 adapters
   ┌──────────────────────┴───────────┐                    │ (registry refactor, roadmap P1)
   │ CC host (today)                  │           claude / codex / gemini / generic-cli
   │   runtime  = Workflow tool       │                    │
   │   gates    = /workflows-driven-  │           contract: {brief, writableRoots, denyPaths}
   │              development skill   │                     → {status, diff}
   ├──────────────────────────────────┤           verify:  baseSha vs WORKING TREE diff
   │ headless host (fork B —          │                     (shared step, per agnostic doc)
   │ VALIDATED, the actual L2 unlock) │
   │   runtime  = SAME Workflow tool, │
   │              dispatched by Agent │
   │              SDK query() or -p   │
   │   gates    = caller-side (TTY /  │
   │              --approve-plan file)│
   ├──────────────────────────────────┤
   │ Codex host (thin skin over B)    │
   │   gates    = codex plugin skill  │
   │   dispatch = bin/up-dispatch.mjs │
   ├──────────────────────────────────┤
   │ standalone shim (fork C —        │
   │ trigger-owned, spec below)       │
   │   runtime  = bin/up-run.mjs      │
   │   agent()  → `claude -p` child   │
   └──────────────────────────────────┘
```

The load-bearing decision, sharpened by the fork: **there is exactly ONE runtime.** The
Codex host is a skin — a codex plugin skill that owns the two gates and shells
`node bin/up-dispatch.mjs`, a ~50-line Agent SDK `query()` wrapper driving the *same*
Workflow tool the CC host uses (journal, StructuredOutput enforcement, watchdog, progress
events come along for free); packaging is the path wenlan already walks. A second runtime
(the node shim) exists only if a C trigger fires. Gates keep their SKILL.md placement on
every host — GATE 1 approves the plan *before dispatch*, GATE 2 renders *from the returned
result object*; no host re-implements the loop. L1 (which worker) and L2 (which host) stay
orthogonal: any host × any implementer, one contract in the middle.

### Fork B — headless dispatch, validated 2026-07-07

The Workflow tool is dispatchable outside an interactive session: put `'Workflow'` in
`allowedTools` via the TS Agent SDK `query()` (available SDK ≥0.3.149 / CC ≥2.1.154; probes
ran SDK 0.3.202 + CC 2.1.202), or plain `claude -p` (bench ARM B: whole 7-task build green,
$4.21, 2026-06-14 `[V bench/run.sh]`). Two live probes (zero-agent echo; one-haiku-agent
wait-and-relay) pinned the mechanics:

- **Dispatch.** `query({ prompt, options })`; the prompt is the bench-proven sentence —
  *"Call the Workflow tool with scriptPath `<engine>` and the args below, then return the
  Workflow's final JSON result verbatim (nothing else): `<json>`"* — and options are
  `{ allowedTools: ['Workflow'], permissionMode: 'bypassPermissions', maxTurns,
  pathToClaudeCodeExecutable, cwd: <target repo>, maxBudgetUsd }` `[V probes + sdk.d.ts]`.
- **`args` lands as a JSON string** inside the script — the engine's `_args` parse (`:88`)
  handles exactly this `[V probe 1: echo returned the raw string]`.
- **The session waits.** The tool returns "launched in background" immediately, but the
  headless session does **not** exit while the task is pending; `task_started` /
  `task_progress` / `task_notification` system events flow in the SDK stream (probe 2
  timeline: dispatch 13.8s → 3 progress events → notification 15.5s → verbatim relay 22.2s).
- **Result, two channels.** (1) The model relays the final JSON verbatim (`{"ok":true,
  "agentSaid":"pong"}` in probe 2); (2) the harness writes an authoritative
  `tasks/<taskId>.output` file — `{summary, agentCount, logs, result, totalTokens,
  totalToolCalls}`. Treat the **file as authoritative**, the relay as liveness signal
  `[V probe 1 output file]`. Gotcha: the tasks-file root differed from the transcript-dir
  root in probe 1 — pin discovery by parsing the `task_notification` payload's output-file
  path, not by guessing directories `[U — pin at P2]`.
- **Stream gotchas.** TWO `result` messages appear (one per model turn) — end-of-run is
  async-generator exhaustion, not the first `result` `[V probe 2]`. And the prompt is
  load-bearing: "reply DONE after completion" made probe 1's model answer at *launch*,
  ending the stream while the workflow completed detached (the output file still landed);
  the "return the final JSON result verbatim" sentence is what makes the session wait.
- **Knobs.** Wrapper model is selectable (`options.model` `[V sdk.d.ts]`) — dispatch/relay
  turns are mechanical, so sonnet cuts the overhead `[I — not measured]`. Cost ceiling =
  `maxBudgetUsd` around the whole run, composable with the engine's own `budget` arg.
- **Resume across sessions**: Workflow `resumeFromRunId` is same-session; the SDK exposes
  `resume: <sessionId>` + `forkSession` — plausibly composable into cross-process resume,
  **unvalidated** `[U — open]`.

What B is NOT: it does not remove the CC dependency — the box needs a CC install + OAuth.
That is C trigger (a), by construction.

### Fork C — the runtime shim (`bin/up-run.mjs`), specified, trigger-owned

Kept as the build blueprint for the day a C trigger fires — and as the eval rubric against
any adopt candidate (bernstein). Unchanged by the fork decision:

- **`agent(prompt, {schema, model, effort, label})`** → spawn
  `claude -p <prompt> --model <model> --output-format json` under the existing watchdog.
  Envelope + `total_cost_usd` parsing is bench-proven `[V bench/run.sh]`. Exact flags for
  reasoning-effort on `-p` children: `[U — pin before build]`.
- **Schema enforcement.** The Workflow runtime validates StructuredOutput at the tool layer;
  the shim validates the child's JSON against the same schema objects, re-prompts **once**
  with the validation error, then fails CLOSED — mirroring `agentSafe`'s
  missing-StructuredOutput handling (`:198-201`). Never fail open on a malformed review.
- **Journal / resume.** Append `{call#, promptHash, result}` JSONL per run; resume = replay
  the matching prefix from the journal (Workflow-journal semantics, ~30 lines). Engine state
  is already file-durable and crash-resumable `[V README "Durable state lives in files"]`.
- **Budget.** Sum child `total_cost_usd` against a `--budget-usd` ceiling; expose the same
  `budget.remaining()` shape the engine already optionally consumes. Codex-side cost
  visibility: `[U — open]`.
- **Non-interactive between gates**, same as the Workflow (ADR-0001 parity): no mid-run
  prompts on any host; anything blocking surfaces in the result object at GATE 2.

### The host contract

| responsibility | CC host (today) | B: headless dispatch (incl. Codex skin) | C: standalone shim (trigger-owned) |
|---|---|---|---|
| GATE 1 / GATE 2 | skill | caller-side: codex plugin skill, or TTY / `--approve-plan <file>` for cron/CI | same caller-side story |
| auth preflight | session auth | CC install + OAuth probe before dispatch (+ codex `auth.json` if L1 uses codex workers) | probe `claude -p` + codex `auth.json` |
| outer sandbox | CC seatbelt (+ codex carve-out) | CC harness, headless — `bypassPermissions`; exact headless sandbox posture `[U — pin at P2]` | **none** — see Security |
| cost ceiling | Workflow `budget` | SDK `maxBudgetUsd` + engine `budget` arg | shim `--budget-usd` |
| progress UI | /workflows tree | `task_progress` stream events → log tail | run-log tail |

## Security — the section that must not drift

Fork B keeps the run **inside the CC harness** — same runtime, same settings resolution;
the posture delta is unattendedness (`bypassPermissions`, already the `-p` norm
`[V docs/DISCUSSION.md]`; the exact sandbox posture of a headless session: `[U — pin at
P2]`). Fork C hosting **removes the seatbelt** that today wraps everything except the codex
carve-out. Named consequences (C-scoped except where noted):

1. **The threat model becomes per-host.** `SECURITY.md` is CC-shaped
   (`Bash(codex *)` allow + `sandbox.excludedCommands`). On the standalone/Codex hosts the
   only boundaries left are (a) L1 contract scoping (`writableRoots`/`denyPaths` per
   adapter) and (b) the deterministic working-tree diff verify. That is exactly the agnostic
   doc's "honest boundary" claim — but there it was a *layer on top of* the seatbelt; here
   it is the *whole fence*. Rule: **no L2 host ships without its own threat-model section**
   — the roadmap's "security note per adapter" P1 extends to "per host".
2. **Children run permissive.** Unattended `claude -p` children need `bypassPermissions`
   `[V DISCUSSION.md]`. State this loudly in docs: on non-CC hosts the implementer is fenced
   by the contract + diff-verify, not by a permission prompt nobody is present to answer.
3. **Secrets hygiene generalizes — B included.** The `env -u GITHUB_PERSONAL_ACCESS_TOKEN`
   scrub (agnostic doc, "Now") becomes an **allowlist child env** in the shim *and* in B's
   dispatcher (which spawns the headless CC process): spawn children with
   a minimal env, not the inherited env minus known-bad names. Deny-by-default beats
   enumerate-the-secrets.
4. **One blessed codex auth path.** The 2026-07-06 lesson: default `~/.codex` carries
   `auth.json` and works; a bare ephemeral `CODEX_HOME` 401s
   `[V wenlan session log 2026-07-06-1751]`. The shim standardizes on the default home with
   a **preflight that fails to BLOCKED before the build starts** (never a mid-build blind
   retry into an auth wall — same deny→blocked mapping philosophy as the agnostic doc).
   Ephemeral homes only where isolation is the explicit point, with auth injection.

## Quality parity — the honest risk

Fork B sidesteps this risk **by construction**: engine and subagents run on the CC runtime,
so reviewers stay claude-family with zero extra rules. The bullets below are C-scoped, kept
for when that trigger fires:

- The two-stage fail-closed review prompts are superpowers-verbatim and validated with
  **Claude** reviewers only. A Codex-hosted run on a box without the claude CLI would put
  reviews on gpt-5.x — parity unmeasured `[U]`. Rule: reviewers stay pinned to claude
  models on **every** host until a measured cross-model review benchmark says otherwise; if
  the claude CLI is absent at preflight, the run degrades LOUDLY (same pattern as the
  gemini→claude cwd downgrade, `:919`), never silently swaps reviewer families.
- `SP_VERSION` drift-check travels with the engine unchanged — embedded prompts are
  host-independent by construction (that was the point of embedding).
- **Per-host parity gate:** the re-witness-RED self-test (`tests/re-witness-red/`) must pass
  under a host's runtime before that host claims parity. It spends tokens and stays a
  manual/runtime gate, as today.
- Cross-model **council** stays where the roadmap put it: the rare gates (integration
  review P1, plan gate P2), never the per-task hot loop `[V docs/roadmap.md §Council]`. L2
  makes council *cheaper to wire* (codex is already a first-class dispatch target) but does
  not change its placement.

## Phasing — trigger-owned, blueprint discipline

| phase | what | trigger |
|---|---|---|
| **P1** (unchanged roadmap P1) | implementer interface/registry refactor — "the unlock"; codex/gemini logic moves into adapter entries | already scheduled; behavior-preserving, protected by existing gates |
| **P2** | fork-B dispatch skin: `bin/up-dispatch.mjs` (Agent SDK `query()` → Workflow tool) + result-file pin + progress tail + re-witness parity self-test, dogfooded on this repo | a real week wants a UP build outside a CC session (cron, CI, Codex-resident day) — OR the OSS-credibility milestone is deliberately pulled forward. Mechanics pre-validated 2026-07-07 (~$1.4 in probes): P2 shrank from "build a runtime" to "wrap a dispatch" |
| **P3** | Codex plugin skin (gates in a codex skill; shells the P2 dispatcher; wenlan packaging path) | P2 exists AND the operator actually lives in Codex for a week's builds |
| **C** (unscheduled) | `bin/up-run.mjs` shim per the fork-C spec above — or bernstein adoption if its forensic eval passes | any C trigger fires: (a) CC-free box, (b) ACP typed results + codex native ACP, (c) adopt-candidate eval outcome |
| **P4** (the agnostic doc's "Later", unchanged) | ACP as the wire | adapter maturity check passes (`claude-code-acp` / `codex-acp` exercised against our contract) AND bespoke exec glue shows real recurring pain |

ACP note — the convergence is the news: the agnostic doc adopted ACP for **L1** reasons
(granular, recoverable permission = claude-parity deny semantics). It equally serves **L2**:
an ACP client is a plain node process, host-free by construction. One protocol move, both
axes. It stays P4 because the bespoke path is proven and thin while ACP adapter maturity is
not `[U — the doc's open question on non-interactive permission-handler cost stands]`.

## Open questions → the discussion agenda

1. **Build trigger vs design-ahead.** This doc completes the *exploration*; the blueprint's
   settlement ("unified by portable rules, not a shared framework") rejected *adopting* a
   foreign framework, and its meta-work moratorium parked gap-builds until need fires. Does
   a real current need pull P2 forward, or does this stay shelved-with-trigger?
   *2026-07-07 reprice: fork B validation already did the design-ahead — P2 is now a thin
   wrapper, so the trigger alone decides; nothing further to pre-build.*
2. **Who is L2 for?** (a) own fleet: one orchestrator reachable from CC + Codex + cron;
   (b) OSS parity: "runs on your CLI" credibility. (a) needs no polish on the Codex skin;
   (b) makes P3 a first-class deliverable with docs/CI. Pick before P2 scoping.
3. **Reviewer-family pinning.** Accept "reviews are Claude-pinned on all hosts" as a
   product stance (recommended), or fund a cross-model review benchmark first?
   *Moot under fork B (claude by construction); re-arms only if C fires.*
4. **Security posture off-CC.** Is contract-scoping + diff-verify + allowlist-env an
   acceptable *sole* fence for unattended standalone runs, or does the standalone host
   demand an OS-level sandbox story (macOS `sandbox-exec` profile, container) before it
   ships? (`sandbox-exec` is deprecated-but-functional; container adds weight `[U]`.)
   *C-scoped; fork B keeps the CC harness — its only open `[U]` is the headless sandbox
   posture, pinned at P2.*
5. **Codex flags to pin** (from the agnostic doc, still open): does current `codex exec`
   expose per-path `writable_roots` beyond coarse `workspace-write`? Pin exact flags before
   any adapter relies on them.
6. **Cost metering on codex children** — `codex exec` cost visibility `[U]`; without it the
   shim budget under `implementer:'codex'` meters only the claude wrapper turns.
7. **Gemini/agy slot.** Gemini CLI is dead on this box (`IneligibleTierError`); boule
   relays via agy. Keep the gemini adapter slot registry-shaped but defer all gemini work
   until a CLI is actually alive (unchanged from the agnostic doc).
8. **Where does the L2 runner live?** In-repo `bin/` (recommended: one repo, one engine,
   two hosts) vs a separate package. A separate package invites version skew against the
   engine it exists to host. *Fork B strengthens in-repo: the dispatcher is ~50 lines
   against the engine it ships with.*
9. **Cross-process resume** (new, from B validation): compose SDK `resume: <sessionId>` +
   Workflow `resumeFromRunId` to resume an interrupted headless build? Unvalidated `[U]`;
   the engine's file-durable state means a fresh dispatch already recovers coarsely.

## Non-goals — guard rails carried forward

- **No L3 peer teams, no swarm** (roadmap §5). If a genuine cross-CLI *team* need fires,
  the move is re-evaluating OMC's tmux layer (blueprint shelf #5), not building one here.
- **No mid-run human input on any host** — ADR-0001 parity is a feature, not a Workflow
  limitation to engineer around.
- **No new cost claims from L2.** Meter-A/Meter-B framing and every benchmark caveat stand
  unchanged; hosting elsewhere changes *where* the loop runs, not what it costs.
