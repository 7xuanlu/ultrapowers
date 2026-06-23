# UP Self-Configuring Verify (Scout + Cache-reach) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make UP take only a spec/goal — discover the verify command by reading the repo and keep the isolated worktree's build cache warm — so it runs roughly as fast as SP, while preserving the deterministic gate.

**Architecture:** All logic lands in the single Workflow engine `workflow/ultrapowers-development.js` as preflight functions (`scout`, `witnessCommand`, `cacheReach`) wired into the run section before the build loop. Ecosystem knowledge lives in the LLM scout agent (returns structured fields); the engine only consumes fields, wraps commands, and symlinks named dirs — zero per-ecosystem branching. Component C (the structural watchdog) is already shipped and is reused by `witnessCommand`.

**Tech Stack:** JavaScript Workflow script (no FS/network in the JS sandbox — all shell work happens inside dispatched agents). Tests: `node --test tests/engine/*.test.mjs` using the `runEngine` + `makeAgent` mock-agent harness (`tests/engine/harness.mjs`).

## Global Constraints

- The engine is ONE self-contained file: `workflow/ultrapowers-development.js`. No imports, no new files in `workflow/`.
- The JS body has NO filesystem/network access; every shell/git action is performed by a dispatched `agent()`. Tests assert the engine's GENERATED prompts/return-handling, never real execution.
- Model routing (SDD least-powerful-per-role): discovery/judgment → `opus`; mechanical relay/copy → `haiku`. Reviews/critic/integration stay `opus`.
- Backward compatible: a caller-supplied `_args.verifyCmd` / `_args.fullVerifyCmd` ALWAYS wins; scout runs only when the caller omitted `verifyCmd`.
- Fail-open for insurance checks (witness/cache): an errored/inapplicable check must NEVER block an otherwise-green run; only a DEFINITE negative acts.
- After any edit: `npm run check` (syntax) and `npm run test:engine` must pass. SP pin stays `6.0.0`.
- The deterministic gate is the identity invariant: the harness decides `passed = (code === 0)`; never let an agent self-report pass/fail.

## File Structure

- Modify: `workflow/ultrapowers-development.js`
  - add `SCOUT` schema (near the other schemas, ~line 28-56)
  - add `scout()`, `witnessCommand(cmd)`, `cacheReach(info)` (preflight section, near `preflight()` ~line 692)
  - change `const verifyCmd` / `const FULL_VERIFY_CMD` → `let` (~line 76, 115) and populate them from scout in the run section (~after line 750 preflight, before the `while` loop ~760)
- Create: `tests/engine/scout.test.mjs`, `tests/engine/scout-witness.test.mjs`, `tests/engine/cache-reach.test.mjs`

## Supervised Setup (NOT an unattended task — documented manual step)

The sandbox write-allowlist grant (so a cache wrapper like sccache can write its cache dir) edits `settings.json` and is policy-gated — it must be a one-time **supervised** step, never a mid-run prompt (an unattended run that blocks defeats the use case). Scout SURFACES the needed paths (`allowlistPaths`); granting them is a human action run once (e.g. via the `update-config` skill or `/permissions`). The unattended run, if a grant is missing, DEGRADES (builds cold) and reports — it never blocks. This plan implements the detect-and-report half; the grant itself stays manual.

---

### Task 1: Scout discovers the verify command + cache shape

**Files:**
- Modify: `workflow/ultrapowers-development.js` (add `SCOUT` schema + `scout()`)
- Test: `tests/engine/scout.test.mjs`

**Interfaces:**
- Produces: `async function scout(): {verifyCmd, fullVerifyCmd, cacheType, cacheWrapper, cacheDirs, allowlistPaths}` — dispatches one `opus` agent labeled `scout` in phase `Preflight`.

- [ ] **Step 1: Write the failing test**

```js
// tests/engine/scout.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runEngine, makeAgent } from './harness.mjs'

test('scout runs at preflight (goal mode, no caller verifyCmd) and discovers a command', async () => {
  let scoutPrompt = null
  const { agent, calls } = makeAgent((p, o) => {
    const l = o.label || ''
    if (l === 'sp-version-check') return { installed: ['6.0.0'] }
    if (l === 'scout') { scoutPrompt = p; return { verifyCmd: 'cargo nextest run', fullVerifyCmd: 'cargo nextest run --all', cacheType: 'wrapper', cacheWrapper: 'sccache', cacheDirs: [], allowlistPaths: ['/Users/x/Library/Caches/Mozilla.sccache'] } }
    if (l === 'plan') return { tasks: [] }            // empty plan → no build, isolate the preflight
    return undefined
  })
  await runEngine({ args: { goal: 'build a thing' }, agent, log: () => {} })
  assert.ok(scoutPrompt, 'scout must be dispatched when goal is set and no verifyCmd given')
  assert.equal(calls.find(c => c.label === 'scout').model, 'opus', 'scout is a discovery/judgment agent → opus')
  assert.match(scoutPrompt, /Cargo\.toml|package\.json|Makefile/, 'scout prompt must direct it to read build manifests')
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/engine/scout.test.mjs`
Expected: FAIL — no `scout` agent is dispatched (function does not exist).

- [ ] **Step 3: Add the schema and function**

Add near the other schemas (after `PLAN`, ~line 49):

```js
const SCOUT = { type: 'object', required: ['cacheType'], properties: {
  verifyCmd:      { type: ['string', 'null'] },
  fullVerifyCmd:  { type: ['string', 'null'] },
  cacheType:      { enum: ['wrapper', 'local-dir', 'remote', 'none'] },
  cacheWrapper:   { type: ['string', 'null'] },
  cacheDirs:      { type: 'array', items: { type: 'string' } },
  allowlistPaths: { type: 'array', items: { type: 'string' } } } }
```

Add in the preflight section (before `async function preflight()`):

```js
// Self-configuring verify: discover HOW to test + how the build cache works by reading the repo —
// what SP's in-session agent does implicitly. Ecosystem knowledge lives HERE (an LLM), not the engine.
async function scout() {
  return await agent(
    `Discover how to VERIFY this project and how its BUILD CACHE works, by reading the repo.` + REPO_NOTE + `\n` +
    `Inspect: build manifests (package.json scripts, Cargo.toml, pyproject.toml, go.mod), Makefile/Justfile, ` +
    `CI config (.github/workflows/*.yml), README. Base every field on a file you actually read — do NOT guess.\n\n` +
    `Return:\n` +
    `- verifyCmd: one shell command that runs this project's tests/checks and exits 0 iff they pass (prefer the FAST form a developer runs while iterating). null if you genuinely cannot determine one.\n` +
    `- fullVerifyCmd: the COMPREHENSIVE suite (full workspace + lint/typecheck), run once before merge. May equal verifyCmd.\n` +
    `- cacheType: 'wrapper' if a compiler-cache WRAPPER is configured (e.g. .cargo/config.toml rustc-wrapper=sccache, CC=ccache); 'remote' if that cache is cloud/remote (sccache with SCCACHE_BUCKET/REDIS, env-driven); 'local-dir' if the only cache is a build-output dir a FRESH git worktree would NOT inherit (target/, build/) and rebuilding it is expensive; else 'none'.\n` +
    `- cacheWrapper: the wrapper binary (e.g. "sccache"), or null.\n` +
    `- cacheDirs: repo-relative local dirs to make reachable in a fresh worktree (for 'local-dir'); [] otherwise.\n` +
    `- allowlistPaths: filesystem paths the cache wrapper must WRITE that a restrictive sandbox might block (e.g. sccache's cache dir); [] if none.`,
    { label: 'scout', phase: 'Preflight', model: 'opus', schema: SCOUT })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/engine/scout.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add workflow/ultrapowers-development.js tests/engine/scout.test.mjs
git commit -m "feat(engine): scout preflight discovers verify command + cache shape"
```

---

### Task 2: Red-witness the discovered command (reject a vacuous gate)

**Files:**
- Modify: `workflow/ultrapowers-development.js` (add `witnessCommand(cmd)`)
- Test: `tests/engine/scout-witness.test.mjs`

**Interfaces:**
- Consumes: `wrapWatchdog`, `VERIFY_TIMEOUT_MS`, `REDWITNESS` schema, `doCommit`, `GIT` (all existing).
- Produces: `async function witnessCommand(cmd): boolean` — true = trust the command; false ONLY when a seeded break did not make it fail. Fail-open on error/no-commit.

- [ ] **Step 1: Write the failing test**

```js
// tests/engine/scout-witness.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runEngine, makeAgent } from './harness.mjs'

test('a discovered command that stays GREEN under a seeded break is rejected (vacuous gate)', async () => {
  let verifyDispatched = false
  const { agent } = makeAgent((p, o) => {
    const l = o.label || ''
    if (l === 'sp-version-check') return { installed: ['6.0.0'] }
    if (l === 'scout') return { verifyCmd: 'true', fullVerifyCmd: 'true', cacheType: 'none', cacheWrapper: null, cacheDirs: [], allowlistPaths: [] }
    if (l === 'scout-witness') return { applicable: true, redWitnessed: false, detail: 'broke prod, suite still passed' }
    if (l === 'plan') return { tasks: [{ id: 't1', spec: 'x' }] }
    if (l.startsWith('capture-head:')) return { sha: 'a'.repeat(40) }
    if (l.startsWith('claude:') || l.startsWith('codex:')) return { status: 'done', files: [], summary: 'ok' }
    if (l.startsWith('verify:')) { verifyDispatched = true; return { code: 0, tail: '' } }
    if (l.startsWith('review-package:')) return { path: '/tmp/d' }
    if (l.startsWith('review-task:')) return { specVerdict: 'pass', findings: [], cannotVerify: [], strengths: [], assessment: 'ok' }
    if (l.startsWith('checkpoint:')) return {}
    if (l === 'integration-review') return { approved: true, findings: [] }
    return undefined
  })
  await runEngine({ args: { goal: 'g', implementer: 'claude' }, agent, log: () => {} })
  // Rejected vacuous command must NOT become the gate → verify() sees no verifyCmd → never dispatches.
  assert.equal(verifyDispatched, false, 'a rejected (vacuous) discovered command must not feed the deterministic gate')
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/engine/scout-witness.test.mjs`
Expected: FAIL — without `witnessCommand`, the discovered `'true'` is adopted and `verify:` dispatches.

- [ ] **Step 3: Implement `witnessCommand`**

```js
// Red-witness the DISCOVERED command: seed a guaranteed break, confirm the command goes RED, restore.
// A command that stays green on broken code is a vacuous gate — reject it (would silently defeat the
// "don't trust the self-report" identity). Fail-OPEN: only a definite redWitnessed:false rejects.
async function witnessCommand(cmd) {
  if (!doCommit) return true   // no per-commit restore guarantee → can't safely seed/revert; trust (insurance, not primary)
  const file = `/tmp/up-scout-verify.sh`
  const sec = Math.ceil(VERIFY_TIMEOUT_MS / 1000)
  const w = await agent(
    `RED-WITNESS the discovered verify command — prove it exercises the code (not a vacuous pass).` + REPO_NOTE + `\n` +
    `STEP 1 — pick ONE production source file (NOT a test, NOT config) and make a SMALL guaranteed-breaking change (flip a boolean, change a return value, or introduce a syntax error). Note the file.\n` +
    `STEP 2 — write this command VERBATIM to ${file}: ${cmd}\n` +
    `STEP 3 — run it under the structural timeout (SET Bash \`timeout\` to ${VERIFY_TIMEOUT_MS + 30000}); run EXACTLY:\n` +
    `  ${wrapWatchdog('sh', sec, file)}; echo "__RC__=$?"\n` +
    `STEP 4 — ALWAYS restore: \`${GIT} checkout -- <the file you changed>\`, confirm \`${GIT} status\` clean, even if STEP 3 errored.\n` +
    `Return {applicable:true, redWitnessed:<true iff __RC__ was NON-zero — the command FAILED on the broken code, which is GOOD>, detail:"<what you broke; RC>"}. ` +
    `redWitnessed=false ONLY if the command PASSED (RC=0) despite the real break = vacuous gate.`,
    { label: 'scout-witness', phase: 'Preflight', model: 'haiku', schema: REDWITNESS })
  return !(w && w.redWitnessed === false)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/engine/scout-witness.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add workflow/ultrapowers-development.js tests/engine/scout-witness.test.mjs
git commit -m "feat(engine): red-witness the scout-discovered command before trusting it"
```

---

### Task 3: Wire scout into the run (populate verifyCmd, caller override, fallback)

**Files:**
- Modify: `workflow/ultrapowers-development.js` — `const verifyCmd`→`let` (~line 76), `const FULL_VERIFY_CMD`→`let` (~line 115); add the scout block after `preflight()` returns, before the `while (queue.length …)` loop.
- Test: extend `tests/engine/scout.test.mjs`

**Interfaces:**
- Consumes: `scout()`, `witnessCommand()`, mutable `verifyCmd` / `FULL_VERIFY_CMD`.
- Produces: module-scoped `cacheInfo` ({type, wrapper, dirs, allowlist} | null) for Task 4.

- [ ] **Step 1: Write the failing test** (append to `tests/engine/scout.test.mjs`)

```js
test('caller verifyCmd wins (scout is skipped); and a null discovery falls back to LLM-only', async () => {
  // (a) caller override
  let scoutWhenOverride = false
  let a = makeAgent((p, o) => {
    if (o.label === 'sp-version-check') return { installed: ['6.0.0'] }
    if (o.label === 'scout') { scoutWhenOverride = true; return { cacheType: 'none' } }
    if (o.label === 'plan') return { tasks: [] }
    return undefined
  })
  await runEngine({ args: { goal: 'g', verifyCmd: 'make test' }, agent: a.agent, log: () => {} })
  assert.equal(scoutWhenOverride, false, 'caller verifyCmd must skip scout entirely')

  // (b) scout finds nothing → no gate, run still completes (verify never dispatches)
  let verifyDispatched = false
  let b = makeAgent((p, o) => {
    const l = o.label || ''
    if (l === 'sp-version-check') return { installed: ['6.0.0'] }
    if (l === 'scout') return { verifyCmd: null, cacheType: 'none', cacheDirs: [], allowlistPaths: [] }
    if (l === 'plan') return { tasks: [{ id: 't1', spec: 'x' }] }
    if (l.startsWith('capture-head:')) return { sha: 'a'.repeat(40) }
    if (l.startsWith('claude:')) return { status: 'done', files: [], summary: 'ok' }
    if (l.startsWith('verify:')) { verifyDispatched = true; return { code: 0, tail: '' } }
    if (l.startsWith('review-package:')) return { path: '/tmp/d' }
    if (l.startsWith('review-task:')) return { specVerdict: 'pass', findings: [], cannotVerify: [], strengths: [], assessment: 'ok' }
    if (l.startsWith('checkpoint:')) return {}
    if (l === 'integration-review') return { approved: true, findings: [] }
    return undefined
  })
  await runEngine({ args: { goal: 'g', implementer: 'claude' }, agent: b.agent, log: () => {} })
  assert.equal(verifyDispatched, false, 'no discovered command → deterministic gate skipped (LLM review only)')
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/engine/scout.test.mjs`
Expected: FAIL — scout currently always runs / discovered cmd not wired.

- [ ] **Step 3: Make the two consts mutable and add the wiring**

Change `const verifyCmd = _args.verifyCmd || null` → `let verifyCmd = _args.verifyCmd || null`.
Change `const FULL_VERIFY_CMD = _args.fullVerifyCmd || null` → `let FULL_VERIFY_CMD = _args.fullVerifyCmd || null`.
Add a module-scoped `let cacheInfo = null` near them.

After the existing `const pf = await preflight()` / abort check (~line 751), before `const alreadyDone = await loadDone()`:

```js
// Self-configure the verify command when the caller did NOT supply one (SP-like discovery).
if (!verifyCmd) {
  const sc = await scout()
  if (sc && sc.verifyCmd && await witnessCommand(sc.verifyCmd)) {
    verifyCmd = sc.verifyCmd
    if (!FULL_VERIFY_CMD) FULL_VERIFY_CMD = sc.fullVerifyCmd || sc.verifyCmd
    cacheInfo = { type: sc.cacheType, wrapper: sc.cacheWrapper || null, dirs: sc.cacheDirs || [], allowlist: sc.allowlistPaths || [] }
    log(`scout: verifyCmd="${verifyCmd}" (red-witnessed); cacheType=${sc.cacheType}`)
  } else if (sc && sc.verifyCmd) {
    log(`scout: discovered "${sc.verifyCmd}" but it stayed GREEN on a seeded break — REJECTED (vacuous gate); deterministic gate skipped, LLM review only`)
  } else {
    log(`scout: no verify command discovered — deterministic gate skipped, LLM review only`)
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/engine/scout.test.mjs && npm run check`
Expected: PASS, syntax ok.

- [ ] **Step 5: Commit**

```bash
git add workflow/ultrapowers-development.js tests/engine/scout.test.mjs
git commit -m "feat(engine): wire scout into the run (caller override + vacuous/none fallback)"
```

---

### Task 4: Cache-reach — warm a fresh worktree by cacheType

**Files:**
- Modify: `workflow/ultrapowers-development.js` (add `cacheReach(info)`, call it after the scout block)
- Test: `tests/engine/cache-reach.test.mjs`

**Interfaces:**
- Consumes: `cacheInfo` (from Task 3), `repoDir`, `GIT`.
- Produces: `async function cacheReach(info): void` — for `local-dir`, dispatches a `haiku` agent labeled `cache-reach` that symlinks each `dir` from the repo's common checkout into the worktree, refusing if the main checkout is actively building. For `wrapper`/`remote`/`none`, only logs (a `wrapper` whose `allowlist` isn't granted logs a degrade warning).

- [ ] **Step 1: Write the failing test**

```js
// tests/engine/cache-reach.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runEngine, makeAgent } from './harness.mjs'

function driver(scoutReturn, capture) {
  return makeAgent((p, o) => {
    const l = o.label || ''
    if (l === 'sp-version-check') return { installed: ['6.0.0'] }
    if (l === 'scout') return scoutReturn
    if (l === 'scout-witness') return { applicable: true, redWitnessed: true, detail: 'ok' }
    if (l === 'cache-reach') { capture.prompt = p; capture.model = o.model; return { ok: true } }
    if (l === 'plan') return { tasks: [{ id: 't1', spec: 'x' }] }
    if (l.startsWith('capture-head:')) return { sha: 'a'.repeat(40) }
    if (l.startsWith('claude:')) return { status: 'done', files: [], summary: 'ok' }
    if (l.startsWith('verify:')) return { code: 0, tail: '' }
    if (l.startsWith('review-package:')) return { path: '/tmp/d' }
    if (l.startsWith('review-task:')) return { specVerdict: 'pass', findings: [], cannotVerify: [], strengths: [], assessment: 'ok' }
    if (l.startsWith('checkpoint:')) return {}
    if (l === 'integration-review') return { approved: true, findings: [] }
    return undefined
  })
}

test('local-dir cache type symlinks the dirs into the worktree; none does nothing', async () => {
  const cap = {}
  const a = driver({ verifyCmd: 'cargo test', fullVerifyCmd: 'cargo test', cacheType: 'local-dir', cacheWrapper: null, cacheDirs: ['target'], allowlistPaths: [] }, cap)
  await runEngine({ args: { goal: 'g', implementer: 'claude', repoDir: '/tmp/wt' }, agent: a.agent, log: () => {} })
  assert.ok(cap.prompt, 'cache-reach must dispatch for cacheType local-dir')
  assert.equal(cap.model, 'haiku', 'cache-reach is a mechanical relay → haiku')
  assert.match(cap.prompt, /target/, 'cache-reach must reference the cacheDirs to symlink')
  assert.match(cap.prompt, /ln -s|symlink/i, 'cache-reach must symlink the cache dir into the worktree')

  const cap2 = {}
  const b = driver({ verifyCmd: 'cargo test', fullVerifyCmd: 'cargo test', cacheType: 'none', cacheWrapper: null, cacheDirs: [], allowlistPaths: [] }, cap2)
  await runEngine({ args: { goal: 'g', implementer: 'claude', repoDir: '/tmp/wt' }, agent: b.agent, log: () => {} })
  assert.equal(cap2.prompt, undefined, 'cacheType none must NOT dispatch cache-reach')
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/engine/cache-reach.test.mjs`
Expected: FAIL — no `cache-reach` agent exists.

- [ ] **Step 3: Implement `cacheReach` and call it**

Add after `witnessCommand`:

```js
const CACHE_REACH = { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' }, detail: { type: 'string' } } }
// Make a fresh worktree's build cache warm without per-ecosystem logic: act on the scout's cacheType.
// 'local-dir' → symlink the named dirs from the repo's COMMON checkout into the worktree (reversible);
// refuse if the main checkout is mid-build (external mutation would poison a shared dir). 'wrapper'/'remote'
// keep the wrapper (UP never blanks it); a wrapper whose allowlist isn't granted just logs a cold-build warning.
async function cacheReach(info) {
  if (!info || info.type === 'none') return
  if (info.type === 'wrapper' || info.type === 'remote') {
    log(`cache: type=${info.type} wrapper=${info.wrapper || 'n/a'} — wrapper kept (never blanked).` +
        (info.allowlist && info.allowlist.length ? ` REQUIRES sandbox write-allowlist for: ${info.allowlist.join(', ')} (one-time supervised grant) — else builds run COLD.` : ''))
    return
  }
  if (info.type === 'local-dir' && info.dirs && info.dirs.length && repoDir) {
    await agent(
      `Warm this worktree's build cache by sharing it from the repo's main checkout.` + REPO_NOTE + `\n` +
      `STEP 1 — find the common checkout: \`${GIT} rev-parse --git-common-dir\` (its parent is the main worktree root). If repoDir IS the common checkout (not a linked worktree), STOP and return {ok:true, detail:"main checkout — cache already warm"}.\n` +
      `STEP 2 — SAFETY: if the main checkout has a build actively running (e.g. a lock under ${info.dirs.join('/, ')} held, or an obvious in-progress build), STOP and return {ok:false, detail:"main checkout busy — not sharing to avoid cache poisoning"}.\n` +
      `STEP 3 — for EACH of these dirs [${info.dirs.join(', ')}]: if it is absent in the worktree but present in the main checkout, symlink it in: \`ln -s <main>/<dir> ${repoDir}/<dir>\`. Do NOT overwrite an existing real dir.\n` +
      `Return {ok:true, detail:"symlinked <dirs>"}.`,
      { label: 'cache-reach', phase: 'Preflight', model: 'haiku', schema: CACHE_REACH })
  }
}
```

In the scout block (Task 3 Step 3), after `cacheInfo = {...}` is set, add `await cacheReach(cacheInfo)`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/engine/cache-reach.test.mjs && npm run check`
Expected: PASS, syntax ok.

- [ ] **Step 5: Commit**

```bash
git add workflow/ultrapowers-development.js tests/engine/cache-reach.test.mjs
git commit -m "feat(engine): cache-reach warms a fresh worktree by scout cacheType"
```

---

### Task 5: Full regression + integration sanity

**Files:** none (verification only)

- [ ] **Step 1: Run the whole engine suite**

Run: `npm run check && npm run test:engine && npm run test:watchdog`
Expected: `engine syntax ok`; all engine tests pass (22+); `watchdog: all checks passed`.

- [ ] **Step 2: Confirm the deterministic-gate invariant survives**

Run: `node --test tests/engine/h1-spec-fail.test.mjs tests/engine/review-merge.test.mjs`
Expected: PASS — the merged reviewer + spec-fail gating are unaffected by the preflight additions.

- [ ] **Step 3: Sync the updated engine into the installed plugin cache**

Run (sandbox disabled — cache dir is outside the write-allowlist):
```bash
cp workflow/ultrapowers-development.js ~/.claude/plugins/cache/7xuanlu/ultrapowers/0.3.1/workflow/ultrapowers-development.js
```
Expected: the symlinked installed engine now contains `scout`/`cacheReach`; re-run `npm run check` against the cache path to confirm syntax.

- [ ] **Step 4: Commit any final touch-ups** (if Step 1-3 surfaced fixes)

```bash
git add -A && git commit -m "test(engine): full suite green for self-configuring verify"
```

---

## Self-Review

**Spec coverage:** Scout discovery (Task 1) ✓; red-witness the command (Task 2) ✓; gate wiring + caller-override + fallback (Task 3) ✓; Cache-reach by cacheType incl. wrapper-allowlist degrade-report (Task 4) ✓; deterministic gate preserved (Task 3 keeps `passed = code===0`, gate skipped not faked) ✓; genericity — engine consumes fields only ✓. Supervised Setup grant is intentionally manual (documented above), with `allowlistPaths` surfaced by scout and the cold-build warning logged by Task 4. The watchdog signal (Component C) is already shipped and reused by `witnessCommand`.

**Not in this plan (deferred):** the supervised `settings.json` allowlist GRANT flow (policy-gated, interactive); the differential cold-vs-warm timing harness and the real Rust speed test (separate validation run, needs a cargo target).

**Type consistency:** `scout()` returns the `SCOUT`-shaped object; Task 3 reads `.verifyCmd/.fullVerifyCmd/.cacheType/.cacheWrapper/.cacheDirs/.allowlistPaths` (matches schema). `cacheInfo` is `{type, wrapper, dirs, allowlist}`; Task 4 reads `.type/.wrapper/.dirs/.allowlist` (matches). `witnessCommand` returns boolean; Task 3 uses it in a boolean `&&`. `REDWITNESS`/`wrapWatchdog`/`VERIFY_TIMEOUT_MS`/`GIT`/`repoDir`/`doCommit` are all existing engine symbols.
