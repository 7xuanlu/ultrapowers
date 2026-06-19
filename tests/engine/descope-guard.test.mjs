import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runEngine, makeAgent } from './harness.mjs'

// Descope guard: deterministic backstop to the LLM reviewer. A task must not DELETE pre-existing
// files (routes/tests/code) to reach green unless its spec authorizes it. Detection is pure git
// over baseSha..HEAD; an unauthorized deletion is restored and the implementer is re-dispatched.

test('descope guard restores an unauthorized pre-existing-file deletion and re-dispatches the implementer', async () => {
  let guardCalls = 0, restoreCalled = false, correctiveMsg = null
  const { agent } = makeAgent((p, o) => {
    const l = o.label || ''
    if (l === 'sp-version-check') return { installed: ['6.0.0'] }
    if (l.startsWith('capture-head:')) return { sha: 'b'.repeat(40) }
    if (l.startsWith('claude:')) { if (/deleted pre-existing file/i.test(p)) correctiveMsg = p; return { status: 'done', files: ['src/x.js'], summary: 'ok' } }
    if (l.startsWith('verify:')) return { code: 0, tail: 'ok' }
    if (l.startsWith('red-witness:')) return { applicable: false }
    // first pass: implementer descoped (deleted a route not named in the spec); after restore+resend: clean
    if (l.startsWith('scope-guard:')) { guardCalls++; return { deleted: guardCalls === 1 ? ['src/old-route.js'] : [] } }
    if (l.startsWith('scope-restore:')) { restoreCalled = true; return { restored: true } }
    if (l.startsWith('checkpoint:')) return {}
    if (l.startsWith('review-package:')) return { path: '/tmp/up.diff' }
    if (l.startsWith('review-task:')) return { specVerdict: 'pass', findings: [], cannotVerify: [], strengths: [], assessment: 'ok' }
    if (l === 'integration-review') return { approved: true, findings: [] }
    return undefined
  })
  await runEngine({ args: { tasks: [{ id: 't1', spec: 'build the thing' }], implementer: 'claude', verifyCmd: 'true', commit: true }, agent, log: () => {} })
  assert.ok(guardCalls >= 1, 'scope guard must run on a green task')
  assert.ok(restoreCalled, 'an unauthorized deletion must be restored from baseSha')
  assert.match(correctiveMsg || '', /deleted pre-existing file/i, 'implementer must be re-dispatched with a corrective message')
})

test('descope guard allows a deletion the task spec authorizes', async () => {
  let restoreCalled = false
  const { agent } = makeAgent((p, o) => {
    const l = o.label || ''
    if (l === 'sp-version-check') return { installed: ['6.0.0'] }
    if (l.startsWith('capture-head:')) return { sha: 'b'.repeat(40) }
    if (l.startsWith('claude:')) return { status: 'done', files: ['src/x.js'], summary: 'ok' }
    if (l.startsWith('verify:')) return { code: 0, tail: 'ok' }
    if (l.startsWith('red-witness:')) return { applicable: false }
    if (l.startsWith('scope-guard:')) return { deleted: ['src/legacy.js'] }
    if (l.startsWith('scope-restore:')) { restoreCalled = true; return { restored: true } }
    if (l.startsWith('checkpoint:')) return {}
    if (l.startsWith('review-package:')) return { path: '/tmp/up.diff' }
    if (l.startsWith('review-task:')) return { specVerdict: 'pass', findings: [], cannotVerify: [], strengths: [], assessment: 'ok' }
    if (l === 'integration-review') return { approved: true, findings: [] }
    return undefined
  })
  await runEngine({ args: { tasks: [{ id: 't1', spec: 'remove the deprecated src/legacy.js module' }], implementer: 'claude', verifyCmd: 'true', commit: true }, agent, log: () => {} })
  assert.equal(restoreCalled, false, 'a spec-authorized deletion must not be restored')
})

// Guard must work in the DEFAULT commit:false mode (no per-task commits), where redWitness is off
// and HEAD==baseSha. A commit-range diff (baseSha..HEAD) would be empty and miss working-tree deletes;
// the guard must diff baseSha against the WORKING TREE.
test('descope guard diffs baseSha vs the working tree (catches uncommitted deletes, not commit-range only)', async () => {
  let guardPrompt = null
  const { agent } = makeAgent((p, o) => {
    const l = o.label || ''
    if (l === 'sp-version-check') return { installed: ['6.0.0'] }
    if (l.startsWith('capture-head:')) return { sha: 'b'.repeat(40) }
    if (l.startsWith('claude:')) return { status: 'done', files: ['src/x.js'], summary: 'ok' }
    if (l.startsWith('verify:')) return { code: 0, tail: 'ok' }
    if (l.startsWith('red-witness:')) return { applicable: false }
    if (l.startsWith('scope-guard:')) { guardPrompt = p; return { deleted: [] } }
    if (l.startsWith('review-package:')) return { path: '/tmp/up.diff' }
    if (l.startsWith('review-task:')) return { specVerdict: 'pass', findings: [], cannotVerify: [], strengths: [], assessment: 'ok' }
    if (l === 'integration-review') return { approved: true, findings: [] }
    return undefined
  })
  // NOTE: no commit:true -> default commit:false mode
  await runEngine({ args: { tasks: [{ id: 't1', spec: 'x' }], implementer: 'claude', verifyCmd: 'true' }, agent, log: () => {} })
  const sha = 'b'.repeat(40)
  assert.ok(guardPrompt, 'scope guard must run even without per-task commits')
  assert.match(guardPrompt, new RegExp('diff --diff-filter=D -M --name-only ' + sha + '\\b'), 'must diff baseSha against the working tree')
  assert.doesNotMatch(guardPrompt, new RegExp(sha + '\\.\\.HEAD'), 'must NOT be a commit-range diff (would miss uncommitted deletes in the default commit:false mode)')
})
