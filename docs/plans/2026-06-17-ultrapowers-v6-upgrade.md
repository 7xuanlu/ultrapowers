# Ultrapowers v6 Parity Upgrade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-sync the ultrapowers Workflow engine to Superpowers 6.0.0 — merge the two per-task reviewers into one, add the ⚠️ `cannot_verify` tier (fail-closed, routed to integration review), port the v6 reviewer hardening + diff-file handoff + implementer TDD-evidence + durable-progress ledger — with four council-found safety invariants enforced in the deterministic coordinator.

**Architecture:** The engine (`workflow/ultrapowers-development.js`) is a single Workflow script with one `export` (`meta`); all other logic is module-body code that runs on injected runtime globals (`agent`, `log`, `args`, `budget`). It cannot be unit-tested conventionally. Task 1 builds a **scenario harness** (`tests/engine/harness.mjs`) that loads the engine body with a scriptable mock `agent()` and returns the engine's result object; every subsequent change is TDD'd by driving mock reviewer/gate responses and asserting on that result. Existing `tests/check-engine.sh` (syntax gate) stays and runs after every change.

**Tech Stack:** Node ≥18 ESM, `node --test`, `node:vm`/`new Function` for engine loading, bash for `check-engine.sh` and bench scripts. No new dependencies.

**Design spec:** `docs/design/2026-06-17-ultrapowers-v6-upgrade-design.md` (read it before starting).

## Global Constraints

- Single source file for the engine: `workflow/ultrapowers-development.js`. It has exactly one `export` (`export const meta`); do **not** add other `export`s (the Workflow runtime loads the body and `tests/check-engine.sh` strips `export` to compile). Verbatim from spec §3.
- The Workflow JS sandbox has **no filesystem/Node API access and forbids `Date.now()`/`Math.random()`/argless `new Date()`** — the engine must not introduce them.
- Every `agent()` call MUST pin a `model` explicitly (omitted model inherits the priciest). Verbatim from spec §4.6 / §7.
- Reviewers/critic/integration run on `opus`; verify/checkpoint/capture-head/review-package/preflight run on `haiku`; implementer per `implModel`. Verbatim from existing engine routing.
- Fail-closed is non-negotiable: a reviewer tool-error counts as a block (`{approved:false, unavailable:true}` → `needsHuman`), never a silent pass. Verbatim from spec §3.
- `SP_VERSION` after this work = `'6.0.0'`. Verbatim from spec §5.7.
- After every engine edit run `npm run check` (syntax gate) and the relevant `node --test` scenario; both must pass before commit.
- Commit messages: Conventional Commits; end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## File Structure

- `workflow/ultrapowers-development.js` — the engine (modified throughout).
- `tests/engine/harness.mjs` — NEW: loads the engine with mocked runtime globals; returns `{result, calls}`.
- `tests/engine/*.test.mjs` — NEW: one `node --test` file per behavior area.
- `package.json` — add a `test:engine` script.
- `bench/run.sh`, `bench/tasks.json`, `bench/fixtures/`, `bench/tasks/` — bench arms + safety-path fixture (Tasks 11–12).

---

### Task 1: Scenario test harness + smoke test

**Files:**
- Create: `tests/engine/harness.mjs`
- Create: `tests/engine/smoke.test.mjs`
- Modify: `package.json` (add `test:engine` script)

**Interfaces:**
- Produces: `runEngine({ args, agent, log, budget }) → Promise<result>` and a call-recording mock factory `makeAgent(responder) → { agent, calls }` where `responder(prompt, opts) → object|null` returns the scripted structured output for each dispatched agent (matched by `opts.label`). `calls` is an array of `{label, model, phase, prompt}`.

- [ ] **Step 1: Write the failing test**

`tests/engine/smoke.test.mjs`:
```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runEngine } from './harness.mjs'

test('empty args returns the usage note without dispatching agents', async () => {
  const calls = []
  const result = await runEngine({
    args: {},
    agent: async (prompt, opts) => { calls.push(opts?.label); return null },
    log: () => {},
  })
  assert.equal(calls.length, 0, 'no agents should be dispatched for empty args')
  assert.equal(result.total, 0)
  assert.match(result.note, /args\.tasks/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/engine/smoke.test.mjs`
Expected: FAIL — `Cannot find module './harness.mjs'`.

- [ ] **Step 3: Write minimal implementation**

`tests/engine/harness.mjs`:
```js
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ENGINE = join(dirname(fileURLToPath(import.meta.url)), '../../workflow/ultrapowers-development.js')

// Load the engine body the way the Workflow runtime does: strip `export`, wrap as an async IIFE,
// inject the runtime globals as function params. The body's top-level `return` becomes our result.
export async function runEngine({ args = {}, agent, log, budget } = {}) {
  const src = readFileSync(ENGINE, 'utf8').replace(/^export\s+/gm, '')
  const _agent = agent || (async () => null)
  const _log = log || (() => {})
  // parallel/pipeline/phase are accepted but the engine drives tasks serially; pass-throughs keep
  // the body safe if a future change references them.
  const _parallel = async (thunks) => Promise.all(thunks.map(t => t()))
  const _pipeline = async (items) => items
  const _phase = () => {}
  const fn = new Function(
    'agent', 'parallel', 'pipeline', 'log', 'phase', 'args', 'budget',
    '"use strict"; return (async () => {\n' + src + '\n})()'
  )
  return fn(_agent, _parallel, _pipeline, _log, _phase, args, budget)
}

// Convenience: a mock agent that records every dispatch and delegates scripted responses to
// `responder(prompt, opts)`. Return `undefined` from responder to fall through to null (agent error).
export function makeAgent(responder) {
  const calls = []
  const agent = async (prompt, opts = {}) => {
    calls.push({ label: opts.label, model: opts.model, phase: opts.phase, prompt })
    const r = responder(prompt, opts)
    return r === undefined ? null : r
  }
  return { agent, calls }
}
```

Add to `package.json` `scripts`:
```json
    "test:engine": "node --test tests/engine/"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/engine/smoke.test.mjs` → Expected: PASS.
Run: `npm run check` → Expected: `engine syntax ok`.

- [ ] **Step 5: Commit**

```bash
git add tests/engine/harness.mjs tests/engine/smoke.test.mjs package.json
git commit -m "test: scenario harness for the Workflow engine

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Merged reviewer — `TASK_REVIEW` schema + `reviewTask`

Replace `reviewSpec` + `reviewQuality` with one opus agent that reads the scoped diff once and returns a spec verdict plus dimensioned findings. Faithful port of v6 `task-reviewer-prompt.md`.

**Files:**
- Modify: `workflow/ultrapowers-development.js` — add `TASK_REVIEW` schema near `REVIEW` (`:36-40`); replace `reviewSpec` (`:440-469`) and `reviewQuality` (`:473-510`) with one `reviewTask`.
- Create: `tests/engine/review-merge.test.mjs`

**Interfaces:**
- Consumes: `blocking(rev)` (`:59`), `REVIEW_RETRY` (`:70`), `GIT`, `REPO_NOTE`.
- Produces: `async reviewTask(task, r, baseSha, diffFile) → {specVerdict:'pass'|'fail'|'cannot_verify', findings:[{severity,dimension,issue,fix}], cannotVerify:[string], strengths:[string], assessment, approved}`; on reviewer error returns `{approved:false, unavailable:true}`. `diffFile` may be null in this task (Task 7 wires the file).

- [ ] **Step 1: Write the failing test**

`tests/engine/review-merge.test.mjs`:
```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runEngine, makeAgent } from './harness.mjs'

// Drives ONE task through the engine and asserts exactly one merged review agent runs
// (label review-task:*), not a separate spec + quality pair.
function baseResponder(prompt, opts) {
  const l = opts.label || ''
  if (l === 'sp-version-check') return { installed: ['6.0.0'] }
  if (l.startsWith('capture-head:')) return { sha: 'aaaaaaa0000000000000000000000000000000a' }
  if (l.startsWith('claude:')) return { status: 'done', files: ['src/x.js'], summary: 'did it' }
  if (l.startsWith('verify:')) return { code: 0, tail: 'ok' }
  if (l.startsWith('red-witness:')) return { applicable: false }
  if (l.startsWith('checkpoint:')) return {}
  if (l === 'integration-review') return { approved: true, findings: [], strengths: [], assessment: 'ok' }
  return undefined
}

test('one merged review agent per task, no separate spec/quality pair', async () => {
  const { agent, calls } = makeAgent((p, o) => {
    if ((o.label || '').startsWith('review-task:')) return { specVerdict: 'pass', findings: [], cannotVerify: [], strengths: ['clean'], assessment: 'good', approved: true }
    return baseResponder(p, o)
  })
  const result = await runEngine({
    args: { tasks: [{ id: 't1', spec: 'do x' }], implementer: 'claude', verifyCmd: 'true', commit: true },
    agent, log: () => {},
  })
  const reviewLabels = calls.map(c => c.label).filter(l => /^review-(task|spec|quality):/.test(l))
  assert.ok(reviewLabels.every(l => l.startsWith('review-task:')), `got ${reviewLabels.join(',')}`)
  assert.equal(reviewLabels.length, 1, 'exactly one merged review per passing task')
  assert.deepEqual(result.passed, ['t1'])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/engine/review-merge.test.mjs`
Expected: FAIL — the engine still dispatches `review-spec:`/`review-quality:` labels (assertion on `review-task:` fails).

- [ ] **Step 3: Write minimal implementation**

In `workflow/ultrapowers-development.js`, after the `REVIEW` schema block (`:36-40`) add:
```js
// v6 merged task reviewer: one pass, one diff read, spec verdict + dimensioned findings.
const TASK_REVIEW = { type: 'object', required: ['specVerdict', 'approved'], properties: {
  specVerdict:  { enum: ['pass', 'fail', 'cannot_verify'] },
  findings:     { type: 'array', items: { type: 'object', required: ['severity', 'dimension', 'issue'], properties: {
                    severity:  { enum: ['critical', 'important', 'minor'] },
                    dimension: { enum: ['spec', 'quality'] },
                    issue: { type: 'string' }, fix: { type: 'string' } } } },
  cannotVerify: { type: 'array', items: { type: 'string' } },
  strengths:    { type: 'array', items: { type: 'string' } },
  assessment:   { type: 'string' },
  approved:     { type: 'boolean' } } }
```

Delete `reviewSpec` (`:440-469`) and `reviewQuality` (`:473-510`) and replace with:
```js
// ---- merged reviewer (SDD v6 task-reviewer-prompt.md, fail-closed) ----
// One opus pass reads this task's SCOPED diff once and returns a spec verdict + code-quality
// findings. Blocking is still severity-derived (critical|important); specVerdict='fail' is an
// UNCONDITIONAL controller-level block enforced in buildTask (H1). cannot_verify items never block
// here — they route to the integration review (H3).
async function reviewTask(task, r, baseSha, diffFile) {
  const diffSrc = diffFile
    ? `the review package at ${diffFile} (commit list + stat + the full -U10 diff). Read it ONCE; the diff's context lines ARE the changed files. If the file is missing, run \`${GIT} diff ${baseSha}..HEAD\` yourself.`
    : (baseSha ? `\`${GIT} diff ${baseSha}..HEAD\` (this task's changes only)` : `\`${GIT} diff\` / \`${GIT} status\``)
  const prompt =
    `You are reviewing ONE task's implementation: first whether it matches its requirements, then whether it is well-built. Task-scoped gate, not a merge review.` + REPO_NOTE + `\n\n` +
    `## What Was Requested\n${task.spec}\n\n` +
    `## What Implementer Claims\nFiles: ${JSON.stringify(r.files || [])}. Summary: ${r.summary || 'none'}.` +
    (r.tddEvidence ? ` TDD evidence — RED: ${r.tddEvidence.red || 'n/a'}; GREEN: ${r.tddEvidence.green || 'n/a'}.` : '') + `\n\n` +
    `## Do Not Trust the Report\n` +
    `Treat the implementer's report as unverified claims. Verify against the diff. Design rationales in the report are claims too: "left it per YAGNI", "kept it simple deliberately" — a stated rationale NEVER downgrades a finding's severity. Judge the code on its merits.\n\n` +
    `## Your view of the change\nInspect ${diffSrc} Do NOT crawl the broader codebase; inspect code outside the diff only to evaluate a concrete risk you can name.\n` +
    `Your review is READ-ONLY on this checkout: do NOT mutate the working tree, the index, or HEAD.\n\n` +
    `## Part 1: Spec Compliance\nCompare the diff against What Was Requested:\n` +
    `- Missing: requirements skipped/claimed-but-not-implemented\n- Extra: unrequested features, over-engineering\n- Misunderstood: right feature built wrong, wrong problem solved\n` +
    `If a requirement CANNOT be verified from this diff alone (it lives in unchanged code or spans tasks), report it as a cannot_verify item instead of broadening your search.\n\n` +
    `## Part 2: Code Quality\n- Clean separation of concerns? Proper error handling? DRY without premature abstraction? Edge cases?\n` +
    `- Tests: do new/changed tests verify REAL behavior (not mocks)? Are the task's edge cases covered?\n` +
    `- Structure: one clear responsibility per file? Units independently testable? Did this change create already-large files or significantly grow existing ones (judge only what THIS change contributed)?\n` +
    `- Anti-gaming (any of these is a critical finding): weakened/deleted existing tests to force green; edited the gate/verify config to force green; placeholders/stubs/TODOs claiming done; test-only methods on production classes; tests mocking behavior instead of testing it.\n\n` +
    `## Tests\nThe implementer already ran the suite and reported results. Do NOT re-run the full suite to confirm. Run a focused test only if reading the code raises a specific named doubt — never a package-wide suite. Warnings/noise in the reported output ARE findings.\n\n` +
    `## Calibration\nNot everything is Critical. critical = incorrect behavior, a missed requirement, or maintainability damage you would block a merge over (verbatim duplication of a logic block, swallowed errors, tests that assert nothing) OR an anti-gaming violation. important = fragile code, partially-met spec, unrequested/over-built behavior, missing error handling. minor = coverage-could-be-broader, polish. Acknowledge strengths before listing issues.\n\n` +
    `## Output\nReturn {specVerdict, findings:[{severity, dimension:'spec'|'quality', issue (with file:line), fix}], cannotVerify:[<requirement + what the controller should check>], strengths:[...], assessment}.\n` +
    `specVerdict='pass' if spec is fully met in the diff; 'fail' if a requirement is missing/extra/misunderstood (a 'fail' MUST be accompanied by at least one critical|important spec-dimension finding); 'cannot_verify' ONLY for requirements outside the diff (also list them in cannotVerify). Set approved=true ONLY if specVerdict!=='fail' AND no critical|important findings.`
  for (let k = 0; k <= REVIEW_RETRY; k++) {
    const rev = await agent(prompt, { label: `review-task:${task.id}#${k + 1}`, phase: `task:${task.id}`, model: 'opus', schema: TASK_REVIEW })
    if (rev) return rev
    log(`task reviewer errored on ${task.id} (${k + 1}/${REVIEW_RETRY + 1})`)
  }
  return { approved: false, unavailable: true }   // FAIL CLOSED
}
```

(Note: `buildTask` still references the old functions; Task 3 rewires it. This task may leave the engine temporarily calling removed functions — that is acceptable mid-task because the merge test drives the path Task 3 completes. If `npm run check` passes but the review-merge test needs Task 3's wiring to go green, do Task 3's Step 3 now as part of this commit. Implement Tasks 2 and 3 together if the reviewer prefers a single green commit.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run check` → `engine syntax ok`.
Run: `node --test tests/engine/review-merge.test.mjs` → PASS (after Task 3 wiring).

- [ ] **Step 5: Commit**

```bash
git add workflow/ultrapowers-development.js tests/engine/review-merge.test.mjs
git commit -m "feat: merge spec+quality reviewers into one v6 task reviewer

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Wire `buildTask` to `reviewTask` + H1 spec-fail block

Rewire the per-task fix-loop to call the single `reviewTask`, and make `specVerdict==='fail'` an unconditional block even when findings are empty/minor (H1).

**Files:**
- Modify: `workflow/ultrapowers-development.js` — the review section of `buildTask` (`:590-605`) and the pass-return.
- Create: `tests/engine/h1-spec-fail.test.mjs`

**Interfaces:**
- Consumes: `reviewTask` (Task 2), `blocking` (`:59`), `minorsOf` (`:60`).
- Produces: a task that returns `{ok:true,...}` only when `specVerdict!=='fail'` AND no critical|important findings; otherwise enters the fix-loop.

- [ ] **Step 1: Write the failing test**

`tests/engine/h1-spec-fail.test.mjs`:
```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runEngine, makeAgent } from './harness.mjs'

// Reviewer returns specVerdict:'fail' with EMPTY findings. H1: this must NOT pass.
test('specVerdict=fail with empty findings never marks the task ok (H1)', async () => {
  let reviewCount = 0
  const { agent } = makeAgent((p, o) => {
    const l = o.label || ''
    if (l === 'sp-version-check') return { installed: ['6.0.0'] }
    if (l.startsWith('capture-head:')) return { sha: 'a'.repeat(40) }
    if (l.startsWith('claude:')) return { status: 'done', files: ['src/x.js'], summary: 'did it' }
    if (l.startsWith('verify:')) return { code: 0, tail: 'ok' }
    if (l.startsWith('red-witness:')) return { applicable: false }
    if (l.startsWith('checkpoint:')) return {}
    if (l.startsWith('review-task:')) { reviewCount++; return { specVerdict: 'fail', findings: [], cannotVerify: [], strengths: [], assessment: 'spec not met' } }
    if (l === 'integration-review') return { approved: true, findings: [] }
    return undefined
  })
  const result = await runEngine({
    args: { tasks: [{ id: 't1', spec: 'do x' }], implementer: 'claude', verifyCmd: 'true', commit: true, maxRounds: 1 },
    agent, log: () => {},
  })
  assert.ok(!result.passed.includes('t1'), 't1 must not be in passed')
  assert.equal(result.ok, false, 'run must not be ok when a spec-fail shipped')
  assert.ok(reviewCount >= 1)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/engine/h1-spec-fail.test.mjs`
Expected: FAIL — current logic blocks only on severity findings, so an empty-findings `fail` passes and `t1` lands in `passed`.

- [ ] **Step 3: Write minimal implementation**

Replace the review block in `buildTask` (`:590-605`, the `// N1: spec review first ...` through the quality-review `return {ok:true...}`) with:
```js
    // v6 merged review: one pass returns spec verdict + dimensioned findings.
    const rev = await reviewTask(task, r, baseSha, diffFile)
    if (rev.unavailable) return { task: task.id, ok: false, reason: 'review-unavailable', needsHuman: true, by: r.by }
    // H1: specVerdict='fail' is an UNCONDITIONAL block, independent of finding severity.
    const specFail = rev.specVerdict === 'fail'
    const blk = blocking(rev)
    if (!specFail && !blk.length) {
      allMinors.push(...minorsOf(rev))
      const cv = (rev.cannotVerify || []).filter(Boolean)
      return { task: task.id, ok: true, by: r.by, rounds: i + 1,
        selfReviewed: r.by === 'claude-fallback' || r.by === 'claude' || r.by === 'claude-escalated',
        concerns: r.concerns || null, minors: allMinors.length ? allMinors : null,
        cannotVerify: cv.length ? cv : null }
    }
    // Blocking (spec-fail or severity finding). Thrash guard counts blocking findings; a bare
    // spec-fail with no findings still counts as 1 so the guard can make progress.
    const stuck = [...blk]
    const stuckCount = stuck.length || (specFail ? 1 : 0)
    stall = (stuckCount >= prevBlock) ? stall + 1 : 0
    prevBlock = stuckCount
    lastStuck = stuck.length ? fmtFindings(stuck) : ['spec verdict = fail (no specific finding returned — re-read the spec and implement the missing/correct behavior)']
    if (stall >= 2) {
      log(`${task.id}: NO PROGRESS — ${stuckCount} blocking finding(s) not shrinking; escalating instead of burning fix rounds`)
      return { task: task.id, ok: false, reason: 'no-progress', needsHuman: true, by: r.by, stuckFindings: lastStuck }
    }
    r = await implement(task, lastStuck, r)
    if (!DONE_OK.has(r.status)) return await blockOrFail(task, r)
```

Add `let diffFile = null` near the top of `buildTask` (just after `const baseSha = ...`, `:567`) so Task 7 can assign it; for now it stays null (reviewTask falls back to `git diff`).

Delete the now-dead spec/quality two-call scaffolding that remains in `:590-605` (the `const spec = await reviewSpec...`, `let qual...`, etc.).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run check` → `engine syntax ok`.
Run: `node --test tests/engine/h1-spec-fail.test.mjs tests/engine/review-merge.test.mjs` → PASS.

- [ ] **Step 5: Commit**

```bash
git add workflow/ultrapowers-development.js tests/engine/h1-spec-fail.test.mjs
git commit -m "feat: wire buildTask to merged reviewer; enforce spec-fail block in code (H1)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Accumulate `cannotVerify[]` and surface it in the result

Collect per-task `cannotVerify` items into a run-level accumulator and add it to the return object (observable output + test seam for H2/H3).

**Files:**
- Modify: `workflow/ultrapowers-development.js` — the run loop (`:760-777`) and the return object (`:820-845`).
- Create: `tests/engine/cannotverify-accumulate.test.mjs`

**Interfaces:**
- Consumes: per-task result `cannotVerify` field (Task 3).
- Produces: run-level `accCannotVerify: [{task, items:[string]}]`; return object gains `cannotVerify: accCannotVerify`.

- [ ] **Step 1: Write the failing test**

`tests/engine/cannotverify-accumulate.test.mjs`:
```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runEngine, makeAgent } from './harness.mjs'

test('cannot_verify items from passing tasks are accumulated into result.cannotVerify', async () => {
  const { agent } = makeAgent((p, o) => {
    const l = o.label || ''
    if (l === 'sp-version-check') return { installed: ['6.0.0'] }
    if (l.startsWith('capture-head:')) return { sha: 'a'.repeat(40) }
    if (l.startsWith('claude:')) return { status: 'done', files: ['src/x.js'], summary: 'ok' }
    if (l.startsWith('verify:')) return { code: 0, tail: 'ok' }
    if (l.startsWith('red-witness:')) return { applicable: false }
    if (l.startsWith('checkpoint:')) return {}
    if (l.startsWith('review-task:')) return { specVerdict: 'pass', findings: [], cannotVerify: ['REQ-9: persistence handled in unchanged db.js'], strengths: [], assessment: 'ok' }
    if (l === 'integration-review') return { approved: true, findings: [] }
    return undefined
  })
  const result = await runEngine({
    args: { tasks: [{ id: 't1', spec: 'do x' }], implementer: 'claude', verifyCmd: 'true', commit: true },
    agent, log: () => {},
  })
  assert.deepEqual(result.cannotVerify, [{ task: 't1', items: ['REQ-9: persistence handled in unchanged db.js'] }])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/engine/cannotverify-accumulate.test.mjs`
Expected: FAIL — `result.cannotVerify` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

Near the run-state declarations (`:749-750`) add:
```js
const accCannotVerify = []   // [{task, items}] — ⚠️ items from passing tasks, resolved at integration (H3)
```
In the worklist loop, right after `results.push(res)` (`:775`):
```js
    if (res.ok && res.cannotVerify && res.cannotVerify.length) accCannotVerify.push({ task: res.task, items: res.cannotVerify })
```
In the return object (`:820-845`) add the field:
```js
  cannotVerify: accCannotVerify,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run check` → ok. Run: `node --test tests/engine/cannotverify-accumulate.test.mjs` → PASS.

- [ ] **Step 5: Commit**

```bash
git add workflow/ultrapowers-development.js tests/engine/cannotverify-accumulate.test.mjs
git commit -m "feat: accumulate cannot_verify items into the run result

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: H2 — persist `cannotVerify` across crash-resume

`checkpoint()` must persist each passing task's `cannotVerify`; resume must rebuild the accumulator so the integration review still sees ⚠️ items after a crash.

**Files:**
- Modify: `workflow/ultrapowers-development.js` — `loadDone` (`:658-664`), `checkpoint` (`:665-672`), and the resume path in the loop (`:763`).
- Create: `tests/engine/h2-resume-cannotverify.test.mjs`

**Interfaces:**
- Consumes: `logFile` arg, `accCannotVerify` (Task 4).
- Produces: `loadResume(logFile) → {done:Set, cannotVerify:[{task,items}]}` rebuilt from JSONL lines `{id, ok, cannotVerify?}`.

- [ ] **Step 1: Write the failing test**

`tests/engine/h2-resume-cannotverify.test.mjs`:
```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runEngine, makeAgent } from './harness.mjs'

// Seed a resume log where t1 already passed AND emitted a cannot_verify item; the run resumes
// (skips t1) but must rebuild t1's cannot_verify into the accumulator so integration sees it.
test('resume rebuilds cannot_verify from the checkpoint log (H2)', async () => {
  const seeded = [
    JSON.stringify({ id: 't1', ok: true, by: 'claude', cannotVerify: ['REQ-9 in unchanged db.js'] }),
  ].join('\n')
  const { agent } = makeAgent((p, o) => {
    const l = o.label || ''
    if (l === 'sp-version-check') return { installed: ['6.0.0'] }
    if (l === 'resume-load') return { __seed: seeded } // harness convention below
    if (l.startsWith('capture-head:')) return { sha: 'a'.repeat(40) }
    if (l.startsWith('claude:')) return { status: 'done', files: ['src/y.js'], summary: 'ok' }
    if (l.startsWith('verify:')) return { code: 0, tail: 'ok' }
    if (l.startsWith('red-witness:')) return { applicable: false }
    if (l.startsWith('checkpoint:')) return {}
    if (l.startsWith('review-task:')) return { specVerdict: 'pass', findings: [], cannotVerify: [], strengths: [], assessment: 'ok' }
    if (l === 'integration-review') return { approved: true, findings: [] }
    return undefined
  })
  const result = await runEngine({
    args: { tasks: [{ id: 't1', spec: 'x' }, { id: 't2', spec: 'y' }], implementer: 'claude', verifyCmd: 'true', commit: true, logFile: '/tmp/up-test.jsonl' },
    agent, log: () => {},
  })
  assert.ok(result.cannotVerify.some(c => c.task === 't1' && c.items[0].includes('REQ-9')),
    'resumed t1 cannot_verify must be rebuilt')
})
```

The `resume-load` agent in the engine reads the real `logFile`; in the harness the responder returns the parsed `done`/`cannotVerify`. Implement `loadResume` to call the agent and accept the v6 schema; the test scripts that agent's return directly (see Step 3 — change the schema so the responder returns `{done, cannotVerify}`).

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/engine/h2-resume-cannotverify.test.mjs`
Expected: FAIL — current `loadDone` returns only ids; `result.cannotVerify` lacks the resumed t1 item.

- [ ] **Step 3: Write minimal implementation**

Replace `loadDone` (`:658-664`) with:
```js
// Crash-resume: read {id, ok, by, cannotVerify?} lines. Rebuild done-ids AND the ⚠️ accumulator (H2).
const RESUME = { type: 'object', required: ['done'], properties: {
  done: { type: 'array', items: { type: 'string' } },
  cannotVerify: { type: 'array', items: { type: 'object', required: ['task', 'items'], properties: {
    task: { type: 'string' }, items: { type: 'array', items: { type: 'string' } } } } } } }
async function loadResume() {
  if (!logFile) return { done: new Set(), cannotVerify: [] }
  const r = await agent(
    `Read ${logFile} if it exists (JSONL, one {"id","ok","cannotVerify"?} per line). Return ` +
    `{done:[ids where ok===true], cannotVerify:[{task:id, items:[the cannotVerify strings]} for each ok line whose cannotVerify is non-empty]}. Missing file => {done:[], cannotVerify:[]}.`,
    { label: 'resume-load', phase: 'Preflight', model: 'haiku', schema: RESUME })
  return { done: new Set((r && r.done) || []), cannotVerify: (r && r.cannotVerify) || [] }
}
```
Replace `checkpoint` (`:665-672`) JSON line to include `cannotVerify`:
```js
    `${JSON.stringify({ id: res.task, ok: res.ok, by: res.by || null, reason: res.reason || null, cannotVerify: res.cannotVerify || [] })}\n` +
```
At the resume call site (`:747`) replace `const alreadyDone = await loadDone()` with:
```js
const resume = await loadResume()
const alreadyDone = resume.done
resume.cannotVerify.forEach(c => { if (c && c.items && c.items.length) accCannotVerify.push(c) })
```
(Move the `const accCannotVerify = []` declaration above this line if needed.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run check` → ok. Run: `node --test tests/engine/h2-resume-cannotverify.test.mjs` → PASS.

- [ ] **Step 5: Commit**

```bash
git add workflow/ultrapowers-development.js tests/engine/h2-resume-cannotverify.test.mjs
git commit -m "fix: persist and rebuild cannot_verify across crash-resume (H2)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: H3 — fail-closed ⚠️ gate + integration checklist

The integration review must receive the accumulated ⚠️ checklist, and a non-empty `cannotVerify` with anything other than an explicit integration approval must force `ok:false` + `needsHuman`.

**Files:**
- Modify: `workflow/ultrapowers-development.js` — integration review prompt (`:796-811`), the `ok` computation (`:816-818`), and the `needsHuman`/`failed` return fields (`:829-830`).
- Create: `tests/engine/h3-cannotverify-gate.test.mjs`

**Interfaces:**
- Consumes: `accCannotVerify` (Task 4), `integration` review result.
- Produces: `ok` is false and a `{task:'cross-task', reason:'unverified-cross-task'}` entry appears in `needsHuman` when `accCannotVerify.length` and `integration.approved !== true`.

- [ ] **Step 1: Write the failing test**

`tests/engine/h3-cannotverify-gate.test.mjs`:
```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runEngine, makeAgent } from './harness.mjs'

function resp(integrationApproved) {
  return (p, o) => {
    const l = o.label || ''
    if (l === 'sp-version-check') return { installed: ['6.0.0'] }
    if (l.startsWith('capture-head:')) return { sha: 'a'.repeat(40) }
    if (l.startsWith('claude:')) return { status: 'done', files: ['src/x.js'], summary: 'ok' }
    if (l.startsWith('verify:')) return { code: 0, tail: 'ok' }
    if (l.startsWith('red-witness:')) return { applicable: false }
    if (l.startsWith('checkpoint:')) return {}
    if (l.startsWith('review-task:')) return { specVerdict: 'pass', findings: [], cannotVerify: ['REQ-9 outside diff'], strengths: [], assessment: 'ok' }
    if (l === 'integration-review') return integrationApproved === null ? undefined : { approved: integrationApproved, findings: [] }
    return undefined
  }
}

test('non-empty cannot_verify without explicit integration approval forces needsHuman (H3)', async () => {
  const { agent } = makeAgent(resp(false))
  const result = await runEngine({
    args: { tasks: [{ id: 't1', spec: 'x' }], implementer: 'claude', verifyCmd: 'true', commit: true },
    agent, log: () => {},
  })
  assert.equal(result.ok, false)
  assert.ok(result.needsHuman.includes('cross-task'), 'unverified cross-task escalates to human')
})

test('cannot_verify WITH explicit integration approval is allowed', async () => {
  const { agent } = makeAgent(resp(true))
  const result = await runEngine({
    args: { tasks: [{ id: 't1', spec: 'x' }], implementer: 'claude', verifyCmd: 'true', commit: true },
    agent, log: () => {},
  })
  assert.equal(result.ok, true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/engine/h3-cannotverify-gate.test.mjs`
Expected: FAIL — current `ok` treats `approved:false` as a block (first test may pass) but does not escalate `cross-task` to `needsHuman`, and would let a null integration pass.

- [ ] **Step 3: Write minimal implementation**

In the integration review prompt (`:800-810`), inject the checklist after the `GOAL` line:
```js
    (accCannotVerify.length ? `\n\nRESOLVE THESE cross-task / unchanged-code requirements the per-task reviewers could NOT verify from their scoped diffs. For EACH, confirm it is actually satisfied in the whole tree; if any is a real gap, set approved:false with a critical finding:\n${accCannotVerify.flatMap(c => c.items.map(it => `- [${c.task}] ${it}`)).join('\n')}\n` : '') +
```
Replace the `ok` computation (`:816-818`) with:
```js
// H3: a non-empty cannotVerify must be explicitly cleared by the integration review; anything
// short of integration.approved===true (including a null/errored integration) is fail-closed.
const cvUnresolved = accCannotVerify.length > 0 && (!integration || integration.approved !== true)
const ok = failedList.length === 0 && needsHumanList.length === 0 &&
           (!integration || integration.approved !== false) &&
           !cvUnresolved && !stopReason && !roundCapped && !degraded
```
In the return object, extend `needsHuman` (`:830`) to include the cross-task escalation:
```js
  needsHuman:   [...done.filter(x => x.needsHuman).map(x => x.task), ...(cvUnresolved ? ['cross-task'] : [])],
```
and add to `failed` (`:829`) when `cvUnresolved`:
```js
  failed:       [...done.filter(x => !x.ok).map(x => ({ task: x.task, reason: x.reason, needsHuman: x.needsHuman || false, ...(x.stuckFindings ? { stuckFindings: x.stuckFindings } : {}) })), ...(cvUnresolved ? [{ task: 'cross-task', reason: 'unverified-cross-task', needsHuman: true }] : [])],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run check` → ok. Run: `node --test tests/engine/h3-cannotverify-gate.test.mjs` → PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add workflow/ultrapowers-development.js tests/engine/h3-cannotverify-gate.test.mjs
git commit -m "fix: fail-closed gate for unresolved cannot_verify items (H3)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: `reviewPackage` diff-file handoff

A cheap haiku helper writes this task's scoped diff to a file and returns the path; `reviewTask` is handed the path.

**Files:**
- Modify: `workflow/ultrapowers-development.js` — add `reviewPackage`; assign `diffFile` in `buildTask` before the review call.
- Create: `tests/engine/reviewpackage.test.mjs`

**Interfaces:**
- Consumes: `GIT`, `baseSha`, `repoDir`.
- Produces: `async reviewPackage(task, baseSha) → string|null` (the diff-file path).

- [ ] **Step 1: Write the failing test**

`tests/engine/reviewpackage.test.mjs`:
```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runEngine, makeAgent } from './harness.mjs'

test('a review-package agent runs before the reviewer and is scoped BASE..HEAD', async () => {
  let pkgPrompt = null
  const { agent, calls } = makeAgent((p, o) => {
    const l = o.label || ''
    if (l === 'sp-version-check') return { installed: ['6.0.0'] }
    if (l.startsWith('capture-head:')) return { sha: 'b'.repeat(40) }
    if (l.startsWith('claude:')) return { status: 'done', files: ['src/x.js'], summary: 'ok' }
    if (l.startsWith('verify:')) return { code: 0, tail: 'ok' }
    if (l.startsWith('red-witness:')) return { applicable: false }
    if (l.startsWith('checkpoint:')) return {}
    if (l.startsWith('review-package:')) { pkgPrompt = p; return { path: '/tmp/up.diff' } }
    if (l.startsWith('review-task:')) return { specVerdict: 'pass', findings: [], cannotVerify: [], strengths: [], assessment: 'ok' }
    if (l === 'integration-review') return { approved: true, findings: [] }
    return undefined
  })
  await runEngine({
    args: { tasks: [{ id: 't1', spec: 'x' }], implementer: 'claude', verifyCmd: 'true', commit: true },
    agent, log: () => {},
  })
  const labels = calls.map(c => c.label)
  const pkgIdx = labels.findIndex(l => l && l.startsWith('review-package:'))
  const revIdx = labels.findIndex(l => l && l.startsWith('review-task:'))
  assert.ok(pkgIdx >= 0 && pkgIdx < revIdx, 'package must run before the reviewer')
  assert.match(pkgPrompt, /diff -U10/)
  assert.match(pkgPrompt, /\.\.HEAD/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/engine/reviewpackage.test.mjs`
Expected: FAIL — no `review-package:` agent is dispatched.

- [ ] **Step 3: Write minimal implementation**

Add near `captureHead` (`:516-521`):
```js
// v6 review-package: write this task's SCOPED diff to a file so the reviewer reads it once and
// stays read-only. Uses the recorded BASE (not HEAD~1) so multi-commit tasks stay intact.
const PKG = { type: 'object', required: ['path'], properties: { path: { type: 'string' }, detail: { type: 'string' } } }
async function reviewPackage(task, baseSha) {
  if (!baseSha) return null
  const dir = repoDir ? `${repoDir}/.git/sdd` : '.git/sdd'
  const p = await agent(
    `Write this task's review package to a file with Bash, then return its path.` + REPO_NOTE + `\n` +
    `STEP 1: \`mkdir -p ${dir}\`.\n` +
    `STEP 2: set OUT="${dir}/review-${task.id}.diff" and write into it, in order: the commit list (\`${GIT} log --oneline ${baseSha}..HEAD\`), a stat summary (\`${GIT} diff --stat ${baseSha}..HEAD\`), then the full diff (\`${GIT} diff -U10 ${baseSha}..HEAD\`). Do NOT modify any tracked file.\n` +
    `Return {path:"<OUT>"}.`,
    { label: `review-package:${task.id}`, phase: `task:${task.id}`, model: 'haiku', schema: PKG })
  return (p && p.path) || null
}
```
In `buildTask`, set `diffFile` before each review (inside the fix-loop, right before `const rev = await reviewTask(...)`):
```js
    diffFile = await reviewPackage(task, baseSha)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run check` → ok. Run: `node --test tests/engine/` → all PASS.

- [ ] **Step 5: Commit**

```bash
git add workflow/ultrapowers-development.js tests/engine/reviewpackage.test.mjs
git commit -m "feat: review-package diff-file handoff (BASE..HEAD) for the reviewer

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Implementer TDD-evidence + cadence + after-review

Add the test-cadence line and the mandatory TDD-evidence block to the implementer brief; extend the `IMPL` schema.

**Files:**
- Modify: `workflow/ultrapowers-development.js` — `IMPL` schema (`:28-30`); the brief assembly in `implement` (`:294-303`).
- Create: `tests/engine/impl-tddevidence.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `IMPL` accepts optional `tddEvidence:{red,green}`; the implementer brief contains the cadence + evidence instructions.

- [ ] **Step 1: Write the failing test**

`tests/engine/impl-tddevidence.test.mjs`:
```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runEngine, makeAgent } from './harness.mjs'

test('implementer brief requires TDD evidence and test cadence', async () => {
  let implPrompt = null
  const { agent } = makeAgent((p, o) => {
    const l = o.label || ''
    if (l === 'sp-version-check') return { installed: ['6.0.0'] }
    if (l.startsWith('capture-head:')) return { sha: 'a'.repeat(40) }
    if (l.startsWith('claude:')) { implPrompt = p; return { status: 'done', files: ['src/x.js'], summary: 'ok', tddEvidence: { red: 'node --test -> FAIL', green: 'node --test -> PASS' } } }
    if (l.startsWith('verify:')) return { code: 0, tail: 'ok' }
    if (l.startsWith('red-witness:')) return { applicable: false }
    if (l.startsWith('checkpoint:')) return {}
    if (l.startsWith('review-package:')) return { path: '/tmp/x.diff' }
    if (l.startsWith('review-task:')) return { specVerdict: 'pass', findings: [], cannotVerify: [], strengths: [], assessment: 'ok' }
    if (l === 'integration-review') return { approved: true, findings: [] }
    return undefined
  })
  const result = await runEngine({
    args: { tasks: [{ id: 't1', spec: 'x' }], implementer: 'claude', verifyCmd: 'true', commit: true },
    agent, log: () => {},
  })
  assert.match(implPrompt, /full suite once before committing/)
  assert.match(implPrompt, /tddEvidence/)
  assert.deepEqual(result.passed, ['t1'])  // tddEvidence accepted by IMPL schema, did not reject
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/engine/impl-tddevidence.test.mjs`
Expected: FAIL — the brief lacks the cadence/`tddEvidence` text.

- [ ] **Step 3: Write minimal implementation**

Extend `IMPL` (`:28-30`) properties with:
```js
  tddEvidence: { type: 'object', properties: { red: { type: 'string' }, green: { type: 'string' } } },
```
In the `brief` assembly (`:294-303`), before the `## Report` line add:
```js
    `\n## Test cadence\nWhile iterating, run the focused test for what you're changing; run the full suite once before committing, not after every edit.\n` +
```
and extend the Report instruction to require evidence:
```js
    `\n\n## Report\nReturn {status, files:[paths changed], summary, concerns?, tddEvidence:{red,green}}.\n` +
    `tddEvidence (REQUIRED when TDD applies): red = the command you ran + the relevant failing output BEFORE the implementation and why that failure was expected; green = the command + relevant passing output after.\n` +
```
(Replace the existing `## Report` block; keep the existing status-values lines that follow.) In fix-loop briefs, the `issues` path already threads findings; append to the prior-rejection context (`:291`): `' After fixing, re-run the tests covering the amended code and include the results in tddEvidence.green.'`

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run check` → ok. Run: `node --test tests/engine/impl-tddevidence.test.mjs` → PASS.

- [ ] **Step 5: Commit**

```bash
git add workflow/ultrapowers-development.js tests/engine/impl-tddevidence.test.mjs
git commit -m "feat: implementer TDD-evidence + test cadence + after-review re-run

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Durable-progress ledger

Alongside the JSONL checkpoint, append a human-readable line to `.git/sdd/progress.md` on a clean pass.

**Files:**
- Modify: `workflow/ultrapowers-development.js` — `checkpoint` (`:665-672`).
- Create: `tests/engine/progress-ledger.test.mjs`

**Interfaces:**
- Consumes: `repoDir`, `GIT`, per-task `base`/`head` shas (use `res.base`/`res.head` if present, else omit).
- Produces: a `progress.md` append in the checkpoint agent's instructions for `ok` tasks.

- [ ] **Step 1: Write the failing test**

`tests/engine/progress-ledger.test.mjs`:
```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runEngine, makeAgent } from './harness.mjs'

test('checkpoint instructs a progress.md ledger append for a clean task', async () => {
  let ckptPrompt = null
  const { agent } = makeAgent((p, o) => {
    const l = o.label || ''
    if (l === 'sp-version-check') return { installed: ['6.0.0'] }
    if (l.startsWith('capture-head:')) return { sha: 'a'.repeat(40) }
    if (l.startsWith('claude:')) return { status: 'done', files: ['src/x.js'], summary: 'ok' }
    if (l.startsWith('verify:')) return { code: 0, tail: 'ok' }
    if (l.startsWith('red-witness:')) return { applicable: false }
    if (l.startsWith('review-package:')) return { path: '/tmp/x.diff' }
    if (l.startsWith('review-task:')) return { specVerdict: 'pass', findings: [], cannotVerify: [], strengths: [], assessment: 'ok' }
    if (l.startsWith('checkpoint:')) { ckptPrompt = p; return {} }
    if (l === 'integration-review') return { approved: true, findings: [] }
    return undefined
  })
  await runEngine({
    args: { tasks: [{ id: 't1', spec: 'x' }], implementer: 'claude', verifyCmd: 'true', commit: true, logFile: '/tmp/up.jsonl' },
    agent, log: () => {},
  })
  assert.match(ckptPrompt, /progress\.md/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/engine/progress-ledger.test.mjs`
Expected: FAIL — checkpoint prompt has no `progress.md`.

- [ ] **Step 3: Write minimal implementation**

In `checkpoint` (`:665-672`), extend the agent instruction (append after the JSONL `printf`):
```js
    (res.ok ? `\nAlso append a human-readable ledger line to ${repoDir ? `${repoDir}/.git/sdd` : '.git/sdd'}/progress.md (create the dir/file if needed): \`Task ${res.task}: complete (review clean)\`.` : '') +
```
(Keep the JSONL append as the functional source of truth; the ledger is additive.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run check` → ok. Run: `node --test tests/engine/progress-ledger.test.mjs` → PASS.

- [ ] **Step 5: Commit**

```bash
git add workflow/ultrapowers-development.js tests/engine/progress-ledger.test.mjs
git commit -m "feat: durable-progress ledger alongside the JSONL checkpoint

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: Pin re-sync → 6.0.0

Bump `SP_VERSION`, re-point the re-sync header comment to the v6 file paths. Embedded `TDD_SKILL`/`SDD_GUIDANCE` bodies are byte-identical to v6 → no body change.

**Files:**
- Modify: `workflow/ultrapowers-development.js` — `SP_VERSION` (`:88`) and the header comment (`:82-88`).
- Create: `tests/engine/pin.test.mjs`

**Interfaces:**
- Produces: `checkSpDrift()` reports no drift against an installed `6.0.0`.

- [ ] **Step 1: Write the failing test**

`tests/engine/pin.test.mjs`:
```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { runEngine, makeAgent } from './harness.mjs'

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../workflow/ultrapowers-development.js'), 'utf8')

test('SP_VERSION is pinned to 6.0.0', () => {
  assert.match(SRC, /const SP_VERSION = '6\.0\.0'/)
})

test('no drift logged when installed superpowers is 6.0.0', async () => {
  const logs = []
  await runEngine({
    args: {},  // empty args returns early but checkSpDrift is not reached; use a 1-task run instead
    agent: async () => null, log: m => logs.push(m),
  })
  // Drift is checked on the build path; assert via a tasks run:
  const { agent } = makeAgent((p, o) => {
    const l = o.label || ''
    if (l === 'sp-version-check') return { installed: ['6.0.0'] }
    if (l.startsWith('capture-head:')) return { sha: 'a'.repeat(40) }
    if (l.startsWith('claude:')) return { status: 'done', files: [], summary: 'ok' }
    if (l.startsWith('verify:')) return { code: 0, tail: 'ok' }
    if (l.startsWith('red-witness:')) return { applicable: false }
    if (l.startsWith('review-package:')) return { path: '/tmp/x.diff' }
    if (l.startsWith('review-task:')) return { specVerdict: 'pass', findings: [], cannotVerify: [], strengths: [], assessment: 'ok' }
    if (l.startsWith('checkpoint:')) return {}
    if (l === 'integration-review') return { approved: true, findings: [] }
    return undefined
  })
  const driftLogs = []
  await runEngine({ args: { tasks: [{ id: 't1', spec: 'x' }], implementer: 'claude', verifyCmd: 'true', commit: true }, agent, log: m => driftLogs.push(m) })
  assert.ok(!driftLogs.some(m => /SP DRIFT/.test(m)), 'no drift expected at 6.0.0')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/engine/pin.test.mjs`
Expected: FAIL — `SP_VERSION` is still `'5.1.0'`, so the first assertion fails and the drift test logs `SP DRIFT`.

- [ ] **Step 3: Write minimal implementation**

Change `:88`:
```js
const SP_VERSION = '6.0.0'
```
Update the header comment (`:82-88`) re-sync pointer:
```js
//   ~/.claude/plugins/cache/claude-plugins-official/superpowers/<new>/skills/{test-driven-development,subagent-driven-development}/
// v6 reviewer source: subagent-driven-development/task-reviewer-prompt.md (merged spec+quality);
// final review: requesting-code-review/code-reviewer.md. TDD + implementer Code-Org bodies are
// byte-identical 5.1.0->6.0.0 (only an @import->link change in TDD's anti-patterns reference).
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run check` → ok. Run: `node --test tests/engine/` → all PASS.

- [ ] **Step 5: Commit**

```bash
git add workflow/ultrapowers-development.js tests/engine/pin.test.mjs
git commit -m "chore: re-sync embedded-prompt pin to superpowers 6.0.0

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 11: Benchmark — B-v5 vs B-v6 happy-path A/B wiring

Add a v5/v6 arm pair to the bench so the cost/dispatch delta is measurable. B-v5 runs the pre-upgrade engine via `scriptPath` at the pre-upgrade git ref; B-v6 runs the new engine. No dead v5 code ships.

**Files:**
- Modify: `bench/run.sh` — add `B-v5` and `B-v6` arms (mirror the existing `B-parity` arm at `bench/README.md:209-224`); resolve the v5 engine by `git show <PRE_UPGRADE_SHA>:workflow/ultrapowers-development.js` into a temp path.
- Modify: `bench/README.md` — document the v5/v6 pair under a new subsection.

**Interfaces:**
- Consumes: existing `provision()`, `meter()`, `tasks.json`, fixture template.
- Produces: per-run records tagged `B-v5` / `B-v6` with `total_cost_usd`, `modelUsage`, `agentCount`, and a derived `reviewDispatches` (count of `review-task:`/`review-spec:`/`review-quality:` subagent labels in the transcript).

- [ ] **Step 1: Write the failing test (a dry-run assertion)**

Add `bench/tests/arms.test.sh` (bash):
```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
grep -q 'B-v5' "$ROOT/bench/run.sh" || { echo "FAIL: no B-v5 arm"; exit 1; }
grep -q 'B-v6' "$ROOT/bench/run.sh" || { echo "FAIL: no B-v6 arm"; exit 1; }
grep -q 'git show' "$ROOT/bench/run.sh" || { echo "FAIL: B-v5 must resolve the engine from a git ref"; exit 1; }
echo "arms ok"
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash bench/tests/arms.test.sh` → Expected: `FAIL: no B-v5 arm`.

- [ ] **Step 3: Implement**

In `bench/run.sh`, define `PRE_UPGRADE_SHA` (the commit before Task 2; record it in the script header), materialize the v5 engine:
```bash
V5_ENGINE="$(mktemp -d)/ultrapowers-development.v5.js"
git -C "$ROOT" show "${PRE_UPGRADE_SHA}:workflow/ultrapowers-development.js" > "$V5_ENGINE"
```
Add two arms mirroring `B-parity`, differing only in the `scriptPath` (`$V5_ENGINE` vs `$ROOT/workflow/ultrapowers-development.js`), both with `redWitness:false`, `tasks:<tasks.json>`, `implementer:'claude'`, `implModel:'sonnet'`, `commit:true`. After metering, derive `reviewDispatches` from the transcript:
```bash
jq -s '[.[]|select(.type=="assistant")|.message]|map(select(.. | strings? | test("review-(task|spec|quality):")))|length' transcript.jsonl
```
Document the pair in `bench/README.md` under a `### B-v5 vs B-v6 (merge A/B)` subsection: primary = `reviewDispatches`/task + `total_cost_usd`; guard = quality parity via the existing judge; N≥5; report the raw table + bootstrap CI.

- [ ] **Step 4: Run to verify it passes**

Run: `bash bench/tests/arms.test.sh` → `arms ok`.
Run: `bash -n bench/run.sh` → no syntax error.

- [ ] **Step 5: Commit**

```bash
git add bench/run.sh bench/README.md bench/tests/arms.test.sh
git commit -m "bench: B-v5 vs B-v6 merge A/B arms

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 12: Benchmark — safety-path fixture (H4)

A second fixture that exercises the new risky paths. Run B-v6-only with pass/fail assertions (these paths don't exist in B-v5), not a cost comparison.

**Files:**
- Create: `bench/fixtures/safety-tasks.json` — three coupled tasks (see below).
- Create: `bench/safety-run.sh` — provisions a repo, runs B-v6, asserts the safety outcomes.
- Create: `bench/tasks/cross-task-coupled.md`, `bench/tasks/multi-commit.md`, `bench/tasks/spec-incomplete.md` (human-readable mirrors).
- Modify: `bench/README.md` — document the safety-path fixture under §8.2.

**Interfaces:**
- Consumes: the upgraded engine; `node --test` verify.
- Produces: assertions that (a) a cross-task requirement yields a `cannotVerify` entry in `result.cannotVerify`; (b) a spec-incomplete task is blocked (`specVerdict='fail'` path → not in `passed`); (c) the integration review receives the ⚠️ checklist; (d) on a simulated resume the ⚠️ item is rebuilt (reuse the H2 path with a real `logFile`).

- [ ] **Step 1: Write the failing assertion script**

`bench/safety-run.sh` (skeleton — fill the run invocation to match `bench/run.sh`'s B-v6 arm):
```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TASKS="$ROOT/bench/fixtures/safety-tasks.json"
[ -f "$TASKS" ] || { echo "FAIL: missing $TASKS"; exit 1; }
# After running the B-v6 arm on $TASKS into $OUT/result.json:
RESULT="$OUT/result.json"
jq -e '.cannotVerify | length > 0' "$RESULT" >/dev/null || { echo "FAIL: no cannot_verify produced by the coupled task"; exit 1; }
jq -e '(.passed | index("spec-incomplete")) == null' "$RESULT" >/dev/null || { echo "FAIL: spec-incomplete task wrongly passed"; exit 1; }
echo "safety-path ok"
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash bench/safety-run.sh` → Expected: `FAIL: missing .../safety-tasks.json`.

- [ ] **Step 3: Implement the fixture**

`bench/fixtures/safety-tasks.json`:
```json
[
  { "id": "config-module", "spec": "Create src/config.js exporting `getLimit()` returning the number 100. Add test/config.test.js asserting getLimit()===100. Red: test fails (no module). Green: test passes." },
  { "id": "cross-task-coupled", "spec": "Create src/throttle.js exporting `throttle(n)` that returns true when n <= the limit from src/config.js's getLimit(). Import getLimit from ./config.js. Add test/throttle.test.js asserting throttle(100)===true and throttle(101)===false. NOTE: the limit value itself is owned by config-module (unchanged here) — the reviewer cannot verify the limit from this diff alone." },
  { "id": "spec-incomplete", "spec": "Create src/greet.js exporting `greet(name)` returning `Hello, <name>!` AND `greetFormal(name)` returning `Good day, <name>.`. Add test/greet.test.js covering BOTH. (This task is intentionally used to exercise a spec-fail path when an implementer omits greetFormal.)" }
]
```
Wire `bench/safety-run.sh` to provision a fresh fixture repo, run the B-v6 arm on `safety-tasks.json` (mirror `bench/run.sh`'s B-v6 invocation, writing the Workflow result to `$OUT/result.json`), then run the assertions in Step 1. Add the three `.md` mirrors. Document in `bench/README.md` §8.2 that this fixture is B-v6-only, asserts pass/fail (not cost), and covers the ⚠️ route, the multi-commit BASE..HEAD path (config-module + cross-task-coupled span commits), and the spec-fail block.

- [ ] **Step 4: Run to verify it passes**

Run: `bash -n bench/safety-run.sh` → no syntax error.
Run: `bash bench/safety-run.sh` (after wiring the run) → `safety-path ok` (requires the live `claude` CLI + Workflow; if running offline, assert the fixture + script shape only and note it).

- [ ] **Step 5: Commit**

```bash
git add bench/fixtures/safety-tasks.json bench/safety-run.sh bench/tasks/cross-task-coupled.md bench/tasks/multi-commit.md bench/tasks/spec-incomplete.md bench/README.md
git commit -m "bench: safety-path fixture exercising cannot_verify + spec-fail + multi-commit (H4)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final integration check (after Task 12)

- [ ] Run the full engine suite: `npm run check && node --test tests/engine/` → all PASS.
- [ ] Re-witness the existing seed still works: `npm run test:rewitness` (smoke).
- [ ] Confirm no stray `review-spec:`/`review-quality:` labels remain: `grep -n "review-spec\|review-quality\|reviewSpec\|reviewQuality" workflow/ultrapowers-development.js` → no matches.
- [ ] Confirm one export only: `grep -c "^export " workflow/ultrapowers-development.js` → `1`.
- [ ] Dispatch a final adversarial fresh-eye review of the integrated diff before merge (per subagent-driven-development).

## Self-review notes (plan author)

- **Spec coverage:** §5.1 reviewer merge → T2/T3; §5.2 control flow + H1 → T3; §5.3 + H3 → T6; §5.4 review-package → T7; §5.5 implementer → T8; §5.6 ledger → T9; §5.7 pin → T10; §6 H1→T3, H2→T5, H3→T6, H4→T11+T12; §8.1 → T11; §8.2 → T12. All spec sections map to a task.
- **Testability:** every engine behavior is observable through the scenario harness via the result object or recorded `calls`; no test asserts on un-observable internals.
- **Type consistency:** `TASK_REVIEW.specVerdict` ∈ {pass,fail,cannot_verify}; `reviewTask` returns it; `buildTask` reads `rev.specVerdict`/`rev.findings`/`rev.cannotVerify`; result field `cannotVerify` is `[{task,items}]` throughout (T4/T5/T6).
- **Known limitation:** T11/T12 bench scripts need the live `claude` CLI + Workflow to fully execute; their TDD steps assert script/fixture shape offline and the full run is a manual/CI step (documented in each task).
