import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runEngine, makeAgent } from './harness.mjs'

// Security: the codex implementer runs UNSANDBOXED (sandbox.excludedCommands) via a Bash
// child shell, so it inherits the session env — including secrets like the GitHub PAT that
// the trusted MCP server needs but an external CLI must not read. The codex exec invocation
// must scrub those secrets from its own environment.
test('codex implementer scrubs GITHUB_PERSONAL_ACCESS_TOKEN from its child-shell env', async () => {
  let codexPrompt = null
  const { agent } = makeAgent((p, o) => {
    const l = o.label || ''
    if (l === 'sp-version-check') return { installed: ['6.0.0'] }
    if (l.startsWith('capture-head:')) return { sha: 'b'.repeat(40) }
    if (l.startsWith('codex:')) { codexPrompt = p; return { status: 'done', files: ['src/x.js'], summary: 'ok' } }
    if (l.startsWith('verify:')) return { code: 0, tail: 'ok' }
    if (l.startsWith('red-witness:')) return { applicable: false }
    if (l.startsWith('checkpoint:')) return {}
    if (l.startsWith('review-package:')) return { path: '/tmp/up.diff' }
    if (l.startsWith('review-task:')) return { specVerdict: 'pass', findings: [], cannotVerify: [], strengths: [], assessment: 'ok' }
    if (l === 'integration-review') return { approved: true, findings: [] }
    return undefined
  })

  await runEngine({
    args: { tasks: [{ id: 't1', spec: 'x' }], implementer: 'codex', verifyCmd: 'true', commit: true },
    agent, log: () => {},
  })

  assert.ok(codexPrompt, 'codex implementer must be dispatched')
  // The scrub must immediately precede the actual codex exec invocation (the contiguous form
  // proves both presence and position; "(codex exec)" in the intro prose won't match this).
  assert.match(codexPrompt, /env -u GITHUB_PERSONAL_ACCESS_TOKEN codex exec/, 'codex exec must run with the GitHub PAT unset from its env')
})
