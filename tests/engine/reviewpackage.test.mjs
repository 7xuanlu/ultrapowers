import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runEngine, makeAgent } from './harness.mjs'

test('a review-package agent runs before the reviewer and is scoped BASE..HEAD', async () => {
  let pkgPrompt = null
  const { agent, calls } = makeAgent((p, o) => {
    const l = o.label || ''
    if (l === 'sp-version-check') return { installed: ['6.1.1'] }
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
