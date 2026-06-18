import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ENGINE = join(dirname(fileURLToPath(import.meta.url)), '../../workflow/ultrapowers-development.js')

// Load the engine body the way the Workflow runtime does: strip `export`, wrap as an async IIFE,
// inject the runtime globals as function params. The body's top-level `return` becomes our result.
export async function runEngine({ args = {}, agent, log, budget } = {}) {
  const src = readFileSync(ENGINE, 'utf8').replace(/^export\s+/gm, '')
  const _agent = agent || (async () => null)
  const _log = log || (() => {})
  // parallel/pipeline/phase are accepted but the engine drives tasks serially; pass-throughs keep
  // the body safe if a future change references them.
  const _parallel = async (thunks) => Promise.all(thunks.map(t => t()))
  const _pipeline = async (items) => items
  const _phase = () => {}
  const fn = new Function(
    'agent', 'parallel', 'pipeline', 'log', 'phase', 'args', 'budget',
    '"use strict"; return (async () => {\n' + src + '\n})()'
  )
  return fn(_agent, _parallel, _pipeline, _log, _phase, args, budget)
}

// Convenience: a mock agent that records every dispatch and delegates scripted responses to
// `responder(prompt, opts)`. Return `undefined` from responder to fall through to null (agent error).
export function makeAgent(responder) {
  const calls = []
  const agent = async (prompt, opts = {}) => {
    calls.push({ label: opts.label, model: opts.model, phase: opts.phase, prompt })
    const r = responder(prompt, opts)
    return r === undefined ? null : r
  }
  return { agent, calls }
}
