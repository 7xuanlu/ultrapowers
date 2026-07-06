import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runEngine, makeAgent } from './harness.mjs'

// Systematic external-implementer failure must STOP feeding the dead CLI and burning an Opus
// fallback on every task. Two lines of defense:
//   (1) preflight probe fails  -> switch IMPLEMENTER to claude BEFORE any task runs (mirrors the
//       gemini cwd-mismatch downgrade at :919-922).
//   (2) OUTAGE_STREAK consecutive per-task fallbacks -> switch to claude for the REMAINING tasks.
// Regression guard for the codex-under-seatbelt burn (Sonnet relay x3 + Opus fallback per task;
// root cause: `codex exec` app-server can't init under the harness sandbox, CC #10524).

const base = (over = {}) => ({
  sp: (l) => l === 'sp-version-check' ? { installed: ['6.1.1'] } : undefined,
  head: (l) => l.startsWith('capture-head:') ? { sha: 'b'.repeat(40) } : undefined,
  verify: (l) => l.startsWith('verify:') ? { code: 0, tail: 'ok' } : undefined,
  red: (l) => l.startsWith('red-witness:') ? { applicable: false } : undefined,
  scope: (l) => l.startsWith('scope-guard:') ? { deleted: [] } : undefined,
  ckpt: (l) => l.startsWith('checkpoint:') ? {} : undefined,
  pkg: (l) => l.startsWith('review-package:') ? { path: '/tmp/up.diff' } : undefined,
  rev: (l) => l.startsWith('review-task:') ? { specVerdict: 'pass', findings: [], cannotVerify: [], strengths: [], assessment: 'ok' } : undefined,
  integ: (l) => l === 'integration-review' ? { approved: true, findings: [] } : undefined,
  ...over,
})
const chain = (fns) => (l) => { for (const f of Object.values(fns)) { const r = f(l); if (r !== undefined) return r } return undefined }

test('failed codex preflight switches implementer to claude (no per-task codex dispatch)', async () => {
  const resp = chain(base({
    preflight: (l) => l === 'preflight-codex'
      ? { ok: false, detail: 'failed to initialize in-process app-server client: Operation not permitted' } : undefined,
    impl: (l) => l.startsWith('claude:') ? { status: 'done', files: ['src/x.js'], summary: 'ok' } : undefined,
  }))
  const { agent, calls } = makeAgent((p, o) => resp(o.label || ''))
  await runEngine({ args: { tasks: [{ id: 't1', spec: 'x' }], implementer: 'codex', verifyCmd: 'true', commit: true }, agent, log: () => {} })
  const labels = calls.map(c => c.label || '')
  assert.ok(!labels.some(l => l.startsWith('codex:')), 'must NOT dispatch the codex per-task path after a failed preflight')
  assert.ok(labels.some(l => l.startsWith('claude:')), 'must implement the task via the claude path instead')
  // Security: the preflight probe runs a real `codex exec` unsandboxed — the GitHub PAT scrub must be in it.
  const probe = calls.find(c => c.label === 'preflight-codex')
  assert.ok(probe && /env -u GITHUB_PERSONAL_ACCESS_TOKEN/.test(probe.prompt), 'preflight codex probe must scrub the GitHub PAT (env -u GITHUB_PERSONAL_ACCESS_TOKEN)')
})

test('external-CLI relay dispatches at sonnet (its STEP 3 independently verifies the diff — judgment, not bounded gathering)', async () => {
  const resp = chain(base({
    preflight: (l) => l === 'preflight-codex' ? { ok: true, detail: 'codex 0.137.0' } : undefined,
    impl: (l) => l.startsWith('codex:') ? { status: 'done', files: ['src/x.js'], summary: 'ok' } : undefined,
  }))
  const { agent, calls } = makeAgent((p, o) => resp(o.label || ''))
  await runEngine({ args: { tasks: [{ id: 't1', spec: 'x' }], implementer: 'codex', verifyCmd: 'true', commit: true }, agent, log: () => {} })
  const relay = calls.find(c => (c.label || '').startsWith('codex:'))
  assert.ok(relay, 'the codex relay must be dispatched')
  assert.equal(relay.model, 'sonnet', 'relay must run at sonnet (judgment tier), not haiku')
})

test('OUTAGE_STREAK consecutive codex fallbacks switch remaining tasks to claude', async () => {
  const resp = chain(base({
    preflight: (l) => l === 'preflight-codex' ? { ok: true, detail: 'codex 0.137.0' } : undefined,
    // codex per-task always errors (null) -> 3 attempts fail -> opus fallback succeeds
    fallback: (l) => l.startsWith('claude-fallback:') ? { status: 'done', files: ['src/x.js'], summary: 'fb' } : undefined,
    // after the switch, the claude direct path implements the task
    impl: (l) => l.startsWith('claude:') ? { status: 'done', files: ['src/x.js'], summary: 'ok' } : undefined,
  }))
  const { agent, calls } = makeAgent((p, o) => resp(o.label || ''))
  const tasks = [1, 2, 3, 4].map(n => ({ id: `t${n}`, spec: 'x' }))
  await runEngine({ args: { tasks, implementer: 'codex', verifyCmd: 'true', commit: true }, agent, log: () => {} })
  const labels = calls.map(c => c.label || '')
  assert.ok(labels.some(l => l.startsWith('codex:t1')), 'early tasks still try codex (before the streak trips)')
  assert.ok(!labels.some(l => l.startsWith('codex:t4')), 'after OUTAGE_STREAK, task 4 must NOT dispatch codex')
  assert.ok(labels.some(l => l.startsWith('claude:t4')), 'task 4 must be implemented via the claude path')
})
