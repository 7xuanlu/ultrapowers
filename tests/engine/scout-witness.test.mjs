import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runEngine, makeAgent } from './harness.mjs'

// A scout-discovered command that stays GREEN under a seeded break is a VACUOUS gate. The engine
// must red-witness the discovered command and REJECT it when it does not go red — otherwise UP's
// deterministic gate ("harness decides passed = code===0") is silently defeated. commit:true is
// REQUIRED: witnessCommand fails-OPEN when !doCommit (no per-commit restore guarantee), so the
// red-witness path only runs under commit:true.
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
    if (l.startsWith('red-witness:')) return { applicable: false }
    if (l.startsWith('review-package:')) return { path: '/tmp/d' }
    if (l.startsWith('review-task:')) return { specVerdict: 'pass', findings: [], cannotVerify: [], strengths: [], assessment: 'ok' }
    if (l.startsWith('checkpoint:')) return {}
    if (l === 'integration-review') return { approved: true, findings: [] }
    return undefined
  })
  await runEngine({ args: { goal: 'g', implementer: 'claude', commit: true }, agent, log: () => {} })
  // Rejected vacuous command must NOT become the gate → verify() sees no verifyCmd → never dispatches.
  assert.equal(verifyDispatched, false, 'a rejected (vacuous) discovered command must not feed the deterministic gate')
})
