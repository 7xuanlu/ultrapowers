import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runEngine } from './harness.mjs'

test('empty args returns the usage note without dispatching agents', async () => {
  const calls = []
  const result = await runEngine({
    args: {},
    agent: async (prompt, opts) => { calls.push(opts?.label); return null },
    log: () => {},
  })
  assert.equal(calls.length, 0, 'no agents should be dispatched for empty args')
  assert.equal(result.total, 0)
  assert.match(result.note, /args\.tasks/)
})
