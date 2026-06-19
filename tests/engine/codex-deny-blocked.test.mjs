import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runEngine, makeAgent } from './harness.mjs'

// no-halt parity: a coarse OS-sandbox / permission denial in batch codex must be reported as
// `blocked` (escalate) rather than `failed` (blind-retry into the same wall). The in-session
// claude implementer gets recoverable per-call denial for free; codex needs the instruction.
test('codex implementer maps a sandbox/permission denial to blocked, not failed', async () => {
  let codexPrompt = null
  const { agent } = makeAgent((p, o) => {
    const l = o.label || ''
    if (l === 'sp-version-check') return { installed: ['6.0.0'] }
    if (l.startsWith('capture-head:')) return { sha: 'b'.repeat(40) }
    if (l.startsWith('codex:')) { codexPrompt = p; return { status: 'done', files: ['src/x.js'], summary: 'ok' } }
    if (l.startsWith('verify:')) return { code: 0, tail: 'ok' }
    if (l.startsWith('red-witness:')) return { applicable: false }
    if (l.startsWith('scope-guard:')) return { deleted: [] }
    if (l.startsWith('checkpoint:')) return {}
    if (l.startsWith('review-package:')) return { path: '/tmp/up.diff' }
    if (l.startsWith('review-task:')) return { specVerdict: 'pass', findings: [], cannotVerify: [], strengths: [], assessment: 'ok' }
    if (l === 'integration-review') return { approved: true, findings: [] }
    return undefined
  })
  await runEngine({ args: { tasks: [{ id: 't1', spec: 'x' }], implementer: 'codex', verifyCmd: 'true', commit: true }, agent, log: () => {} })
  assert.ok(codexPrompt, 'codex implementer must be dispatched')
  assert.match(codexPrompt, /DENIED by (its )?sandbox or a permission boundary[\s\S]*status:"blocked"/,
    'a sandbox/permission denial must map to blocked (escalate), not failed (blind retry)')
})
