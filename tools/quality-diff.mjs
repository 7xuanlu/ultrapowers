#!/usr/bin/env node
// quality-diff — BLIND pairwise A/B judge for two implementations of the SAME spec.
//
// WHAT IT IS. The harness's per-task review is single-arm (does THIS diff meet spec? pass/fail).
// QUALITY-DIFF is the OTHER axis: given two diffs that solve the SAME spec — ARM A vs ARM B
// (e.g. codex-vs-claude implementer, re-witness on-vs-off, sonnet-vs-opus) — which is BETTER,
// per-dimension and overall, with evidence? It exists to turn "ultrapowers feels better" into a
// measured, position-bias-controlled verdict for docs/benchmarks/.
//
// HOW IT STAYS HONEST.
//  - BLIND: the judge sees "LEFT" / "RIGHT", never "A"/"B" or which arm/model produced which.
//    The script holds the secret mapping and only de-blinds AFTER scores are in.
//  - POSITION-BIAS NEUTRALIZED: every comparison is run TWICE — once with A on the left, once with
//    A on the right (orders swapped). A real quality gap survives the swap; a verdict that flips
//    with position is an artifact of the judge's position prior, and we report it as INCONCLUSIVE
//    rather than launder it into a fake win. (LLM judges have a documented left/first-position
//    bias; running both orders and requiring agreement is the standard control.)
//  - DETERMINISTIC SCAFFOLD: this script does everything that must NOT depend on a model —
//    diff extraction, blinding, order assignment, prompt assembly, parsing, aggregation, verdict
//    logic, tie/inconclusive handling. Only the single judgement call is the model's.
//
// USAGE
//   node quality-diff.mjs --spec spec.md --a <ref|file|-> --b <ref|file|-> [options]
//
//   --spec <file>        the SHARED specification both arms implemented (required)
//   --a, --b             each is ONE of:
//                          a git revision range  "BASE..HEAD"  (uses `git -C <repo> diff`)
//                          a path to a .diff/.patch file
//                          "-"                    (read that diff from a named stdin pair; see --a-file)
//   --a-file, --b-file   explicit diff file paths (alternative to positional refs)
//   --a-label, --b-label human-readable arm names for the FINAL report only (e.g. "codex", "claude").
//                        NEVER shown to the judge. Default "A"/"B".
//   --repo <dir>         repo root for `git diff` refs (default: cwd)
//   --judge <mode>       how to obtain the judgement for one blind prompt:
//                          "print"  (default) — emit the two blind prompts to stdout and STOP.
//                                    You paste each into a fresh capable-model agent and feed the
//                                    two JSON replies back via --ingest. Zero-dependency, fully manual.
//                          "cmd:<shell>" — run <shell>, passing the prompt on stdin; expects the
//                                    judge's raw JSON on stdout. e.g. --judge 'cmd:codex exec -'
//                          "harness" — when imported by the Workflow (see runQualityDiff export),
//                                    the host supplies an async judge(prompt)->obj via opts.judge.
//   --ingest <f1> <f2>   (with --judge print) two files holding the judge's JSON for order-1 and
//                        order-2 respectively; aggregates and prints the final verdict.
//   --seed <int>         seed the order randomization (default: time-based). Recorded in output.
//   --out <file>         write the full result JSON here (default: stdout).
//
// EXIT CODES: 0 = ran clean (verdict may still be TIE/INCONCLUSIVE). 2 = bad usage. 3 = a judge
// reply failed schema validation (fail-closed — never silently coerce a malformed verdict).
//
// The dimensions, the anti-gaming checks, and the "do not trust the report" stance are INHERITED
// verbatim-in-spirit from superpowers' spec + code-quality reviewer prompts; this tool only adds
// the pairwise/blind/dual-order framing. Credit: Superpowers by Jesse Vincent (@obra).

import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

// ───────────────────────────── the rubric (single source of truth) ─────────────────────────────
// Five dimensions. Each is scored 1-5 PER SIDE (absolute), plus the judge picks a per-dimension
// winner. We deliberately collect BOTH an absolute 1-5 and a relative winner: the absolute scores
// let two arms BOTH be bad (TIE-low) or BOTH be good (TIE-high) instead of forcing a false winner,
// and let us aggregate across many tasks; the per-dim winner is the position-bias probe.
export const DIMENSIONS = [
  { key: 'spec_correctness',  weight: 3,
    desc: 'Does the diff satisfy the SPEC — every stated requirement met, nothing essential missing, the RIGHT problem solved? A diff that misreads the spec scores low here even if elegant.' },
  { key: 'test_integrity',    weight: 3,
    desc: 'Are the tests NON-VACUOUS and honest? Do they assert concrete behavior (not just types/truthiness), exercise the new code (would FAIL if the impl were reverted), and avoid mocking the very thing under test? ANTI-GAMING: weakened/deleted existing tests, edited gate/config to force green, placeholder/stub asserting "done", or test-only methods bolted onto production code => this dimension is 1.' },
  { key: 'yagni',             weight: 2,
    desc: 'YAGNI / over-build. Did it build ONLY what the spec asked — no speculative abstractions, no unrequested flags/options, no future-proofing, no "while I am here" refactors? Less, when less meets the spec, scores HIGHER.' },
  { key: 'idiom',             weight: 2,
    desc: 'Idiom & maintainability. Clear accurate names, one responsibility per unit, no dead code, sane error handling, follows the surrounding codebase conventions. Would a careful maintainer be happy to own this?' },
  { key: 'edge_cases',        weight: 2,
    desc: 'Edge-case coverage. Are boundary/empty/error/overflow/concurrency cases the spec implies actually handled AND tested — without inventing cases the spec excludes (that would be a YAGNI hit, not a bonus here)?' },
]
const DIM_KEYS = DIMENSIONS.map(d => d.key)

// ───────────────────────────── the scoring schema (judge must return EXACTLY this) ─────────────
// Mirrors the harness's REVIEW schema style (severity-tagged, evidence-bearing) but pairwise.
// Per dimension: an absolute 1-5 for EACH side + a winner among LEFT|RIGHT|TIE + concrete evidence
// (file:line / the actual diff hunk) justifying it. Then one overall winner + confidence + rationale.
export const JUDGE_SCHEMA = {
  type: 'object',
  required: ['dimensions', 'overall'],
  additionalProperties: false,
  properties: {
    dimensions: {
      type: 'object',
      required: DIM_KEYS,
      additionalProperties: false,
      properties: Object.fromEntries(DIM_KEYS.map(k => [k, {
        type: 'object',
        required: ['left_score', 'right_score', 'winner', 'evidence'],
        additionalProperties: false,
        properties: {
          left_score:  { type: 'integer', minimum: 1, maximum: 5 },
          right_score: { type: 'integer', minimum: 1, maximum: 5 },
          winner:      { enum: ['LEFT', 'RIGHT', 'TIE'] },
          // EVIDENCE IS MANDATORY AND MUST BE SPECIFIC — a file:line or a quoted hunk from the diff.
          // A winner with empty/vague evidence is rejected at parse time (fail-closed).
          evidence:    { type: 'string', minLength: 1 },
        },
      }])),
    },
    overall: {
      type: 'object',
      required: ['winner', 'confidence', 'rationale'],
      additionalProperties: false,
      properties: {
        winner:     { enum: ['LEFT', 'RIGHT', 'TIE'] },
        // "TIE" is a FIRST-CLASS verdict (both good or both bad), NOT a cop-out: the judge is told
        // to use it when the diffs are materially equivalent on the weighted dimensions.
        confidence: { enum: ['low', 'medium', 'high'] },
        rationale:  { type: 'string', minLength: 1 },
      },
    },
  },
}

// ───────────────────────────── the exact judge prompt ─────────────────────────────
// `blind` = { spec, leftDiff, rightDiff }. No arm names, no model names, no "A/B" — only LEFT/RIGHT.
export function buildJudgePrompt(blind) {
  const rubric = DIMENSIONS.map((d, i) =>
    `${i + 1}. **${d.key}** (weight ${d.weight}): ${d.desc}`).join('\n')
  return `You are an impartial senior engineer judging TWO competing implementations of the SAME
specification. They are labeled **LEFT** and **RIGHT**. You do NOT know who or what produced
either one — judge ONLY the code in front of you. Do not speculate about authorship; any guess
about which tool/model wrote which side is irrelevant and forbidden as a basis for scoring.

## CRITICAL: Do Not Trust Either Diff's Self-Presentation
A diff can look confident and be wrong. Comments, commit messages, and tidy formatting are NOT
evidence of correctness. Read the ACTUAL changed code. Compare it to the spec LINE BY LINE.
Verify claims by reading; never by trusting how the change presents itself.

## The Specification (both sides implemented THIS)
${blind.spec}

## LEFT — implementation diff
\`\`\`diff
${blind.leftDiff}
\`\`\`

## RIGHT — implementation diff
\`\`\`diff
${blind.rightDiff}
\`\`\`

## Rubric — score EACH side 1-5 on EACH dimension, then pick a per-dimension winner
(1 = unacceptable, 2 = weak, 3 = adequate, 4 = good, 5 = excellent. Score the two sides
INDEPENDENTLY first — both may be high, both may be low — THEN decide the winner.)
${rubric}

Scoring discipline:
- **Evidence is mandatory.** For every dimension, cite a concrete file:line or quote the exact
  diff hunk that justifies your scores and winner. A claim with no locatable evidence is invalid.
- **TIE is a real answer.** If the two sides are materially equivalent on a dimension (both good,
  or both bad), say TIE — do not manufacture a winner. Equal scores ⇒ winner TIE.
- **Test integrity is anti-gameable.** If a side weakened/deleted existing tests, edited the gate
  or test config to force green, left a stub/placeholder while claiming done, added test-only
  methods to production code, or wrote tests that would still pass with the implementation removed,
  its test_integrity score is 1 regardless of how clean the rest looks.
- **YAGNI cuts both ways.** Building MORE than the spec asked is a defect, not a virtue. Do not
  reward extra abstractions, flags, or "future-proofing" the spec did not request.
- Position carries NO meaning. LEFT is not favored over RIGHT. Judge symmetrically.

## Output — return ONLY this JSON, nothing else
{
  "dimensions": {
${DIM_KEYS.map(k => `    "${k}": { "left_score": <1-5>, "right_score": <1-5>, "winner": "LEFT|RIGHT|TIE", "evidence": "<file:line or quoted hunk justifying both scores>" }`).join(',\n')}
  },
  "overall": {
    "winner": "LEFT|RIGHT|TIE",
    "confidence": "low|medium|high",
    "rationale": "<2-4 sentences: the weighted, evidence-grounded reason; name the decisive dimension(s)>"
  }
}`
}

// ───────────────────────────── deterministic plumbing ─────────────────────────────
function die(msg, code = 2) { process.stderr.write(`quality-diff: ${msg}\n`); process.exit(code) }

function parseArgs(argv) {
  const a = {}; const rest = []
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]
    if (t.startsWith('--')) {
      const key = t.slice(2)
      if (key === 'ingest') { a.ingest = [argv[++i], argv[++i]]; continue }
      const val = (i + 1 < argv.length && !argv[i + 1].startsWith('--')) ? argv[++i] : true
      a[key] = val
    } else rest.push(t)
  }
  return { a, rest }
}

// Resolve one arm's diff text from: explicit file, a git range, or a .diff/.patch path.
function resolveDiff(spec, fileOpt, repo, label) {
  if (fileOpt && fileOpt !== '-') return readFileSync(fileOpt, 'utf8')
  if (typeof spec === 'string' && /\.\./.test(spec)) {            // looks like BASE..HEAD
    try {
      return execFileSync('git', ['-C', repo, 'diff', spec], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    } catch (e) { die(`git diff '${spec}' failed for arm ${label}: ${e.message}`) }
  }
  if (typeof spec === 'string') {                                 // treat as a patch file path
    try { return readFileSync(spec, 'utf8') }
    catch (e) { die(`could not read diff for arm ${label} from '${spec}': ${e.message}`) }
  }
  die(`arm ${label}: provide a git range (BASE..HEAD), a .diff file, or --${label.toLowerCase()}-file`)
}

// Seeded, reproducible coin flip. order1 decides which arm is LEFT in the FIRST run; order2 is the
// swap. We run BOTH regardless — the seed only affects which physical arm is printed as "LEFT" first
// (cosmetic) and is recorded so a run is reproducible.
function seededFlip(seed, salt) {
  const h = createHash('sha256').update(`${seed}:${salt}`).digest()
  return (h[0] & 1) === 1
}

// Validate one judge reply against JUDGE_SCHEMA + the evidence-non-empty rule. Returns
// {ok, error?}. Fail-closed: anything malformed is rejected, never coerced.
export function validateReply(r) {
  if (!r || typeof r !== 'object') return { ok: false, error: 'reply is not an object' }
  if (!r.dimensions || !r.overall) return { ok: false, error: 'missing dimensions/overall' }
  for (const k of DIM_KEYS) {
    const d = r.dimensions[k]
    if (!d) return { ok: false, error: `missing dimension ${k}` }
    for (const f of ['left_score', 'right_score']) {
      if (!Number.isInteger(d[f]) || d[f] < 1 || d[f] > 5) return { ok: false, error: `${k}.${f} not an int 1-5` }
    }
    if (!['LEFT', 'RIGHT', 'TIE'].includes(d.winner)) return { ok: false, error: `${k}.winner invalid` }
    if (!d.evidence || !String(d.evidence).trim()) return { ok: false, error: `${k}.evidence empty (evidence is mandatory)` }
    // Internal consistency: equal scores MUST be a TIE; a strict winner must match the higher score.
    if (d.left_score === d.right_score && d.winner !== 'TIE') return { ok: false, error: `${k}: equal scores but winner=${d.winner}` }
    if (d.left_score > d.right_score && d.winner === 'RIGHT') return { ok: false, error: `${k}: LEFT scored higher but winner=RIGHT` }
    if (d.right_score > d.left_score && d.winner === 'LEFT') return { ok: false, error: `${k}: RIGHT scored higher but winner=LEFT` }
  }
  const o = r.overall
  if (!['LEFT', 'RIGHT', 'TIE'].includes(o.winner)) return { ok: false, error: 'overall.winner invalid' }
  if (!['low', 'medium', 'high'].includes(o.confidence)) return { ok: false, error: 'overall.confidence invalid' }
  if (!o.rationale || !String(o.rationale).trim()) return { ok: false, error: 'overall.rationale empty' }
  return { ok: true }
}

// Map a reply's LEFT/RIGHT (positional) back to the ABSOLUTE arms A/B, given which arm was LEFT in
// that run. Returns per-dim {aScore,bScore,winner∈{A,B,TIE}} + overall winner∈{A,B,TIE}.
function deblind(reply, leftArm /* 'A' | 'B' */) {
  const rightArm = leftArm === 'A' ? 'B' : 'A'
  const posToArm = pos => pos === 'LEFT' ? leftArm : pos === 'RIGHT' ? rightArm : 'TIE'
  const dims = {}
  for (const k of DIM_KEYS) {
    const d = reply.dimensions[k]
    dims[k] = {
      aScore: leftArm === 'A' ? d.left_score : d.right_score,
      bScore: leftArm === 'A' ? d.right_score : d.left_score,
      winner: posToArm(d.winner),
      evidence: d.evidence,
    }
  }
  return { dims, overall: posToArm(reply.overall.winner), confidence: reply.overall.confidence, rationale: reply.overall.rationale }
}

// ───────────────────────────── aggregation + verdict logic ─────────────────────────────
// Two de-blinded results (run1, run2) — one per order. Combine into a final, position-bias-robust
// verdict. This is the heart of the protocol.
export function aggregate(run1, run2) {
  // Per-dimension: average the two absolute scores per arm, and reconcile the two winners.
  // A dimension winner only "counts" if BOTH orders agree (or one says TIE) — a flip is a wash.
  const dimensions = {}
  let weightedA = 0, weightedB = 0, totalW = 0
  const flips = []
  for (const d of DIMENSIONS) {
    const k = d.key
    const aAvg = (run1.dims[k].aScore + run2.dims[k].aScore) / 2
    const bAvg = (run1.dims[k].bScore + run2.dims[k].bScore) / 2
    const w1 = run1.dims[k].winner, w2 = run2.dims[k].winner
    let winner
    if (w1 === w2) winner = w1                                   // both orders agree
    else if (w1 === 'TIE') winner = w2                           // one abstains → take the other
    else if (w2 === 'TIE') winner = w1
    else { winner = 'TIE (position-flip)'; flips.push(k) }       // A↔B disagreement ⇒ artifact ⇒ wash
    weightedA += aAvg * d.weight; weightedB += bAvg * d.weight; totalW += d.weight
    dimensions[k] = {
      weight: d.weight,
      aScore: round1(aAvg), bScore: round1(bAvg), winner,
      evidence: { order1: run1.dims[k].evidence, order2: run2.dims[k].evidence },
    }
  }
  const aWeighted = round2(weightedA / totalW), bWeighted = round2(weightedB / totalW)

  // Overall verdict reconciliation:
  //  - both orders name the same arm  → that arm WINS (confidence from agreement strength).
  //  - orders flip (A then B / B then A) → INCONCLUSIVE: the verdict is position-driven, not quality.
  //  - one TIE + one arm             → WEAK win for that arm (note the abstain).
  //  - both TIE                       → TIE.
  const o1 = run1.overall, o2 = run2.overall
  let verdict, note
  if (o1 === o2 && o1 !== 'TIE') { verdict = o1; note = `both orders independently chose ${o1}` }
  else if (o1 === 'TIE' && o2 === 'TIE') { verdict = 'TIE'; note = 'both orders called it a tie' }
  else if (o1 === 'TIE' || o2 === 'TIE') { verdict = o1 === 'TIE' ? o2 : o1; note = `weak: one order chose ${verdict}, the other tied` }
  else { verdict = 'INCONCLUSIVE'; note = `position flip: order1 chose ${o1}, order2 chose ${o2} — verdict tracked position, not quality` }

  // The weighted score gap is a SECONDARY signal. If the overall verdict is INCONCLUSIVE/TIE but the
  // averaged weighted scores diverge by a clear margin AND no dimension flipped, surface a tiebreak
  // LEAN (never a "win") so a human has a steer — but the headline verdict stays honest.
  const gap = round2(Math.abs(aWeighted - bWeighted))
  let lean = null
  if ((verdict === 'TIE' || verdict === 'INCONCLUSIVE') && !flips.length && gap >= 0.5) {
    lean = aWeighted > bWeighted ? 'A' : 'B'
  }

  return {
    verdict,                                  // 'A' | 'B' | 'TIE' | 'INCONCLUSIVE'
    note,
    positionFlipDimensions: flips,            // dims whose winner flipped with order (bias evidence)
    weighted: { A: aWeighted, B: bWeighted, gap, lean },
    dimensions,
    perOrder: {
      order1: { left: run1._leftArm, overall: o1, confidence: run1.confidence, rationale: run1.rationale },
      order2: { left: run2._leftArm, overall: o2, confidence: run2.confidence, rationale: run2.rationale },
    },
  }
}
const round1 = n => Math.round(n * 10) / 10
const round2 = n => Math.round(n * 100) / 100

// ───────────────────────────── orchestration ─────────────────────────────
// One full comparison: build the two blind prompts (A-left and B-left), obtain a judgement for
// each via `judge`, validate, de-blind, aggregate. `judge` is async (prompt)=>object.
// Exported so the Workflow can drive it with its own opus `agent()` as the judge.
export async function runQualityDiff({ spec, aDiff, bDiff, aLabel = 'A', bLabel = 'B', seed, judge }) {
  const firstLeftIsA = seededFlip(seed, 'first-order')          // cosmetic: which arm prints LEFT first
  // Order 1 and Order 2 are ALWAYS the two swaps — the seed only chooses which we call "order1".
  const orders = firstLeftIsA
    ? [{ leftArm: 'A', leftDiff: aDiff, rightDiff: bDiff }, { leftArm: 'B', leftDiff: bDiff, rightDiff: aDiff }]
    : [{ leftArm: 'B', leftDiff: bDiff, rightDiff: aDiff }, { leftArm: 'A', leftDiff: aDiff, rightDiff: bDiff }]

  const runs = []
  for (const ord of orders) {
    const prompt = buildJudgePrompt({ spec, leftDiff: ord.leftDiff, rightDiff: ord.rightDiff })
    const reply = await judge(prompt)
    const v = validateReply(reply)
    if (!v.ok) { const e = new Error(`judge reply failed schema (order left=${ord.leftArm}): ${v.error}`); e.code = 3; throw e }
    const db = deblind(reply, ord.leftArm); db._leftArm = ord.leftArm
    runs.push(db)
  }
  const result = aggregate(runs[0], runs[1])
  // De-blind the human-facing labels ONLY now, after scoring is locked.
  result.arms = { A: aLabel, B: bLabel }
  result.seed = seed
  return result
}

// ───────────────────────────── CLI ─────────────────────────────
async function main() {
  const { a } = parseArgs(process.argv.slice(2))
  if (a.help || !a.spec) {
    process.stdout.write(readFileSync(new URL(import.meta.url)).toString().split('\n')
      .filter(l => l.startsWith('//')).slice(0, 46).map(l => l.replace(/^\/\/ ?/, '')).join('\n') + '\n')
    process.exit(a.spec ? 0 : 2)
  }
  const spec = readFileSync(a.spec, 'utf8')
  const repo = a.repo || process.cwd()
  const seed = a.seed != null ? String(a.seed) : String(Date.now())
  const aDiff = resolveDiff(a.a, a['a-file'], repo, 'A')
  const bDiff = resolveDiff(a.b, a['b-file'], repo, 'B')
  const aLabel = a['a-label'] || 'A', bLabel = a['b-label'] || 'B'

  // --judge print + --ingest f1 f2 : aggregate two already-collected judge replies.
  if (a.ingest) {
    const firstLeftIsA = seededFlip(seed, 'first-order')
    const leftArms = firstLeftIsA ? ['A', 'B'] : ['B', 'A']
    const runs = a.ingest.map((f, i) => {
      const reply = JSON.parse(readFileSync(f, 'utf8'))
      const v = validateReply(reply)
      if (!v.ok) die(`ingest ${f}: ${v.error}`, 3)
      const db = deblind(reply, leftArms[i]); db._leftArm = leftArms[i]
      return db
    })
    const result = aggregate(runs[0], runs[1]); result.arms = { A: aLabel, B: bLabel }; result.seed = seed
    emit(result, a.out); return
  }

  // Build the judge function.
  let judge
  if (!a.judge || a.judge === 'print') {
    // Print both blind prompts and stop — the human runs them and re-invokes with --ingest.
    const firstLeftIsA = seededFlip(seed, 'first-order')
    const orders = firstLeftIsA
      ? [{ l: aDiff, r: bDiff }, { l: bDiff, r: aDiff }]
      : [{ l: bDiff, r: aDiff }, { l: aDiff, r: bDiff }]
    orders.forEach((o, i) => {
      process.stdout.write(`\n===== ORDER ${i + 1} PROMPT (give to a fresh capable-model judge; save its JSON) =====\n`)
      process.stdout.write(buildJudgePrompt({ spec, leftDiff: o.l, rightDiff: o.r }) + '\n')
    })
    process.stderr.write(`\nseed=${seed}. Collect the two JSON replies, then:\n  node quality-diff.mjs --spec ${a.spec} --a '${a.a}' --b '${a.b}' --seed ${seed} --ingest order1.json order2.json\n`)
    return
  }
  if (typeof a.judge === 'string' && a.judge.startsWith('cmd:')) {
    const shell = a.judge.slice(4)
    judge = async (prompt) => {
      const out = execFileSync('/bin/sh', ['-c', shell], { input: prompt, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
      // tolerate a model wrapping JSON in prose/fences — extract the outermost {...}
      const m = out.match(/\{[\s\S]*\}/); if (!m) die(`judge cmd returned no JSON:\n${out.slice(0, 400)}`, 3)
      return JSON.parse(m[0])
    }
  } else die(`unknown --judge mode '${a.judge}' (use print | cmd:<shell>)`)

  try {
    const result = await runQualityDiff({ spec, aDiff, bDiff, aLabel, bLabel, seed, judge })
    emit(result, a.out)
  } catch (e) { die(e.message, e.code || 1) }
}

function emit(result, out) {
  const json = JSON.stringify(result, null, 2)
  if (out) { writeFileSync(out, json + '\n'); process.stderr.write(`wrote ${out}\n`) }
  else process.stdout.write(json + '\n')
  // One-line human headline on stderr so a pipeline can read JSON on stdout cleanly.
  const w = result.verdict
  const head = w === 'A' ? `WINNER: ${result.arms.A}` : w === 'B' ? `WINNER: ${result.arms.B}`
    : w === 'TIE' ? 'TIE' : 'INCONCLUSIVE (position-dependent)'
  const leanStr = result.weighted.lean ? ` · lean ${result.arms[result.weighted.lean]} (Δ${result.weighted.gap})` : ''
  process.stderr.write(`\n${head}${leanStr} — ${result.note}\n`)
}

// run as CLI only (importable as a module otherwise)
if (import.meta.url === `file://${process.argv[1]}`) main()
