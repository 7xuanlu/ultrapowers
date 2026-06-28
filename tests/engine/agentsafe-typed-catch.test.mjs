import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runEngine, makeAgent } from './harness.mjs'

// Boule council (wf_ed504e61-4c7) found a verified fail-OPEN hole in the naive "wrap every
// agent() in try/catch -> null" fix: a throw on a STRUCTURAL agent (plan / critic) routes to
// null, which the engine turns into an empty queue / clean:true and reports ok:true on a run
// that built nothing. The fix is a TYPED catch (downgrade only the recoverable
// "no-StructuredOutput" failure to null) + per-stage routing (structural stages abort loud).
// These tests pin both halves: a disposable-probe throw is TOLERATED; a structural throw is NOT
// laundered into a silent success.

const NO_SO = () => { const e = new Error('agent({schema}): subagent completed without calling StructuredOutput (after in-conversation nudge)'); e.code = 'NO_STRUCTURED_OUTPUT'; return e }

// 1. The headline bug: a throw in plan() must NOT produce ok:true on a no-op run.
test('plan() throwing no-StructuredOutput never yields ok:true on an empty build (fail-open)', async () => {
  const { agent } = makeAgent((p, o) => {
    const l = o.label || ''
    if (l === 'sp-version-check') return { installed: ['6.0.0'] }
    if (l === 'plan') throw NO_SO()       // planner can't produce tasks
    return undefined
  })
  const result = await runEngine({
    args: { goal: 'build a thing', implementer: 'claude', maxRounds: 1 },
    agent, log: () => {},
  })
  assert.notEqual(result.ok, true, 'a run that planned nothing must never report ok:true')
})

// 2. A throw in a DISPOSABLE probe (review-package) is recoverable: the engine swallows it to
// null and the reviewer falls back to git diff, so the task still completes and the run is ok.
test('review-package throwing is tolerated — the task still completes (recoverable probe)', async () => {
  const { agent } = makeAgent((p, o) => {
    const l = o.label || ''
    if (l === 'sp-version-check') return { installed: ['6.0.0'] }
    if (l.startsWith('capture-head:')) return { sha: 'c'.repeat(40) }
    if (l.startsWith('claude:')) return { status: 'done', files: ['src/x.js'], summary: 'ok' }
    if (l.startsWith('verify:')) return { code: 0, tail: 'ok' }
    if (l.startsWith('red-witness:')) return { applicable: false }
    if (l.startsWith('scope-guard:')) return { deleted: [] }
    if (l.startsWith('checkpoint:')) return {}
    if (l.startsWith('review-package:')) throw NO_SO()   // probe fumbles its tool call
    if (l.startsWith('review-task:')) return { specVerdict: 'pass', findings: [], cannotVerify: [], strengths: [], assessment: 'ok' }
    if (l === 'integration-review') return { approved: true, findings: [] }
    return undefined
  })
  const result = await runEngine({
    args: { tasks: [{ id: 't1', spec: 'x' }], implementer: 'claude', verifyCmd: 'true', commit: true, maxRounds: 1 },
    agent, log: () => {},
  })
  assert.ok(result.passed.includes('t1'), 't1 must still pass when only the disposable probe threw')
  assert.equal(result.ok, true, 'run is ok — the probe failure was designed to be harmless')
})

// 3. A throw in critic() (loop-until-clean) must NOT be laundered into clean:true; the run must
// not silently report ok when the completeness critic never actually ran.
test('critic() throwing never silently marks the run clean/ok (loopUntilClean)', async () => {
  const { agent } = makeAgent((p, o) => {
    const l = o.label || ''
    if (l === 'sp-version-check') return { installed: ['6.0.0'] }
    if (l === 'plan') return { tasks: [{ id: 't1', spec: 'x' }] }
    if (l.startsWith('capture-head:')) return { sha: 'd'.repeat(40) }
    if (l.startsWith('claude:')) return { status: 'done', files: ['src/x.js'], summary: 'ok' }
    if (l.startsWith('verify:')) return { code: 0, tail: 'ok' }
    if (l.startsWith('red-witness:')) return { applicable: false }
    if (l.startsWith('scope-guard:')) return { deleted: [] }
    if (l.startsWith('checkpoint:')) return {}
    if (l.startsWith('review-package:')) return { path: '/tmp/up.diff' }
    if (l.startsWith('review-task:')) return { specVerdict: 'pass', findings: [], cannotVerify: [], strengths: [], assessment: 'ok' }
    if (l.startsWith('critic#')) throw NO_SO()   // critic can't report completeness
    if (l === 'integration-review') return { approved: true, findings: [] }
    return undefined
  })
  const result = await runEngine({
    args: { goal: 'build', verifyCmd: 'true', implementer: 'claude', commit: true, loopUntilClean: true, maxRounds: 2 },
    agent, log: () => {},
  })
  assert.notEqual(result.ok, true, 'a run whose critic never produced a verdict must not report ok:true')
})

// 4. witnessCommand fail-CLOSED (invariant-review finding): a scout-witness throw (-> null) must NOT
// promote the discovered command to the deterministic gate. The agentSafe swap previously turned the
// abort into a null that `!(w && w.redWitnessed===false)` read as "witnessed" -> unproven gate adopted.
test('scout-witness throwing never promotes an un-red-witnessed command to the gate (fail-closed)', async () => {
  const { agent } = makeAgent((p, o) => {
    const l = o.label || ''
    if (l === 'sp-version-check') return { installed: ['6.0.0'] }
    if (l === 'scout') return { verifyCmd: 'npm test', fullVerifyCmd: 'npm test', cacheType: 'none', cacheWrapper: null, cacheDirs: [], allowlistPaths: [] }
    if (l === 'scout-witness') throw NO_SO()   // the witness can't prove the command
    if (l === 'plan') return { tasks: [] }     // empty plan -> no tasks built; we only assert gate non-adoption
    return undefined
  })
  const result = await runEngine({
    args: { goal: 'build', implementer: 'claude', commit: true, maxRounds: 1 },
    agent, log: () => {},
  })
  assert.equal(result.verifyCmd, null, 'an unproven (witness-threw) command must NOT become the deterministic gate')
})
