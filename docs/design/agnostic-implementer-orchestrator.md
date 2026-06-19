# Agnostic implementer orchestrator — design & future plan

Status: the "Now" items are BUILT (PAT child-shell scrub, deletion descope-guard,
deny→blocked mapping — see commits on this branch); the agnostic-orchestrator / ACP
refactor remains a deferred design note. Captures the direction for making the build
harness treat any backend (claude / codex / gemini / …) as an interchangeable,
controlled implementer subagent.

> **Merge-review (/boule:debate, 2026-06-18 — approve-with-changes, no merge-blocking defect).**
> Security note (ORTHOGONAL — not a gate on this PR): the GitHub PAT exposure is
> pre-existing config, NOT introduced by this work; this PR *reduces* it via the `env -u`
> scrub. Rotating the token is a separate operational follow-up on the maintainer's own
> timeline. Non-blocking hardening follow-ups: tighten the spec-mention allowlist
> (basename collision) and confirm task specs are orchestrator-supplied, not
> implementer-writable.

## Problem

Today `implement()` (`workflow/ultrapowers-development.js`) special-cases each backend:

- `claude`  → CC subagent `agent(…)` (`:371-373`), governed by CC's permission + filesystem/network sandbox.
- `codex`   → `codex exec … -s workspace-write` (`:327`), run **excluded from the CC sandbox** (`:316-318`), confined only by codex's own `workspace-write` — no writable-path scoping, no protected-path deny, no approval policy.
- `gemini`  → `ask-gemini … sandbox:false` (`:344`) — **no sandbox at all** (widest open of the three).

The observed "silent descope" drift is a *symptom of this backend divergence*: the
claude subagent already inherits CC's scoped, protected, granular-recoverable action
space; the external CLIs do not. The fix is not to constrain each backend ad hoc but
to define one **implementer contract** and let each backend enforce it via its own
mechanism.

## The contract

```
        ┌──────────────────────────────────────────────┐
        │   Orchestrator — ONE uniform CONTRACT          │
        │     in:  verbatim brief                        │
        │     can write: {src roots}  not: {CI,deps,.git}│
        │     out: status + diff(baseSha..HEAD)          │
        └───────────────────┬────────────────────────────┘
                 dispatch via a per-backend ADAPTER
         ┌──────────────────┼──────────────────┐
    claude adapter      codex adapter       gemini adapter
    CC perms/tools     -s workspace-write   sandbox:true
                       + writable_roots     + scoped paths
                       + deny protected     + deny protected
         └──────────────────┴──────────────────┘
            every backend obeys the SAME contract
            → orchestrator treats them identically
            → baseSha check = the contract's VERIFY step (shared, not a per-backend patch)
```

- The **contract** defines the action space (brief in, scoped writes, status+diff out).
- Each **adapter** enforces it with its backend's native mechanism.
- The post-turn `git diff baseSha..HEAD` check is the **shared verify step** for all
  backends — deletions, pre-existing-test weakening, and protected-path edits.

## Validation — is a scoped codex/gemini equivalent to the claude subagent?

Two axes. **Write-boundary equivalence is achievable; failure-semantics equivalence
needs one explicit fix.**

| Axis | claude (CC subagent) | codex / gemini today | scoped proposal |
|---|---|---|---|
| Where it can write | CC writable allowlist **minus** protected deny (`settings.json`, `.git/*`, hooks, `.mcp.json`) | whole repo (codex) / no sandbox (gemini) | `writable_roots`=src + deny protected (codex); `sandbox:true`+scope (gemini) |
| Network | CC allowlist | off (codex) / open (gemini) | off |
| Protected paths (CI/deps/.gitignore) | denied by default | reachable | denied |

→ Scoping the external CLIs to CC's writable set reaches write-boundary parity. The
reason claude "had no issue" is concrete: CC's sandbox already denies the protected
set; the CLIs were simply never configured to match.

### Caveat — sandbox-induced halt not seen in the claude path

A path-sandbox denial is **coarse**; CC's permission denial is **granular + recoverable**:

```
claude : write denied → per-tool-call error the agent sees mid-turn
         → adapts, or returns a clean `blocked`        (recoverable)

codex  : write denied (batch = no human to approve)
         → works around it, OR the whole exec exits non-zero
         → wrapper only names timeout/startup as `failed` (:334)
         → sandbox-deny failure is ambiguous → likely mis-tagged `failed`
         → BLIND RETRY into the same wall                (a halt claude never hits)
```

Mitigations to align behavior:

1. **Scope to match CC's writable set — not tighter.** Avoid surprise denials on legit paths.
2. **Map a sandbox/permission-denied exit → `blocked`/`needs_context` (escalate), not `failed` (blind retry).** One line in the wrapper prompt.
3. In batch there is no graceful interactive approval (no human) — so the realistic
   batch config is a bounded-but-generous scope + deny→blocked mapping, *or* move to a
   protocol with granular recoverable permission (see ACP below), which dissolves this
   caveat structurally.

### Honest boundary (why the diff-verify survives regardless)

A sandbox bounds **where** an implementer writes; it can never tell **what an in-scope
edit means**. "Edit `route.tsx` (allowed)" and "gut `route.tsx` to pass (also allowed)"
are identical to a path-sandbox. So the `baseSha..HEAD` test-integrity check is the
**irreducible semantic layer** — kept for *all* backends (claude included), on top of a
properly scoped action space. Up-front scoping and output-verify catch different things.

## OSS landscape — reuse vs build

Three layers; only **agent-routing** is the target:

- **model-routing** (LiteLLM, `llm`, Vercel AI SDK) — swaps the LLM under one loop. Wrong layer.
- **own-loop** (aider, SWE-agent, OpenCode, Cline, Continue) — *is* the agent. Wrong layer. (aider could be *one* implementer, not the orchestrator.)
- **agent-routing** — drives external claude/codex/gemini interchangeably. Real, active 2025-26 category.

| Project | What it is | Reuse verdict |
|---|---|---|
| **ACP** — Agent Client Protocol (`agentclientprotocol.com`, Apache-2.0) | "LSP for agents": JSON-RPC/stdio. `session/prompt` in → `session/update` out (status, tool calls, `{path,oldText,newText}` diffs). Gemini **native**; Claude & Codex via Zed adapters (`claude-code-acp`, `codex-acp`). Scoping via `session/request_permission` (granular, recoverable). | ✅ **Reuse the protocol** — durable wire shape matching our contract; its permission model = claude's granular-recoverable deny (kills the halt caveat). We still build orchestration + declarative scoping in the permission handler. |
| **Bernstein** (`github.com/sipyourdrink-ltd/bernstein`, Apache-2.0, pip) | Deterministic scheduler: goal→tasks→**git-worktree**→"janitor" verify (tests/lint/types/files). Headless/library, ~44 CLI adapters, per-artifact lineage. | ⚠️ Closest full match to our model, but **solo-maintained, young, high-churn**. Lift the worktree+janitor *pattern*; don't take a hard dependency. |
| **CAO** (`github.com/awslabs/cli-agent-orchestrator`, Apache-2.0) | Runs 10+ CLIs in isolated tmux over MCP (`handoff`/`assign`). Org-backed, active. | ⚠️ Genuine agent-routing, but **no writable-path scoping or worktree isolation**; built for interactive localhost orchestration. |
| **Emdash** (`github.com/generalaction/emdash`, YC) | Worktree-per-task orchestrator over ~13-22 providers. | ✗ **GUI-only (Electron/Tauri), no headless/library mode.** Good reference design, wrong form factor. |

Also proving the pattern but heavyweight end-user products: **OpenHands** (added ACP
to spawn Claude/Codex/Gemini), **Block's Goose** (`GOOSE_PROVIDER=claude-code|codex|gemini`).

**Bottom line:** no drop-in for our exact contract (`verbatim brief → declarative
scoped paths → status+diff`). Build a **thin custom adapter on ACP's wire semantics**
(Gemini native, Claude/Codex via existing adapters), optionally lifting Bernstein's
worktree+janitor as the scoping/verify layer. Reuse the **protocol + patterns, not a
whole orchestrator.**

## Debate validation (2026-06-18, `/boule:debate`)

Verdict: **approve-with-changes, medium** (position-stable). 2 approve-with-changes
(Claude, Codex); the lone needs-more-info (Gemini) was a dead-CLI process abstention
the author **fully conceded and revised** to approve-with-changes. The debate corrected
two overclaims from the prior "validated until clean" pass:

1. **Guard is overclaimed.** `git diff --diff-filter=D -M baseSha..HEAD` catches whole-file
   **deletion** (the actual incident) and renames — but NOT inserted `.skip`/`xfail` or
   body-truncation in **surviving (Modified)** test files, which the guard line claimed as
   "skipped/structurally-weakened." → **broaden** (numstat net-deletion threshold +
   skip-marker grep on test files) **or narrow the claim to deleted-files-only.** Pick one.
2. **`baseSha` + restore are NOT a deterministic primitive.** `baseSha` is captured by a
   **haiku LLM agent** (`captureHead`); `redWitness` restore is agent-driven and explicitly
   **fail-OPEN**, gated on `commit:true`. A "deterministic guard" on that base is not
   deterministic → **redesign the restore as pure git**, not an LLM/fail-open path.

Other agreed corrections:
- **Guard = backstop, not net-new.** `workflow:485` already tells the Opus reviewer to flag
  "weakened/deleted existing tests to force green" on the same diff — the guard is a
  deterministic fail-closed backstop to that (evidently unreliable) reviewer.
- **Drop the repeat-counter** — redundant with the shipped thrash guard (`stall>=2`→needsHuman)
  + `MAX_FIX=3`.
- **spec-mention allowlist is gameable** — the implementer controls `decompose`-minted
  subtask specs (`:526-536`); keep it narrow + human-review matches (conditional on
  spec-writability).
- **PAT exposure is real, not hypothetical** — verified `gho_` token in `~/.claude/settings.json`
  global `env`; it is **GitHub MCP auth** (remote Copilot MCP, `Authorization: Bearer
  ${GITHUB_PERSONAL_ACCESS_TOKEN}` in the github plugin `.mcp.json`), NOT the CLI. `git push`
  is **SSH** (unaffected); `gh` keyring is separately invalid. Rotation alone is insufficient.
- **Gemini CLI is dead on this box** (`IneligibleTierError`, requires Antigravity migration) —
  so gemini sandbox-scoping is moot until the CLI is revived.

## Phased plan

**Now (cheap, in the current harness):**
- **Descope guard (deletion backstop):** `git diff --diff-filter=D -M baseSha` (baseSha vs the
  WORKING TREE — catches committed AND uncommitted deletes, so it works in the default commit:false
  mode where redWitness is off) → restore + re-enter the existing fix-loop; ship as a deterministic fail-closed **backstop**
  to the `workflow:485` reviewer. Either broaden to skip/truncation detection OR narrow the
  claim to deleted-files-only — do NOT claim "structurally-weakened" the D-filter can't catch.
- **Make restore deterministic:** pure-git `baseSha` capture + restore, NOT the haiku-agent /
  fail-open `redWitness` path.
- **Drop the repeat-counter** (redundant with thrash guard + `MAX_FIX=3`).
- **No-halt interim:** map sandbox/deny exits → `blocked`/`needs_context`, not `failed`
  (`:334`/`:354`).
- **Security (highest priority):** (a) **rotate** the exposed GitHub PAT (your action);
  (b) **stop re-exposure** — scrub it from the codex/gemini child env when spawning them
  (`env -u GITHUB_PERSONAL_ACCESS_TOKEN codex exec …`); the trusted MCP server keeps it from
  the global env. `git push` (SSH) and MCP both keep working.
- **Security parity (sandbox scoping):** only if codex/gemini is the default implementer AND
  functional — gemini CLI is currently dead, so its scoping is deferred until revived.

**Next (formalize the contract):**
- Define the implementer-contract interface: `{brief, writableRoots, denyPaths} → {status, diff}`.
- Refactor `implement()` into adapters behind that interface (claude / codex / gemini),
  so the orchestrator is backend-agnostic.

**Later (standardize the wire):**
- Move adapters onto **ACP** (`session/prompt` / `session/update`) so Gemini drops in
  natively and Claude/Codex use the Zed adapters; implement declarative scoping in the
  `session/request_permission` handler. This makes the deny path granular+recoverable
  (parity with claude) and removes bespoke per-CLI glue.

## Open questions

- Is the task spec writable by the implementer? Determines whether the spec-mention
  allowlist is a real gaming vector (implementer mints `decompose` subtask specs at `:526-536`).
- RESOLVED: the guard diffs `baseSha` vs the WORKING TREE (not `baseSha..HEAD`), so it catches
  both committed deletes (codex self-commits in its turn) and uncommitted ones (default commit:false
  mode where redWitness is off). Restore is `git checkout baseSha -- <paths>`.
- Does `codex exec`'s current version expose per-path `writable_roots` (vs only the
  coarse `workspace-write` mode)? Pin exact flags before relying on it.
- ACP scoping is per-call interactive; cost of running it non-interactively (batch) with
  an auto-deciding permission handler that enforces a declarative allowlist?
- Worktree-per-task (Bernstein pattern) vs the current single-tree + `baseSha` approach —
  does isolation buy enough to justify the worktree overhead at our task volume?
