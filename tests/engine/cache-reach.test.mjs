// tests/engine/cache-reach.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runEngine, makeAgent } from './harness.mjs'

function driver(scoutReturn, capture) {
  return makeAgent((p, o) => {
    const l = o.label || ''
    if (l === 'sp-version-check') return { installed: ['6.0.0'] }
    if (l === 'scout') return scoutReturn
    if (l === 'scout-witness') return { applicable: true, redWitnessed: true, detail: 'ok' }
    if (l === 'cache-reach') { capture.prompt = p; capture.model = o.model; return { ok: true } }
    if (l === 'plan') return { tasks: [{ id: 't1', spec: 'x' }] }
    if (l.startsWith('capture-head:')) return { sha: 'a'.repeat(40) }
    if (l.startsWith('claude:')) return { status: 'done', files: [], summary: 'ok' }
    if (l.startsWith('verify:')) return { code: 0, tail: '' }
    if (l.startsWith('review-package:')) return { path: '/tmp/d' }
    if (l.startsWith('review-task:')) return { specVerdict: 'pass', findings: [], cannotVerify: [], strengths: [], assessment: 'ok' }
    if (l.startsWith('checkpoint:')) return {}
    if (l === 'integration-review') return { approved: true, findings: [] }
    return undefined
  })
}

test('local-dir cache type symlinks the dirs into the worktree; none does nothing', async () => {
  const cap = {}
  const a = driver({ verifyCmd: 'cargo test', fullVerifyCmd: 'cargo test', cacheType: 'local-dir', cacheWrapper: null, cacheDirs: ['target'], allowlistPaths: [] }, cap)
  await runEngine({ args: { goal: 'g', implementer: 'claude', repoDir: '/tmp/wt' }, agent: a.agent, log: () => {} })
  assert.ok(cap.prompt, 'cache-reach must dispatch for cacheType local-dir')
  assert.equal(cap.model, 'haiku', 'cache-reach is a mechanical relay → haiku')
  assert.match(cap.prompt, /target/, 'cache-reach must reference the cacheDirs to symlink')
  assert.match(cap.prompt, /ln -s|symlink/i, 'cache-reach must symlink the cache dir into the worktree')

  const cap2 = {}
  const b = driver({ verifyCmd: 'cargo test', fullVerifyCmd: 'cargo test', cacheType: 'none', cacheWrapper: null, cacheDirs: [], allowlistPaths: [] }, cap2)
  await runEngine({ args: { goal: 'g', implementer: 'claude', repoDir: '/tmp/wt' }, agent: b.agent, log: () => {} })
  assert.equal(cap2.prompt, undefined, 'cacheType none must NOT dispatch cache-reach')
})
