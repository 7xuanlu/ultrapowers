import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runEngine, makeAgent } from './harness.mjs'

test('implementer brief requires TDD evidence and test cadence', async () => {
  let implPrompt = null
  const { agent } = makeAgent((p, o) => {
    const l = o.label || ''
    if (l === 'sp-version-check') return { installed: ['6.1.1'] }
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
