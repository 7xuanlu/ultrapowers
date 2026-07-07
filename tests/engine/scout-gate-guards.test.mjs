import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runEngine, makeAgent } from './harness.mjs'

// Boule council (source-verified) F1: the deterministic gate must be PROVEN. A self-discovered
// command may become the gate ONLY if it red-witnesses (seed break → confirm RED), which requires a
// commit baseline. Without commit:true the command CANNOT be red-witnessed, so it must NOT be
// promoted to the deterministic gate — otherwise a vacuous command (e.g. `cargo check`, which
// compiles but tests nothing) silently becomes the gate, defeating UP's identity invariant.
test('F1: a discovered command is NOT promoted to the deterministic gate without commit:true', async () => {
  let verifyDispatched = false, witnessDispatched = false
  const { agent } = makeAgent((p, o) => {
    const l = o.label || ''
    if (l === 'sp-version-check') return { installed: ['6.1.1'] }
    if (l === 'scout') return { verifyCmd: 'cargo check', fullVerifyCmd: 'cargo test', cacheType: 'none', cacheWrapper: null, cacheDirs: [], allowlistPaths: [] }
    if (l === 'scout-witness') { witnessDispatched = true; return { applicable: true, redWitnessed: true, detail: 'should not be reached without commit' } }
    if (l === 'plan') return { tasks: [{ id: 't1', spec: 'x' }] }
    if (l.startsWith('claude:')) return { status: 'done', files: [], summary: 'ok' }
    if (l.startsWith('verify:')) { verifyDispatched = true; return { code: 0, tail: '' } }
    if (l.startsWith('review-package:')) return { path: '/tmp/d' }
    if (l.startsWith('review-task:')) return { specVerdict: 'pass', findings: [], cannotVerify: [], strengths: [], assessment: 'ok' }
    if (l === 'integration-review') return { approved: true, findings: [] }
    return undefined
  })
  // NO commit:true → cannot red-witness → must NOT adopt the discovered command as the gate.
  await runEngine({ args: { goal: 'g', implementer: 'claude' }, agent, log: () => {} })
  assert.equal(verifyDispatched, false, 'without commit:true the discovered command cannot be red-witnessed and must not become the deterministic gate')
  assert.equal(witnessDispatched, false, 'witnessCommand must be short-circuited when it cannot prove the command (no commit baseline)')
})

// Boule council F2: witnessCommand seeds a REAL break in a production file and asks the agent to
// restore it. The agent's "I restored it" is a self-report; a silently-failed restore leaves a
// deliberately-broken file as the per-commit baseline that every task then builds on. The engine
// must STRUCTURALLY confirm the tree is clean after the seed/restore (independent git check) and
// ABORT the run if it is not — never build on a corrupted baseline.
test('F2: run ABORTS if the tree is dirty after the red-witness seed/restore (un-restored break)', async () => {
  let verifyDispatched = false
  const { agent } = makeAgent((p, o) => {
    const l = o.label || ''
    if (l === 'sp-version-check') return { installed: ['6.1.1'] }
    if (l === 'scout') return { verifyCmd: 'cargo test', fullVerifyCmd: 'cargo test', cacheType: 'none', cacheWrapper: null, cacheDirs: [], allowlistPaths: [] }
    if (l === 'scout-witness') return { applicable: true, redWitnessed: true, detail: 'broke prod, suite failed (good)' }
    if (l === 'scout-witness-clean') return { clean: false, detail: 'src/lib.rs still modified — restore failed' }
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
  const r = await runEngine({ args: { goal: 'g', implementer: 'claude', commit: true }, agent, log: () => {} })
  assert.equal(r.aborted, 'witness-restore', 'a dirty tree after red-witness must abort the run')
  assert.equal(verifyDispatched, false, 'must not build any task on a corrupted baseline')
})

// F2 happy path: a clean tree after the witness proceeds normally (the abort is fail-closed, not
// a blanket block on the witness path).
test('F2: a clean tree after the red-witness proceeds (gate adopted, no abort)', async () => {
  let verifyDispatched = false
  const { agent } = makeAgent((p, o) => {
    const l = o.label || ''
    if (l === 'sp-version-check') return { installed: ['6.1.1'] }
    if (l === 'scout') return { verifyCmd: 'cargo test', fullVerifyCmd: 'cargo test', cacheType: 'none', cacheWrapper: null, cacheDirs: [], allowlistPaths: [] }
    if (l === 'scout-witness') return { applicable: true, redWitnessed: true, detail: 'broke prod, suite failed (good)' }
    if (l === 'scout-witness-clean') return { clean: true, detail: '' }
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
  const r = await runEngine({ args: { goal: 'g', implementer: 'claude', commit: true }, agent, log: () => {} })
  assert.notEqual(r.aborted, 'witness-restore', 'a clean tree must NOT abort')
  assert.equal(verifyDispatched, true, 'the red-witnessed command is adopted and the gate runs')
})
