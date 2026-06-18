import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { runEngine, makeAgent } from './harness.mjs'

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../workflow/ultrapowers-development.js'), 'utf8')

test('SP_VERSION is pinned to 6.0.0', () => {
  assert.match(SRC, /const SP_VERSION = '6\.0\.0'/)
})

test('no drift logged when installed superpowers is 6.0.0', async () => {
  const logs = []
  await runEngine({
    args: {},  // empty args returns early but checkSpDrift is not reached; use a 1-task run instead
    agent: async () => null, log: m => logs.push(m),
  })
  // Drift is checked on the build path; assert via a tasks run:
  const { agent } = makeAgent((p, o) => {
    const l = o.label || ''
    if (l === 'sp-version-check') return { installed: ['6.0.0'] }
    if (l.startsWith('capture-head:')) return { sha: 'a'.repeat(40) }
    if (l.startsWith('claude:')) return { status: 'done', files: [], summary: 'ok' }
    if (l.startsWith('verify:')) return { code: 0, tail: 'ok' }
    if (l.startsWith('red-witness:')) return { applicable: false }
    if (l.startsWith('review-package:')) return { path: '/tmp/x.diff' }
    if (l.startsWith('review-task:')) return { specVerdict: 'pass', findings: [], cannotVerify: [], strengths: [], assessment: 'ok' }
    if (l.startsWith('checkpoint:')) return {}
    if (l === 'integration-review') return { approved: true, findings: [] }
    return undefined
  })
  const driftLogs = []
  await runEngine({ args: { tasks: [{ id: 't1', spec: 'x' }], implementer: 'claude', verifyCmd: 'true', commit: true }, agent, log: m => driftLogs.push(m) })
  assert.ok(!driftLogs.some(m => /SP DRIFT/.test(m)), 'no drift expected at 6.0.0')
})
