// tests/engine/scout.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runEngine, makeAgent } from './harness.mjs'

test('scout runs at preflight (goal mode, no caller verifyCmd) and discovers a command', async () => {
  let scoutPrompt = null
  const { agent, calls } = makeAgent((p, o) => {
    const l = o.label || ''
    if (l === 'sp-version-check') return { installed: ['6.0.0'] }
    if (l === 'scout') { scoutPrompt = p; return { verifyCmd: 'cargo nextest run', fullVerifyCmd: 'cargo nextest run --all', cacheType: 'wrapper', cacheWrapper: 'sccache', cacheDirs: [], allowlistPaths: ['/Users/x/Library/Caches/Mozilla.sccache'] } }
    if (l === 'plan') return { tasks: [] }            // empty plan → no build, isolate the preflight
    return undefined
  })
  await runEngine({ args: { goal: 'build a thing' }, agent, log: () => {} })
  assert.ok(scoutPrompt, 'scout must be dispatched when goal is set and no verifyCmd given')
  assert.equal(calls.find(c => c.label === 'scout').model, 'opus', 'scout is a discovery/judgment agent → opus')
  assert.match(scoutPrompt, /Cargo\.toml|package\.json|Makefile/, 'scout prompt must direct it to read build manifests')
})
