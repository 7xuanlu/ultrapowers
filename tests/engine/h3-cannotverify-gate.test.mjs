import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runEngine, makeAgent } from './harness.mjs'

function resp(integrationApproved) {
  return (p, o) => {
    const l = o.label || ''
    if (l === 'sp-version-check') return { installed: ['6.1.1'] }
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
