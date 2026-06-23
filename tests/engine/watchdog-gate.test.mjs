import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runEngine, makeAgent } from './harness.mjs'

// Component C: the deterministic gate must run under the STRUCTURAL process-group watchdog, not as a
// raw command the agent is merely asked to time out (uncapped gate agents ran 55-117 min). This asserts
// the engine WIRES the watchdog into all three gate sites — verify, redWitness, and the integration
// final gate. tests/watchdog.sh separately proves the watchdog MECHANISM (kill + 124 + marker survival).
const WD = /perl -e 'use POSIX qw\(setsid\)/   // the watchdog one-liner's signature

test('verify / redWitness / integration gates run their command under the watchdog', async () => {
  let verifyPrompt = null, rwPrompt = null, integPrompt = null
  const { agent } = makeAgent((p, o) => {
    const l = o.label || ''
    if (l === 'sp-version-check') return { installed: ['6.0.0'] }
    if (l.startsWith('capture-head:')) return { sha: 'b'.repeat(40) }
    if (l.startsWith('codex:')) return { status: 'done', files: ['src/x.js'], summary: 'ok' }
    if (l.startsWith('verify:')) { verifyPrompt = p; return { code: 0, tail: 'ok' } }
    if (l.startsWith('red-witness:')) { rwPrompt = p; return { applicable: false } }
    if (l.startsWith('checkpoint:')) return {}
    if (l.startsWith('review-package:')) return { path: '/tmp/up.diff' }
    if (l.startsWith('review-task:')) return { specVerdict: 'pass', findings: [], cannotVerify: [], strengths: [], assessment: 'ok' }
    if (l === 'integration-review') { integPrompt = p; return { approved: true, findings: [] } }
    return undefined
  })

  await runEngine({
    // commit:true so redWitness is reached; verifyCmd + fullVerifyCmd so the integration gate runs a suite.
    args: { tasks: [{ id: 't1', spec: 'x' }], implementer: 'codex', verifyCmd: 'cargo test', fullVerifyCmd: 'cargo test --all', commit: true },
    agent, log: () => {},
  })

  assert.ok(verifyPrompt, 'verify gate must be dispatched')
  assert.match(verifyPrompt, WD, 'verify command must be wrapped in the structural watchdog')
  assert.match(verifyPrompt, /\/tmp\/up-verify-t1\.sh sh/, 'verify must run `sh <scriptfile>` under the watchdog')

  assert.ok(rwPrompt, 'redWitness gate must be dispatched (commit:true + verifyCmd)')
  assert.match(rwPrompt, WD, 'redWitness verify run must be wrapped in the structural watchdog')
  assert.match(rwPrompt, /\/tmp\/up-redwitness-t1\.sh sh/, 'redWitness must run `sh <scriptfile>` under the watchdog')

  assert.ok(integPrompt, 'integration review must be dispatched (a task passed)')
  assert.match(integPrompt, WD, 'integration final gate must be wrapped in the structural watchdog')
  assert.match(integPrompt, /\/tmp\/up-finalgate\.sh sh/, 'integration must run the full suite via `sh <scriptfile>` under the watchdog')
})
