# Shared-infra orchestrator — one engine, hosted by CC or Codex (design exploration)

Status: DESIGN ONLY — no build trigger has fired. This doc completes the exploration split
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
not a Workflow-runtime reimplementation.

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
   │ standalone host (NEW — the       │                     (shared step, per agnostic doc)
   │ actual L2 unlock)                │
   │   runtime  = bin/up-run.mjs shim │
   │   agent()  → `claude -p` child   │
   │   gates    = TTY prompt /        │
   │              --approve-plan file │
   ├──────────────────────────────────┤
   │ Codex host (thin skin)           │
   │   gates    = codex plugin skill  │
   │   dispatch = bin/up-run.mjs      │
   └──────────────────────────────────┘
```

The load-bearing decision: **the Codex host is not a third runtime.** It is a skin over the
standalone runner — a Codex plugin skill that owns the two gates and shells
`node bin/up-run.mjs`, exactly the packaging path wenlan already walks. Runtimes stay at two
(Workflow, node) forever; entry skins are cheap. L1 (which worker) and L2 (which host) stay
orthogonal: any host × any implementer, one contract in the middle.

### The runtime shim (`bin/up-run.mjs`), specified

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

| responsibility | CC host (today) | standalone | Codex host |
|---|---|---|---|
| GATE 1 / GATE 2 | skill | TTY prompt, or `--approve-plan <file>` for cron/CI | codex plugin skill |
| auth preflight | session auth | probe `claude -p` + codex `auth.json` before dispatch | same |
| outer sandbox | CC seatbelt (+ codex carve-out) | **none** — see Security | codex `workspace-write` around the runner `[U]` |
| cost ceiling | Workflow `budget` | shim `--budget-usd` | shim `--budget-usd` |
| progress UI | /workflows tree | run-log tail | run-log tail |

## Security — the section that must not drift

Hosting outside CC **removes the seatbelt** that today wraps everything except the codex
carve-out. Named consequences:

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
3. **Secrets hygiene generalizes.** The `env -u GITHUB_PERSONAL_ACCESS_TOKEN` scrub
   (agnostic doc, "Now") becomes an **allowlist child env** in the shim: spawn children with
   a minimal env, not the inherited env minus known-bad names. Deny-by-default beats
   enumerate-the-secrets.
4. **One blessed codex auth path.** The 2026-07-06 lesson: default `~/.codex` carries
   `auth.json` and works; a bare ephemeral `CODEX_HOME` 401s
   `[V wenlan session log 2026-07-06-1751]`. The shim standardizes on the default home with
   a **preflight that fails to BLOCKED before the build starts** (never a mid-build blind
   retry into an auth wall — same deny→blocked mapping philosophy as the agnostic doc).
   Ephemeral homes only where isolation is the explicit point, with auth injection.

## Quality parity — the honest risk

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
| **P2** | `bin/up-run.mjs` shim + journal + budget + re-witness parity self-test, dogfooded on this repo | a real week wants a UP build outside a CC session (cron, CI, Codex-resident day) — OR the OSS-credibility milestone is deliberately pulled forward |
| **P3** | Codex plugin skin (gates in a codex skill; wenlan packaging path) | P2 exists AND the operator actually lives in Codex for a week's builds |
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
2. **Who is L2 for?** (a) own fleet: one orchestrator reachable from CC + Codex + cron;
   (b) OSS parity: "runs on your CLI" credibility. (a) needs no polish on the Codex skin;
   (b) makes P3 a first-class deliverable with docs/CI. Pick before P2 scoping.
3. **Reviewer-family pinning.** Accept "reviews are Claude-pinned on all hosts" as a
   product stance (recommended), or fund a cross-model review benchmark first?
4. **Security posture off-CC.** Is contract-scoping + diff-verify + allowlist-env an
   acceptable *sole* fence for unattended standalone runs, or does the standalone host
   demand an OS-level sandbox story (macOS `sandbox-exec` profile, container) before P2
   ships? (`sandbox-exec` is deprecated-but-functional; container adds weight `[U]`.)
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
   engine it exists to host.

## Non-goals — guard rails carried forward

- **No L3 peer teams, no swarm** (roadmap §5). If a genuine cross-CLI *team* need fires,
  the move is re-evaluating OMC's tmux layer (blueprint shelf #5), not building one here.
- **No mid-run human input on any host** — ADR-0001 parity is a feature, not a Workflow
  limitation to engineer around.
- **No new cost claims from L2.** Meter-A/Meter-B framing and every benchmark caveat stand
  unchanged; hosting elsewhere changes *where* the loop runs, not what it costs.
