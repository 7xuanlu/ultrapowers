import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runEngine, makeAgent } from './harness.mjs'

test('cannot_verify items from passing tasks are accumulated into result.cannotVerify', async () => {
  const { agent } = makeAgent((p, o) => {
    const l = o.label || ''
    if (l === 'sp-version-check') return { installed: ['6.1.1'] }
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
