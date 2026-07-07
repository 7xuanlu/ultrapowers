import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runEngine, makeAgent } from './harness.mjs'

// Drives ONE task through the engine and asserts exactly one merged review agent runs
// (label review-task:*), not a separate spec + quality pair.
function baseResponder(prompt, opts) {
  const l = opts.label || ''
  if (l === 'sp-version-check') return { installed: ['6.1.1'] }
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
