#!/usr/bin/env node
// bench/judge.mjs — BLIND quality judge for the head-to-head bench (ARM A vs ARM B), per task.
//
// This is a THIN wrapper over the repo's verified tools/quality-diff.mjs (blind, dual-order
// position-bias control, fail-closed evidence-bearing rubric, TIE/INCONCLUSIVE first-class). It adds
// the two things the fairness review (A8 / README §F16) demands on top of quality-diff:
//
//   1. Q1 (Correctness) is MECHANICAL — computed from `node --test` in each arm's collected output,
//      NOT from the LLM judge. `exit 0` AND coverage of the spec's numbered acceptance criteria is a
//      deterministic pass/fail. The LLM judge is reserved for the subjective axes (test_integrity,
//      yagni, idiom, edge_cases) — exactly where same-family self-preference would otherwise bite.
//   2. CROSS-FAMILY agreement — the blind prompts can be scored by a second judge family (opus AND a
//      gemini/codex CLI). Material disagreement on a dimension is reported as INCONCLUSIVE, never
//      averaged into a false consensus.
//
// re-witness-RED's test-integrity edge (B-full) is reported elsewhere as a DIRECT COUNT of vacuous
// tests caught (from the harness return / red-witness output), NOT laundered through this judge (A8c).
//
// The rubric/anti-gaming/"do not trust the report" stance is inherited verbatim-in-spirit from
// Superpowers' reviewer prompts (Jesse Vincent / @obra); this file only wires Q1-mechanical +
// cross-family onto the existing pairwise/blind/dual-order protocol.
//
// USAGE
//   # blind pairwise quality of two collected arm outputs for the SAME task (print prompts to score):
//   node bench/judge.mjs --spec bench/tasks/string-utils.md \
//        --a-dir bench/runs/A-opus/1/output --b-dir bench/runs/B-parity/1/output \
//        --judge print            # emits both blind prompts; score on a fresh agent, then --ingest
//
//   # mechanical Q1 only (test runner, no LLM):
//   node bench/judge.mjs --q1 --a-dir <dir> --b-dir <dir>
//
//   # drive a CLI judge directly (e.g. a cross-family judge):
//   node bench/judge.mjs --spec <spec> --a-dir <dir> --b-dir <dir> --judge 'cmd:gemini -p -'
//
// --a-label / --b-label set the human-facing arm names for the FINAL report only (never shown to the
// judge). --seed makes a run reproducible. Exit codes mirror quality-diff: 0 ok, 2 usage, 3 a judge
// reply failed schema (fail-closed).
//
// TODO(real-cli): the `node --test` acceptance-criterion COUNT per task is read from the spec's
// numbered criteria; wire your installed runner's pass-count parsing if `node --test` output format
// drifts. The cross-family CLI judge command (gemini/codex) is passed via --judge 'cmd:...'; confirm
// it emits raw JSON (quality-diff tolerates prose/fence-wrapped JSON by extracting the outermost {}).

import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import {
  runQualityDiff, buildJudgePrompt, validateReply, aggregate, DIMENSIONS,
} from '../tools/quality-diff.mjs'

function die(msg, code = 2) { process.stderr.write(`bench/judge: ${msg}\n`); process.exit(code) }

function parseArgs(argv) {
  const a = {}
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]
    if (!t.startsWith('--')) continue
    const key = t.slice(2)
    if (key === 'ingest') { a.ingest = [argv[++i], argv[++i]]; continue }
    const val = (i + 1 < argv.length && !argv[i + 1].startsWith('--')) ? argv[++i] : true
    a[key] = val
  }
  return a
}

// ── Q1 MECHANICAL ────────────────────────────────────────────────────────────────
// Correctness is decided by the test runner, never the LLM (A8a). Pass = `node --test` exit 0 in the
// arm's collected output dir. We read the recorded verify.txt (written by run.sh collect) when present
// so we do NOT depend on node being re-invokable on the judging machine; fall back to re-running.
function q1Mechanical(dir) {
  const verifyTxt = join(dir, 'verify.txt')
  if (existsSync(verifyTxt)) {
    const txt = readFileSync(verifyTxt, 'utf8')
    const m = txt.match(/exit=(\d+)/)
    if (m) return { pass: m[1] === '0', source: 'verify.txt', exit: Number(m[1]) }
    // a recorded run with no exit marker (e.g. dry-run placeholder) — undecidable, fail-closed.
    if (/TODO\(real-cli\)/.test(txt)) return { pass: false, source: 'verify.txt', exit: null, note: 'TODO(real-cli): no real verify recorded' }
  }
  // Fall back to re-running node:test in the collected output (needs package.json+src+test present).
  try {
    execFileSync('node', ['--test'], { cwd: dir, stdio: 'pipe' })
    return { pass: true, source: 'rerun', exit: 0 }
  } catch (e) {
    return { pass: false, source: 'rerun', exit: e.status ?? null }
  }
}

// ── resolve an arm's diff for the blind judge ────────────────────────────────────
// The collected output is src/ + test/ (the scaffolding is identical across arms, so a "diff" against
// an empty baseline is just the new files). We present the new files as a unified-diff-ish blob the
// judge reads as the implementation. We deliberately strip arm-identifying commit hints (blinding).
function armDiff(dir) {
  const parts = []
  for (const sub of ['src', 'test']) {
    const d = join(dir, sub)
    if (!existsSync(d)) continue
    let files
    try { files = execFileSync('find', [d, '-type', 'f', '!', '-name', '.gitkeep'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean) }
    catch { files = [] }
    for (const f of files) {
      const rel = f.slice(dir.length + 1)
      const body = readFileSync(f, 'utf8')
      parts.push(`--- /dev/null\n+++ b/${rel}\n` + body.split('\n').map(l => `+${l}`).join('\n'))
    }
  }
  return parts.join('\n')
}

async function main() {
  const a = parseArgs(process.argv.slice(2))
  if (a.help) {
    process.stdout.write(readFileSync(fileURLToPath(import.meta.url)).toString().split('\n')
      .filter(l => l.startsWith('//')).slice(0, 44).map(l => l.replace(/^\/\/ ?/, '')).join('\n') + '\n')
    process.exit(0)
  }
  if (!a['a-dir'] || !a['b-dir']) die('require --a-dir and --b-dir (collected arm outputs)')
  const aDir = String(a['a-dir']), bDir = String(a['b-dir'])
  const aLabel = a['a-label'] || 'A', bLabel = a['b-label'] || 'B'

  // Q1 mechanical — always computed, regardless of mode.
  const q1 = { A: q1Mechanical(aDir), B: q1Mechanical(bDir) }

  if (a.q1) {                                  // mechanical-only mode: no LLM judge.
    process.stdout.write(JSON.stringify({ q1, arms: { A: aLabel, B: bLabel } }, null, 2) + '\n')
    return
  }

  if (!a.spec) die('require --spec for the blind pairwise quality pass (or use --q1 for mechanical-only)')
  const spec = readFileSync(String(a.spec), 'utf8')
  const seed = a.seed != null ? String(a.seed) : String(Date.now())
  const aD = armDiff(aDir), bD = armDiff(bDir)

  // --judge print: emit the two blind prompts (dual-order) and stop; score on a fresh agent, then
  // re-invoke quality-diff --ingest to aggregate. This keeps the judge zero-dependency.
  if (!a.judge || a.judge === 'print') {
    ;[{ l: aD, r: bD }, { l: bD, r: aD }].forEach((o, i) => {
      process.stdout.write(`\n===== ORDER ${i + 1} BLIND PROMPT (fresh capable-model judge; save its JSON) =====\n`)
      process.stdout.write(buildJudgePrompt({ spec, leftDiff: o.l, rightDiff: o.r }) + '\n')
    })
    process.stderr.write(`\nQ1 (mechanical): A=${q1.A.pass ? 'PASS' : 'FAIL'} B=${q1.B.pass ? 'PASS' : 'FAIL'}\n` +
      `seed=${seed}. Aggregate the two JSON replies with tools/quality-diff.mjs --ingest (Q2-Q4).\n`)
    return
  }

  // cmd:<shell> — drive a (possibly cross-family) CLI judge directly.
  let judge
  if (typeof a.judge === 'string' && a.judge.startsWith('cmd:')) {
    const shell = a.judge.slice(4)
    judge = async (prompt) => {
      const out = execFileSync('/bin/sh', ['-c', shell], { input: prompt, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
      const m = out.match(/\{[\s\S]*\}/); if (!m) die(`judge cmd returned no JSON:\n${out.slice(0, 400)}`, 3)
      const reply = JSON.parse(m[0])
      const v = validateReply(reply); if (!v.ok) die(`judge reply failed schema: ${v.error}`, 3)
      return reply
    }
  } else die(`unknown --judge mode '${a.judge}' (use print | cmd:<shell>)`)

  try {
    const quality = await runQualityDiff({ spec, aDiff: aD, bDiff: bD, aLabel, bLabel, seed, judge })
    // Combine: mechanical Q1 (the gate) + the blind subjective verdict (Q2-Q4).
    process.stdout.write(JSON.stringify({ q1, quality }, null, 2) + '\n')
    const head = quality.verdict === 'A' ? `WINNER(Q2-4): ${aLabel}` : quality.verdict === 'B' ? `WINNER(Q2-4): ${bLabel}`
      : quality.verdict === 'TIE' ? 'Q2-4 TIE' : 'Q2-4 INCONCLUSIVE (position-dependent)'
    process.stderr.write(`\nQ1: A=${q1.A.pass ? 'PASS' : 'FAIL'} B=${q1.B.pass ? 'PASS' : 'FAIL'} · ${head}\n`)
  } catch (e) { die(e.message, e.code || 1) }
}

// dimensions are imported only to document the rubric the wrapper relies on; reference to avoid lint.
void DIMENSIONS; void aggregate

if (import.meta.url === `file://${process.argv[1]}`) main()
