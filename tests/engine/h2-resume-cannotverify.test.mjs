import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runEngine, makeAgent } from './harness.mjs'

// Seed a resume log where t1 already passed AND emitted a cannot_verify item; the run resumes
// (skips t1) but must rebuild t1's cannot_verify into the accumulator so integration sees it.
test('resume rebuilds cannot_verify from the checkpoint log (H2)', async () => {
  const { agent } = makeAgent((p, o) => {
    const l = o.label || ''
    if (l === 'sp-version-check') return { installed: ['6.1.1'] }
    if (l === 'resume-load') return { done: ['t1'], cannotVerify: [{ task: 't1', items: ['REQ-9 in unchanged db.js'] }] }
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
