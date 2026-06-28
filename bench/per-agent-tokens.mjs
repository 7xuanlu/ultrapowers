#!/usr/bin/env node
// Post-hoc per-agent / per-stage token attribution for an ultrapowers Workflow run.
// The engine is BLIND to per-agent tokens by design (the flat-coordinator property: agent()
// returns only the validated schema object, no usage) — so attribution is post-hoc over the
// transcript JSONL, not engine instrumentation. Answers the CHANGE-3 question the boule council
// asked: are the 6+ tiny haiku probes/task real waste, or is the many-short-agent shape fine?
//
// Usage:  node bench/per-agent-tokens.mjs <workflow-transcript-dir>
//   <dir> holds agent-*.jsonl (one per subagent). Each JSONL line is a message; assistant lines
//   carry {"message":{"usage":{input_tokens, cache_creation_input_tokens, cache_read_input_tokens,
//   output_tokens}}}. We sum per file, infer the STAGE from the first user prompt (same matchers
//   the engine's labels imply), and roll up by stage. ponytail: read-only, no deps, one file.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
if (!dir) { console.error('usage: node bench/per-agent-tokens.mjs <workflow-transcript-dir>'); process.exit(2) }

// Infer the engine stage from prompt text (the transcripts don't store the label).
function stageOf(prompt) {
  const p = prompt || ''
  if (/RE-WITNESS RED for task/.test(p)) return 'red-witness'
  if (/RED-WITNESS the discovered verify/.test(p)) return 'scout-witness'
  if (/Completeness critic/.test(p)) return 'critic'
  if (/reviewing ONE task's implementation/.test(p)) return 'review-task'
  if (/Adversarial fresh-eye review of the ENTIRE/.test(p)) return 'integration-review'
  if (/Decompose this goal/.test(p)) return 'plan'
  if (/Discover how to VERIFY this project/.test(p)) return 'scout'
  if (/Run this project's verify command/.test(p)) return 'verify'
  if (/review package to a file/.test(p)) return 'review-package'
  if (/rev-parse HEAD/.test(p)) return 'capture-head'
  if (/--diff-filter=D/.test(p)) return 'scope-guard'
  if (/Append exactly one line/.test(p)) return 'checkpoint'
  if (/build-cache wrapper|Warm this worktree/.test(p)) return 'cache-reach'
  if (/version directories under/.test(p)) return 'sp-version-check'
  if (/Codex CLI is runnable|codex --version/.test(p)) return 'preflight'
  if (/Implement (this|task)|TASK [\w-]+:/.test(p)) return 'implementer'
  return 'other'
}

function firstUserPrompt(lines) {
  for (const o of lines) {
    const m = o.message || {}
    if ((m.role || o.type) !== 'user') continue
    const c = m.content
    if (typeof c === 'string') return c
    if (Array.isArray(c)) { const t = c.find(b => b && b.type === 'text'); if (t) return t.text }
  }
  return ''
}

// Sum the billable tokens for one transcript. We count input + cache-creation + cache-read +
// output: cache-read is cheaper per token but it IS the per-spawn fixed load (system prompt +
// tool schema re-read each agent), which is exactly the cost the probe-merge question turns on.
function tokensOf(lines) {
  let inp = 0, cc = 0, cr = 0, out = 0
  for (const o of lines) {
    const u = o.message && o.message.usage
    if (!u) continue
    inp += u.input_tokens || 0
    cc += u.cache_creation_input_tokens || 0
    cr += u.cache_read_input_tokens || 0
    out += u.output_tokens || 0
  }
  return { inp, cc, cr, out, total: inp + cc + cr + out }
}

const files = readdirSync(dir).filter(f => f.endsWith('.jsonl'))
const perAgent = []
for (const f of files) {
  let lines
  try { lines = readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) }
  catch { continue }
  const stage = stageOf(firstUserPrompt(lines))
  perAgent.push({ file: f, stage, ...tokensOf(lines) })
}

// Roll up by stage.
const byStage = {}
for (const a of perAgent) {
  const s = byStage[a.stage] || (byStage[a.stage] = { stage: a.stage, n: 0, total: 0, cc: 0, cr: 0, out: 0 })
  s.n++; s.total += a.total; s.cc += a.cc; s.cr += a.cr; s.out += a.out
}
const rows = Object.values(byStage).sort((a, b) => b.total - a.total)
const grand = perAgent.reduce((t, a) => t + a.total, 0)

const pad = (s, n) => String(s).padEnd(n)
const padL = (s, n) => String(s).padStart(n)
console.log(`\nPer-stage token attribution — ${perAgent.length} agents, ${grand.toLocaleString()} total tokens\n`)
console.log(pad('stage', 20), padL('n', 4), padL('total', 12), padL('avg/agent', 11), padL('fixed%', 8))
console.log('-'.repeat(58))
for (const r of rows) {
  // "fixed%" = cache-read share of this stage's tokens = the per-spawn re-load tax. A HIGH fixed%
  // on a many-agent stage is the merge signal: most of its tokens are re-loading context, not work.
  const fixedPct = r.total ? Math.round((r.cr / r.total) * 100) : 0
  console.log(pad(r.stage, 20), padL(r.n, 4), padL(r.total.toLocaleString(), 12), padL(Math.round(r.total / r.n).toLocaleString(), 11), padL(fixedPct + '%', 8))
}
console.log('-'.repeat(58))
// Merge candidates: read-only git probes that run once/task and carry a high fixed-load share.
const PROBE = new Set(['capture-head', 'scope-guard', 'review-package', 'checkpoint'])
const probeRows = rows.filter(r => PROBE.has(r.stage))
const probeTotal = probeRows.reduce((t, r) => t + r.total, 0)
const probeFixed = probeRows.reduce((t, r) => t + r.cr, 0)
if (probeRows.length) {
  console.log(`\nProbe-merge candidates (${probeRows.map(r => r.stage).join(', ')}):`)
  console.log(`  ${probeTotal.toLocaleString()} tokens across ${probeRows.reduce((t, r) => t + r.n, 0)} agents` +
    ` = ${Math.round((probeTotal / grand) * 100)}% of the run; ${Math.round((probeFixed / probeTotal) * 100)}% of that is fixed per-spawn re-load.`)
  console.log(`  Merging them into one git-probe/task would save ≈ the fixed-load of ${probeRows.reduce((t, r) => t + r.n, 0) - rows.length ? probeRows.reduce((t, r) => t + (r.n - 1) * Math.round(r.cr / r.n), 0).toLocaleString() : 0} tokens (one re-load instead of N). Measure both before merging.`)
}
console.log()
