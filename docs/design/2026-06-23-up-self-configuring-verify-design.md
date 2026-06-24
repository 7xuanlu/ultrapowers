# UP self-configuring verify — design

- **Date:** 2026-06-23
- **Status:** approved design (boule-debated); Component C shipped, Scout + Cache-reach pending implementation
- **Author:** brainstormed with the user; pressure-tested by `/boule:debate` (Claude + Codex/gpt-5.5 + Gemini 3.1 Pro → approve-with-changes / medium)

## Problem

A real UP run took **~9.2 h, fully serial** (sum of per-agent wall-time ≈ total wall-clock). **~61 %** of it was four agents running a full Rust build+test suite repeatedly, **cold**. Root cause was not serialism (superpowers — SP — is serial too):

1. UP isolates into a **fresh git worktree**; `target/` is gitignored, so the worktree starts with **no incremental compiler cache**.
2. The run's task brief **blanked the cache wrapper** (`RUSTC_WRAPPER=`) and disabled the sandbox, because sccache's cache dir is outside the sandbox write-allowlist and failed with `Operation not permitted`. The repo's `.cargo/config.toml` sets `rustc-wrapper = "sccache"` *specifically to share the compiler cache across the main checkout and all worktrees* — UP's isolation + cache-disable workaround defeated exactly that mechanism.
3. The gate timeout was only **requested** of the subagent (set the Bash-tool timeout), which agents ignored — so gate agents ran 55–117 min uncapped.

Separately, UP **requires per-repo config** (`verifyCmd`, `fullVerifyCmd`, env, `verifyTimeoutMs`) that SP never asks for. SP dispatches a fresh subagent per task **from the live main session**, so it inherits the real repo environment (warm cache, normal sandbox) and a capable agent **discovers** how to test by reading the repo (focused test while iterating, full suite once before commit). SP is *not* intrinsically warmer — it would hit the same sccache failure under the same sandbox — it simply usually runs against the warm main checkout. (Diagnosis is n=1, measured from one run's transcripts, not benchmarked; the differential validation below re-confirms the cache fix's value.)

## Goal / non-goals

**Goal:** UP takes only a spec/goal and completes roughly as fast as SP, **without** the caller supplying per-repo verify config — while **preserving UP's identity vs SP**: the deterministic exit-code gate (don't trust the implementer's self-report) and unattended operation (no human supervising).

**Non-goals (YAGNI):**
- Cross-task parallelism (SP has none either).
- Any per-ecosystem (cargo/npm/…) branching inside the engine.
- Silent auto-editing of `settings.json`.

## Principle

Move the three jobs SP's in-session agent does implicitly into UP explicitly, keeping ecosystem knowledge in an LLM (inherently general) and the engine ecosystem-blind:

| Job | SP does it by | UP gains |
|-----|---------------|----------|
| what command verifies | reading the repo | **Scout** discovers it |
| scoped vs full | TDD habit (focused test, full once) | implementer runs scoped during TDD; gate runs full discovered cmd |
| warm build environment | running in the warm checkout | **Cache-reach** + one-time supervised grant |

## Components

### Component C — structural watchdog (SHIPPED)

Factor the existing codex process-group watchdog (`setsid` + `fork` + `SIGALRM` → SIGKILL the whole process group → exit 124) into a reusable `wrapWatchdog(argv, timeoutSec, stdinFile)`; apply to **verify**, **redWitness**, and the **integration** gate. The cap is now engine-enforced and language-agnostic; the watchdog returns control gracefully so the trailing `; echo "__RC__=$?"` still emits `__RC__=124` (the fix-loop's signal survives the kill). Codex command output is byte-identical after the refactor.

Tests: `tests/watchdog.sh` (mechanism: passthrough codes, timeout→124, process-group kill, marker survival) and `tests/engine/watchdog-gate.test.mjs` (engine wires the watchdog into all three gate sites). Full engine suite 19/19.

### Supervised Setup — permission provisioning (NOT mid-run)

The unattended run must **never block on a prompt** (boule critical flaw: a mid-run "ask once" either blocks-until-timeout, killing the speedup / falling back cold, or needs a human, defeating unattended). So permission provisioning is a **separate, supervised, one-shot step** run once with a human present (e.g. an `ultrapowers setup`-style preflight):

- Detect the project's build cache and the path(s) the cache wrapper needs writable.
- Grant the sandbox write-allowlist for those **exact paths** (never a broad parent glob); show the diff. This persists in `settings.json`, so subsequent unattended runs are warm like SP forever.
- This is the ONLY interactive step. The unattended run consumes already-granted permissions.

### Scout — discovery preflight (one generic agent)

Reads the repo (build manifests, Makefile, CI config, README) and returns structured fields:

```
{
  verifyCmd:      string | null,   // per-task gate command (the WHOLE discovered test command, not a subset)
  fullVerifyCmd:  string | null,   // integration full suite (may equal verifyCmd)
  cacheType:      'wrapper' | 'local-dir' | 'remote' | 'none',
  cacheWrapper:   string | null,   // e.g. the rustc-wrapper / compiler-cache binary, if any
  cacheDirs:      string[],        // local dirs to make reachable (empty for remote/none)
  allowlistPaths: string[]         // sandbox write-allowlist paths the cache needs (for Setup)
}
```

- **Validate** the discovered command(s) once: they run and exit cleanly on the current tree.
- **Red-witness the discovered command** (boule "lands hard" flaw): a command that vacuously passes (exits 0 without testing) would silently weaken the deterministic gate. Seed a known-bad mutation and confirm the command goes **red** — reusing the existing `redWitness` baseSha-revert machinery. A command that can't be shown to fail is rejected (→ fallback).
- **Fallback:** if no command is found, or it can't be red-witnessed, fall back to UP's existing "no deterministic gate → LLM-review-only" mode, **logged as degraded** (not silently). For polyglot monorepos with no single canonical command, degrade + report.

Ecosystem knowledge lives entirely in this LLM agent; the engine only consumes the fields.

### Cache-reach — make the worktree warm (driven by Scout, by cacheType)

- `cacheType: 'wrapper'` (e.g. sccache) — **keep the wrapper** (never blank it); the wrapper is path-tolerant and share-safe across worktrees. Ensure its dir is in the allowlist (via Setup). Preferred — no symlink needed.
- `cacheType: 'local-dir'` (e.g. a bare `target/` with no wrapper) — **symlink/share** the dir into the worktree (reversible). Guard against external mid-run mutation (boule flaw): refuse/lock if the main checkout is actively building, since reversibility does not guard against mid-run poisoning.
- `cacheType: 'remote'` (sccache S3/Redis/HTTP, env-var-driven) — keep wrapper + env; **no local symlink** (local sharing doesn't apply).
- `cacheType: 'none'` or unknown — do nothing; report the worktree will build cold.
- If a needed grant is missing at run time → **degrade (cold) + report**, never block.

### Gate model

Keep the deterministic exit-code gate (the harness decides `passed = code === 0`, not the implementer), fed the Scout-discovered command. **Drop the spot-check hybrid** (boule flaw: a per-task spot-check defers regression detection to integration, costing a late fix in a serial run). Instead:

- The **implementer** runs scoped tests itself during TDD (fast feedback) — in the now-warm environment.
- The **per-task deterministic gate** runs the **entire discovered `verifyCmd`** (not a spot-check subset; warm ⇒ fast after Cache-reach), watchdog-capped.
- `redWitness` reuses the discovered command.
- The **integration gate** runs `fullVerifyCmd` once.

## Data flow

```
SUPERVISED SETUP (once, human)                 UNATTENDED RUN (never blocks)
  detect cache + grant allowlist paths          caller → {spec/goal}
  (persists in settings.json)                     │
                                                  ▼ SCOUT: discover verifyCmd + fullVerifyCmd
                                                  │        classify cacheType; RED-WITNESS the cmd
                                                  │        (none / unverifiable → LLM-only, logged)
                                                  ▼ ISOLATE: reach cache by type (wrapper > symlink),
                                                  │          never blank wrapper; missing grant → degrade+report
                                                  ▼ PER TASK: implementer runs scoped (warm) during TDD;
                                                  │           gate = full discovered verifyCmd, watchdog-capped (exit 124)
                                                  ▼ INTEGRATION: fullVerifyCmd once, watchdog-capped
```

## Boule council resolutions

| Flaw (severity) | Resolution in this design |
|-----------------|----------------------------|
| "ask once" allowlist contradicts unattended (critical) | Permission provisioning moved to a **separate supervised Setup**; unattended run never prompts, degrades + reports if a grant is missing. |
| Scout has no verify-the-verifier (conceded) | **Red-witness the discovered command** (seed known-bad → must go red) before trusting it; reuse `redWitness` machinery. |
| Watchdog `__RC__` marker regression (drove gemini → needs-more-info) | Fix-loop branches on the watchdog's **own exit code (124)**; watchdog returns control so the marker is written. Proven in `tests/watchdog.sh`. (Resolved in Component C.) |
| Spot-check hybrid defers regression (conceded) | **Dropped**; per-task gate runs the full discovered command (warm). |
| External mid-run cache poisoning (conceded) | Prefer the **wrapper** over symlinking `target/`; guard local-dir sharing with refuse-if-main-checkout-active. |
| Scout/cache schema underspecified for remote/monorepo (conceded) | `cacheType` discriminator; remote → keep wrapper+env, no symlink; monorepo with no single command → degrade + report. |
| Diagnosis is n=1 (conceded) | Treated as provisional; the differential cold-vs-warm validation re-confirms the cache fix independently. |

## Genericity guarantee

The engine never names cargo/sccache/npm. The LLM Scout returns structured fields; the engine only wraps commands, symlinks named dirs, and (in Setup) asks-once. Zero per-ecosystem branching in engine code.

## Validation plan (verify-the-verifier)

- **C watchdog** (done): `tests/watchdog.sh` + `tests/engine/watchdog-gate.test.mjs`.
- **Scout discovery**: run on a cargo repo and a node repo (correct commands); delete the test config → no-gate fallback fires (logged).
- **Scout red-witness**: seed a vacuously-passing command → it is rejected (does not feed the gate).
- **Cache (differential)**: time one build in a fresh worktree **cold** vs **cache-reachable**; assert the warm path is dramatically faster (proves the symlink/wrapper actually warms it). Catches a mis-identified cache (still-cold but "configured").

## Phasing & reconciliation

1. **Component C** — shipped on branch `worktree-feature+up-watchdog-gate` off `origin/main`; synced into the installed engine. *(this commit)*
2. **Scout + Cache-reach + Supervised Setup** — this spec → `writing-plans` → subagent-driven-development.

Reconciliation: the source-of-truth engine is `origin/main` (= the installed v6 engine via the `0.3.1` plugin-cache symlink). The branch `fix/codex-watchdog-group-timeout` is **stale** (pre-v6, two-stage reviewer) and should be abandoned, not built on. All work bases on `origin/main`.

## Open questions

- Where does Supervised Setup live — a new slash command, a flag on the existing entry point, or a first-run interactive preflight? (decide in writing-plans)
- Red-witness of the discovered command at preflight needs a reproducible known-bad state on a clean tree; confirm the seed-mutation approach is cheap enough to run once per run (not per task).
