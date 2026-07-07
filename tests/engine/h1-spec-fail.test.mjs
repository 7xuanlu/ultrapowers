import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runEngine, makeAgent } from './harness.mjs'

// Reviewer returns specVerdict:'fail' with EMPTY findings. H1: this must NOT pass.
test('specVerdict=fail with empty findings never marks the task ok (H1)', async () => {
  let reviewCount = 0
  const { agent } = makeAgent((p, o) => {
    const l = o.label || ''
    if (l === 'sp-version-check') return { installed: ['6.1.1'] }
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
