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
  // A wrapper config can be gitignored/local-only in the main checkout and absent from a fresh
  // worktree — scout reads the worktree, so it must ALSO inspect the main checkout to detect it.
  assert.match(scoutPrompt, /common-dir|main checkout/i, 'scout must inspect the main checkout for a gitignored/local wrapper config a fresh worktree would not inherit')
})

// Task 3: scout's fullVerifyCmd must drive the INTEGRATION final gate (the comprehensive suite),
// distinct from the fast per-task verifyCmd. Witnesses RED: before this task FULL_VERIFY_CMD stays
// null, so finalGate = verifyCmd ('cargo test -p foo') and the integration prompt lacks '--all'.
test('scout fullVerifyCmd drives the integration final gate (distinct from per-task verifyCmd)', async () => {
  let integPrompt = null
  const { agent } = makeAgent((p, o) => {
    const l = o.label || ''
    if (l === 'sp-version-check') return { installed: ['6.0.0'] }
    if (l === 'scout') return { verifyCmd: 'cargo test -p foo', fullVerifyCmd: 'cargo test --all', cacheType: 'none', cacheWrapper: null, cacheDirs: [], allowlistPaths: [] }
    if (l === 'scout-witness') return { applicable: true, redWitnessed: true, detail: 'broke prod, suite failed (good)' }
    if (l === 'scout-witness-clean') return { clean: true, detail: '' }   // F2: tree restored clean after the seed-break
    if (l === 'plan') return { tasks: [{ id: 't1', spec: 'x' }] }
    if (l.startsWith('capture-head:')) return { sha: 'a'.repeat(40) }
    if (l.startsWith('claude:')) return { status: 'done', files: [], summary: 'ok' }
    if (l.startsWith('verify:')) return { code: 0, tail: '' }
    if (l.startsWith('red-witness:')) return { applicable: false }
    if (l.startsWith('review-package:')) return { path: '/tmp/d' }
    if (l.startsWith('review-task:')) return { specVerdict: 'pass', findings: [], cannotVerify: [], strengths: [], assessment: 'ok' }
    if (l.startsWith('checkpoint:')) return {}
    if (l === 'integration-review') { integPrompt = p; return { approved: true, findings: [] } }
    return undefined
  })
  await runEngine({ args: { goal: 'g', implementer: 'claude', commit: true }, agent, log: () => {} })
  assert.ok(integPrompt, 'integration review must be dispatched (a task passed)')
  assert.match(integPrompt, /cargo test --all/, 'integration final gate must run scout.fullVerifyCmd, not the fast per-task verifyCmd')
})

// Regression guards (GREEN from the start — they guard backward-compat + the no-gate fallback;
// they are not expected to witness RED, unlike the primary test above).
test('caller verifyCmd wins (scout skipped); null discovery falls back to LLM-only (no gate)', async () => {
  // (a) caller override → scout must NOT run
  let scoutRan = false
  const a = makeAgent((p, o) => {
    if (o.label === 'sp-version-check') return { installed: ['6.0.0'] }
    if (o.label === 'scout') { scoutRan = true; return { cacheType: 'none' } }
    if (o.label === 'plan') return { tasks: [] }
    return undefined
  })
  await runEngine({ args: { goal: 'g', verifyCmd: 'make test' }, agent: a.agent, log: () => {} })
  assert.equal(scoutRan, false, 'caller verifyCmd must skip scout entirely')

  // (b) scout finds nothing → no deterministic gate; verify() never dispatches
  let verifyDispatched = false
  const b = makeAgent((p, o) => {
    const l = o.label || ''
    if (l === 'sp-version-check') return { installed: ['6.0.0'] }
    if (l === 'scout') return { verifyCmd: null, cacheType: 'none', cacheDirs: [], allowlistPaths: [] }
    if (l === 'plan') return { tasks: [{ id: 't1', spec: 'x' }] }
    if (l.startsWith('capture-head:')) return { sha: 'a'.repeat(40) }
    if (l.startsWith('claude:')) return { status: 'done', files: [], summary: 'ok' }
    if (l.startsWith('verify:')) { verifyDispatched = true; return { code: 0, tail: '' } }
    if (l.startsWith('red-witness:')) return { applicable: false }
    if (l.startsWith('review-package:')) return { path: '/tmp/d' }
    if (l.startsWith('review-task:')) return { specVerdict: 'pass', findings: [], cannotVerify: [], strengths: [], assessment: 'ok' }
    if (l.startsWith('checkpoint:')) return {}
    if (l === 'integration-review') return { approved: true, findings: [] }
    return undefined
  })
  await runEngine({ args: { goal: 'g', implementer: 'claude' }, agent: b.agent, log: () => {} })
  assert.equal(verifyDispatched, false, 'no discovered command → deterministic gate skipped (LLM review only)')
})
