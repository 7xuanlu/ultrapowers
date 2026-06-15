export const meta = {
  name: 'ultrapowers-development',
  description: 'Dynamic SDD-disciplined build harness. Plans goal into tasks, then per task (SERIAL): pluggable implementer (codex via `codex exec` batch, gemini via CLI MCP, or claude direct) with strict TDD red-green-refactor → deterministic gate → two-stage Opus review (spec-compliance THEN code-quality, both fail-closed, SDD-faithful prompts) → fix-loop; dry-until-clean critic adds tasks mid-run; final adversarial integration review. Model-routed: cheap for mechanical impl, capable for review/planning. Crash-resumable. Tight return.',
  whenToUse: 'Unattended multi-task / whole-goal implementation: hand it args.tasks OR args.goal and it plans, builds, reviews, and loops until a critic says done — implementer discipline from superpowers TDD/SDD, all decisions agent-made.',
  // Only Plan + Preflight are DECLARED here (they always run first, so they anchor slots 1-2).
  // The per-task BUILD work and the final INTEGRATE review are intentionally NOT declared — they use
  // DYNAMIC progress groups (`task:<id>` per task, then `Integrate`) created as they run. The /workflows UI
  // lists declared phases first, then appends dynamic groups; declaring Build/Integrate here would (a) leave
  // an empty "Build" placeholder, since build agents are tagged `task:<id>`, not "Build", and (b) list
  // "Integrate" ABOVE the task groups even though it runs last. Leaving them dynamic makes the list render in
  // true execution order: Plan → Preflight → task:<id>… → Integrate. Each task:<id> group holds that task's
  // full impl→verify→review→fix lifecycle (agent labels inside reveal the action).
  phases: [
    { title: 'Plan',      detail: 'decompose args.goal into tasks; dry-until-clean critic', model: 'opus' },
    { title: 'Preflight', detail: 'verify implementer CLI MCP reachable + repo-scoped; SP drift check; load resume log' },
  ],
}

// ---- accepted divergences from native SDD (fundamental Workflow constraints, NOT fixable here) ----
// N4  Fix-loop spawns a FRESH agent (threading issues+files+summary), not SDD's warm same-subagent —
//     Workflow subagents are stateless one-shots; the code-on-disk + threaded context is the mitigation.
// N5  No mid-run clarifying questions (Workflow can't pause for human input) — maps to needs_context escalation.
// N9  Crash mid-fix-loop (committed but not checkpointed) is replayed from a post-partial base — low-probability;
//     for commit:true runs, a manual `git status` check after a crash is advised. (Documented, not auto-handled.)
// N11 No TodoWrite live progress UI — replaced by the JSONL checkpoint (functional resume parity, UI loss only).

// ---- schemas ----
const IMPL = { type: 'object', required: ['status'], properties: {
  status: { enum: ['done', 'done_with_concerns', 'needs_context', 'blocked', 'failed'] },
  files: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' }, concerns: { type: 'string' } } }
// N1: SDD-faithful structured review — severity tiers (critical/important block; minor logged),
// strengths + assessment for calibration (SDD code-reviewer.md). The harness derives blocking
// from findings, not from the model's `approved` boolean alone.
const FINDING = { type: 'object', required: ['severity', 'issue'], properties: {
  severity: { enum: ['critical', 'important', 'minor'] }, issue: { type: 'string' }, fix: { type: 'string' } } }
const REVIEW = { type: 'object', required: ['approved'], properties: {
  approved: { type: 'boolean' },
  findings: { type: 'array', items: FINDING },
  strengths: { type: 'array', items: { type: 'string' } },
  assessment: { type: 'string' } } }
// N8: verify returns the RAW exit code (harness compares ===0) — haiku copies an integer, never judges pass/fail.
const VERIFY = { type: 'object', required: ['code'], properties: { code: { type: 'integer' }, tail: { type: 'string' } } }
const REDWITNESS = { type: 'object', required: ['applicable', 'redWitnessed'], properties: {
  applicable: { type: 'boolean' }, redWitnessed: { type: 'boolean' }, detail: { type: 'string' } } }
const PREFLIGHT = { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' }, detail: { type: 'string' } } }
const DONELIST = { type: 'object', required: ['done'], properties: { done: { type: 'array', items: { type: 'string' } } } }
const SPVER = { type: 'object', required: ['installed'], properties: { installed: { type: 'array', items: { type: 'string' } } } }
const TASK = { type: 'object', required: ['id', 'spec'], properties: { id: { type: 'string' }, spec: { type: 'string' } } }
const PLAN = { type: 'object', required: ['tasks'], properties: { tasks: { type: 'array', items: TASK } } }
// N2: graduated-BLOCKED step 3 — split a too-large blocked task into smaller pieces before human escalation.
const DECOMP = { type: 'object', required: ['atomic'], properties: {
  atomic: { type: 'boolean' }, subtasks: { type: 'array', items: TASK } } }
// N3: triage a DONE_WITH_CONCERNS report — correctness/scope concerns get addressed before review (SDD).
const TRIAGE = { type: 'object', required: ['addressFirst'], properties: { addressFirst: { type: 'boolean' }, why: { type: 'string' } } }
const CRITIC = { type: 'object', required: ['clean'], properties: {
  clean: { type: 'boolean' }, gaps: { type: 'array', items: { type: 'string' } }, newTasks: { type: 'array', items: TASK } } }

// N1 helpers: blocking findings = critical|important (minor never blocks the fix-loop).
const blocking = rev => (rev.findings || []).filter(f => f.severity === 'critical' || f.severity === 'important')
const minorsOf = rev => (rev.findings || []).filter(f => f.severity === 'minor').map(f => f.issue)
const fmtFindings = fs => fs.map(f => `[${f.severity}] ${f.issue}${f.fix ? ` — suggested fix: ${f.fix}` : ''}`)

// ---- args normalization ----
// The Workflow framework delivers `args` as a JSON STRING, not an object. Parse it once.
const _args = (typeof args === 'string') ? JSON.parse(args) : (args || {})

// ---- knobs ----
const RETRY = 2          // implementer transient-failure attempts before capable fallback
const MAX_FIX = 3        // gate/spec/quality -> fix rounds per task
const REVIEW_RETRY = 1   // reviewer-error retries before failing CLOSED
const OUTAGE_STREAK = 3  // consecutive fallbacks => degraded (likely correlated outage)

const tasks     = _args.tasks     || []
const goal      = _args.goal      || null
const verifyCmd = _args.verifyCmd  || null
const logFile   = _args.logFile    || null
const doCommit  = !!_args.commit
const MAX_ROUNDS = _args.maxRounds || 3
const MAX_TASKS  = _args.maxTasks  || 50
const BUDGET_RESERVE = 50_000

// Anti-drift pin: the TDD_SKILL / SDD_GUIDANCE / reviewer language below were sourced VERBATIM
// from this superpowers version. The Workflow JS sandbox has no filesystem access (can't live-read),
// and reading a 370-line SKILL.md back through a subagent risks paraphrase — so we EMBED verbatim and
// make drift VISIBLE: a startup check warns if the installed superpowers differs from this pin.
// RE-SYNC on a version bump: re-copy the skill files from
//   ~/.claude/plugins/cache/claude-plugins-official/superpowers/<new>/skills/{test-driven-development,subagent-driven-development}/
const SP_VERSION = '5.1.0'

// Pluggable implementer + model routing (SDD: least-powerful-per-role).
// 'codex'|'gemini' = cheap external CLI via its own CLI MCP tool + capable Claude fallback.
// 'claude' = direct Claude; uses implModel (default 'sonnet' = cheap for mechanical tasks).
// `let`: preflight may downgrade gemini->claude on a cwd mismatch (the gemini MCP has no cwd param).
let IMPLEMENTER = _args.implementer || 'codex'
const isExternal = () => IMPLEMENTER === 'codex' || IMPLEMENTER === 'gemini'
// Model routing: implementer gets cheap model; reviewers/critic/integration get capable model.
// SDD: "Mechanical implementation tasks (isolated functions, clear specs, 1-2 files): use a fast, cheap model."
// SDD: "Architecture, design, and review tasks: use the most capable available model."
const IMPL_MODEL = _args.implModel || 'sonnet'    // cheap for mechanical impl (SDD principle)
// Optional codex model + reasoning override (e.g. codexModel:'gpt-5.5', codexReasoning:'xhigh').
// Unset -> codex uses its own configured default. Maps to `codex exec -m <model> -c model_reasoning_effort=<eff>`.
const CODEX_MODEL = _args.codexModel || null
const CODEX_REASONING = _args.codexReasoning || null
// Hard cap (ms) on a single `codex exec` call — passed as the Bash tool's timeout so a hung codex is KILLED
// and the harness can retry/fallback. (The persistent-MCP path had NO timeout, which is why a hang stalled the
// whole run until the workflow's duration cap.) Bash tool max is 600_000.
const CODEX_TIMEOUT_MS = _args.codexTimeoutMs || 420_000
// #1: hard cap (ms) on the deterministic gate (verifyCmd) — passed as the Bash tool timeout so a HANGING test
// (infinite loop in the code) is killed and the harness re-implements, instead of stalling the run (same hang
// class we fixed for codex, but for the gate). A timeout surfaces as exit 124 = not passed.
const VERIFY_TIMEOUT_MS = _args.verifyTimeoutMs || 180_000
// #3: optional FINAL full-suite gate. Per-task verify (verifyCmd) should be FAST/scoped so the fix-loop isn't
// paying the whole suite every round; pass fullVerifyCmd to run the comprehensive suite ONCE at integration.
// Null = the integration gate reuses verifyCmd.
const FULL_VERIFY_CMD = _args.fullVerifyCmd || null
// P1-strip re-witness RED (empirically motivated, near-zero cost): after the gate is GREEN, revert ONLY this
// task's PRODUCTION files to their pre-task state (keeping the new tests) and re-run the suite. A correct test
// MUST go red without its implementation; if the suite still PASSES, the test does not exercise the new code
// (vacuous / non-dependent) -> send back to the implementer. A 14-chain study (haiku+sonnet, 7 pure-fn tasks)
// found 0 weak tests so this fired 0 false positives there; it exists to close the ONE failure mode two-stage
// LLM review can miss on non-trivial code — a test that doesn't depend on the impl at all. Needs per-task
// commits (commit:true) so the revert is exact and restorable from HEAD. Off via redWitness:false.
const RED_WITNESS = _args.redWitness !== false
// loop-until-clean (the dry-until-clean completeness critic that ADDS net-new tasks mid-run) is an
// OPT-IN FEATURE, not always-on. In goal-mode it now defaults OFF: plan once, build those tasks, stop.
// Set loopUntilClean:true to let the critic inspect the tree, find gaps, inject new tasks, and loop
// until clean (or the maxRounds/budget ceiling). Tasks-mode never ran the critic regardless of this.
// Rationale: the critic spends unbounded extra tokens/time on its own judgement — that cost should be
// a deliberate choice, not a silent default. (See docs/design/gating-and-escalation.md.)
const LOOP_UNTIL_CLEAN = _args.loopUntilClean === true
// Reviews/critic/integration always use 'opus' (hardcoded in their agent() calls).
// The codex/gemini DELEGATION wrapper (a claude subagent that just drives the external CLI's MCP tool)
// is a mechanical relay + light sanity-check, NOT a judgment task — the real adversarial scrutiny is the
// two downstream opus reviewers. So it runs on the cheapest tier, never opus. Without an explicit model it
// would inherit the session default (opus) = a senior model hired to press a button. It's a PURE relay, so
// haiku is enough — "pass the brief verbatim" + retry/fallback cover any fumble. Preflight probes are
// likewise trivial (path compare) -> haiku. Bump to 'sonnet' only if false fallbacks start appearing.
const CLI_WRAPPER_MODEL = 'haiku'

// repoDir: the target repo. Workflow subagents inherit the MAIN SESSION's cwd, which is NOT
// necessarily the repo being built (cross-repo run, OR a worktree created by /ultrapowers G1).
// Every git/bash op must be rooted here or it silently operates on the wrong tree.
// Omit when the session cwd IS the target repo (the common case).
const repoDir = _args.repoDir || null
const GIT = repoDir ? `git -C ${repoDir}` : 'git'   // scoped git — never the session cwd's repo
const REPO_NOTE = repoDir
  ? `\n\nWORKING DIRECTORY (MANDATORY): All work happens in ${repoDir}. Every bash command must \`cd ${repoDir}\` first; every git command must use \`git -C ${repoDir}\`. Do NOT touch any other repository.`
  : ''

let fallbackStreak = 0, degraded = false
const DONE_OK = new Set(['done', 'done_with_concerns'])

// ---- TDD discipline (VERBATIM from superpowers:test-driven-development SKILL.md) ----
// This IS the superpowers TDD skill content — not a paraphrase, not a brief.
// Superpowers TDD is also a prompt-level skill (not an enforcement gate), so using the
// same verbatim text gives EXACT behavioral parity. No drift.
const TDD_SKILL = `
# Test-Driven Development (TDD)

Write the test first. Watch it fail. Write minimal code to pass.

**Core principle:** If you didn't watch the test fail, you don't know if it tests the right thing.

**Violating the letter of the rules is violating the spirit of the rules.**

## The Iron Law

NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST

Write code before the test? Delete it. Start over.

**No exceptions:**
- Don't keep it as "reference"
- Don't "adapt" it while writing tests
- Don't look at it
- Delete means delete

Implement fresh from tests. Period.

## Red-Green-Refactor

### RED - Write Failing Test

Write one minimal test showing what should happen.

**Requirements:**
- One behavior
- Clear name (describes behavior, not "test1")
- Real code (no mocks unless unavoidable)

### Verify RED - Watch It Fail

**MANDATORY. Never skip.**

Run the test suite. Confirm:
- Test fails (not errors)
- Failure message is expected
- Fails because feature missing (not typos)

**Test passes?** You're testing existing behavior. Fix test.
**Test errors?** Fix error, re-run until it fails correctly.

### GREEN - Minimal Code

Write simplest code to pass the test. Don't add features, refactor other code, or "improve" beyond the test.

### Verify GREEN - Watch It Pass

**MANDATORY.**

Run the test suite. Confirm:
- Test passes
- Other tests still pass
- Output pristine (no errors, warnings)

**Test fails?** Fix code, not test.
**Other tests fail?** Fix now.

### REFACTOR - Clean Up

After green only:
- Remove duplication
- Improve names
- Extract helpers

Keep tests green. Don't add behavior.

### Repeat

Next failing test for next feature.

## Red Flags - STOP and Start Over

- Code before test
- Test after implementation
- Test passes immediately
- Can't explain why test failed
- Tests added "later"
- Rationalizing "just this once"
- "I already manually tested it"
- "Tests after achieve the same purpose"
- "Keep as reference" or "adapt existing code"
- "TDD is dogmatic, I'm being pragmatic"

**All of these mean: Delete code. Start over with TDD.**

## Verification Checklist

Before marking work complete:
- Every new function/method has a test
- Watched each test fail before implementing
- Each test failed for expected reason (feature missing, not typo)
- Wrote minimal code to pass each test
- All tests pass
- Output pristine (no errors, warnings)
- Tests use real code (mocks only if unavoidable)
- Edge cases and errors covered

Can't check all boxes? You skipped TDD. Start over.

## Final Rule

Production code -> test exists and failed first
Otherwise -> not TDD

No exceptions.`

// N6: Code-Organization + escalation guidance, sourced verbatim from superpowers implementer-prompt.md.
const SDD_GUIDANCE = `
## Code Organization
- Each file should have one clear responsibility with a well-defined interface.
- Follow the file structure implied by the task. In existing codebases, follow established patterns — improve code you're touching the way a good developer would, but do NOT restructure things outside your task.
- If a file you're creating is growing beyond the task's intent, STOP and report "done_with_concerns" — do NOT split files on your own without guidance.

## When You're in Over Your Head
It is always OK to stop and say "this is too hard for me." Bad work is worse than no work — you will NOT be penalized for escalating. STOP and report "blocked" or "needs_context" when:
- The task requires architectural decisions with multiple valid approaches.
- You need to understand code beyond what was provided and can't find clarity.
- You feel uncertain whether your approach is correct.
- You've been reading file after file trying to understand the system without progress.`

// ---- implementer ----
// Pluggable: cheap external CLI with capable Claude fallback, or Claude direct with model routing.
//  • codex  -> `codex exec` (non-interactive batch) run via Bash — fresh ephemeral process per task, NO
//    persistent MCP server (that accumulated/wedged). Needs Bash(codex *) allow + sandbox.excludedCommands.
//  • gemini -> mcp__gemini-cli__ask-gemini (still its MCP; ask-gemini is request/response, not a long session).
// The external CLI runs inside a Workflow subagent that drives it, then independently verifies the diff
// (do not trust the CLI's self-report) and returns structured status.
async function implement(task, issues, prior) {
  const ctx = [
    issues && issues.length ? `A prior check REJECTED the work. This is a FRESH session (N4) — the prior attempt's code is ALREADY on disk; run \`${GIT} diff\` FIRST to see the current state, then fix EXACTLY these issues:\n- ${issues.join('\n- ')}` : '',
    prior ? `Your previous attempt changed ${JSON.stringify(prior.files || [])} (summary: ${prior.summary || 'n/a'}).` : '',
  ].filter(Boolean).join('\n')
  const brief =
    `TASK ${task.id}:\n${task.spec}\n${ctx}` + REPO_NOTE + '\n' +
    TDD_SKILL + '\n' +
    SDD_GUIDANCE + '\n\n' +
    `The TDD discipline above IS the verbatim superpowers:test-driven-development skill. If your environment also exposes it natively, invoke it — same content, just confirming adherence.` +
    (doCommit ? `\n\nAfter all tests green + self-review clean: commit with message "[task:${task.id}] <one-line summary>".` : '') +
    `\n\n## Report\nReturn {status, files:[paths changed], summary, concerns?}.\n` +
    `status values: "done" (complete), "done_with_concerns" (complete but doubts — explain in concerns),\n` +
    `"needs_context" (spec insufficient — say what's missing), "blocked" (cannot proceed — say why).\n` +
    `Use "failed" ONLY for a transient tool/transport error (will be retried). Never silently produce work you're unsure about.`

  if (isExternal()) {
    // Per-CLI delegation prompt for the wrapper subagent. It must FIRST ToolSearch-load the
    // DEFERRED MCP tool (a fresh subagent doesn't have it), delegate the brief, then independently
    // verify the diff (do not trust the CLI's self-report) and return structured status.
    const cliPrompt = () => {
      if (IMPLEMENTER === 'codex') {
        // B (durable): run codex in NON-INTERACTIVE batch mode (`codex exec`) via Bash, NOT the persistent
        // mcp__codex__codex server. The MCP server is a long-lived stateful session host — fine interactively,
        // but for one-shot subagent dispatch its server/session processes accumulate and wedge (observed: 5
        // stale servers + a 4-day ghost tree -> transport hangs). `codex exec --ephemeral` is a fresh process
        // that exits when done: no accumulation, no shared backend to wedge, and a hard Bash-tool timeout.
        // SETTINGS REQUIRED: permissions.allow must include `Bash(codex *)`, and sandbox.excludedCommands must
        // include `codex` — codex's in-process app-server cannot start under the CC sandbox (proved), so codex
        // itself must run unsandboxed; it still confines the MODEL's own shell commands via `-s workspace-write`.
        const modelFlag  = CODEX_MODEL ? ` -m ${CODEX_MODEL}` : ''
        const reasonFlag = CODEX_REASONING ? ` -c model_reasoning_effort=${CODEX_REASONING}` : ''
        const briefFile  = `/tmp/up-codex-${task.id}.txt`
        const cmd = `codex exec --cd ${repoDir || '.'} --ephemeral --skip-git-repo-check -s workspace-write${modelFlag}${reasonFlag} - < ${briefFile}`
        return (
          `Implement this with the Codex CLI in NON-INTERACTIVE batch mode (codex exec). Do NOT use any MCP tool.\n\n` +
          `STEP 1 — write the BRIEF below VERBATIM (no edits, no summarizing) to ${briefFile} using the Write tool.\n` +
          `STEP 2 — run EXACTLY this with the Bash tool, and SET the Bash tool \`timeout\` parameter to ${CODEX_TIMEOUT_MS} (ms) — a hard cap that kills a hung codex:\n` +
          `    ${cmd}\n` +
          `  codex runs autonomously in ${repoDir || 'this repo'}: writes the failing test FIRST, then the code, runs the suite, and commits. Batch mode needs no approvals.\n` +
          `  If the Bash call times out, OR codex exits non-zero with a startup/transport error (e.g. "failed to initialize ... app-server", or a network error) -> report status:"failed" (it will be retried).\n` +
          `STEP 3 — after codex returns, INDEPENDENTLY verify (do NOT trust codex's stdout): inspect \`${GIT} diff\` / \`${GIT} status\` and read the changed files, then report {status, files:[changed paths], summary, concerns?}.\n` +
          `status:"failed" ONLY for a codex timeout/startup/transport error.\n\n` +
          `--- BRIEF (write to ${briefFile} verbatim) ---\n${brief}`)
      }
      // gemini — ask-gemini has NO cwd param; it runs in the MCP server's launch dir, which preflight
      // verified is the target repo (else the implementer was already downgraded to claude).
      return (
        `Delegate this implementation to the Gemini CLI via its MCP tool, then verify and report.\n\n` +
        `STEP 1 — the tool is DEFERRED: call ToolSearch with query "select:mcp__gemini-cli__ask-gemini" to load its schema.\n` +
        `STEP 2 — call mcp__gemini-cli__ask-gemini with sandbox:false and prompt = the full BRIEF below, verbatim. ` +
        `Gemini operates in its own working directory (already verified to be this repo) — it writes the failing test first, then the code, runs the suite, and commits.\n` +
        `STEP 3 — after gemini returns, INDEPENDENTLY verify: inspect \`${GIT} diff\` / \`${GIT} status\`, then report {status, files, summary, concerns?}.\n` +
        `status:"failed" ONLY for a gemini MCP transport error/timeout (it will be retried).\n\n` +
        `--- BRIEF FOR GEMINI ---\n${brief}`)
    }
    for (let a = 0; a <= RETRY; a++) {
      const r = await agent(cliPrompt(),
        { label: `${IMPLEMENTER}:${task.id}#${a + 1}`, phase: `task:${task.id}`, model: CLI_WRAPPER_MODEL, schema: IMPL })
      if (r && DONE_OK.has(r.status)) { fallbackStreak = 0; return { ...r, by: IMPLEMENTER } }
      if (r && (r.status === 'blocked' || r.status === 'needs_context')) break
      log(`${IMPLEMENTER} failed on ${task.id} (attempt ${a + 1}/${RETRY + 1})`)
    }
    fallbackStreak++
    if (fallbackStreak >= OUTAGE_STREAK) { degraded = true; log(`DEGRADED: ${fallbackStreak} consecutive ${IMPLEMENTER} fallbacks — likely correlated outage`) }
    // B1 fix: fallback MUST use a capable model (opus), not inherit the session default.
    // SDD: "re-dispatch with a more capable model" (SKILL.md line 116).
    const c = await agent(
      `${IMPLEMENTER} could not complete this (transient failure or BLOCKED). Implement task ${task.id} YOURSELF (the more-capable fallback).\n\n${brief}\n\n` +
      `status:"blocked" ONLY if it genuinely cannot be done as specified.`,
      { label: `claude-fallback:${task.id}`, phase: `task:${task.id}`, model: 'opus', schema: IMPL })
    return c ? { ...c, by: 'claude-fallback' } : { status: 'failed', by: 'none' }
  }

  // implementer === 'claude': direct, model-routed (cheap for mechanical impl).
  // B2 fix: if cheap model fails all retries, escalate to opus once (SDD: "re-dispatch with a more capable model").
  for (let a = 0; a <= RETRY; a++) {
    const r = await agent(
      `Implement task ${task.id} YOURSELF in this repo (no external CLI).\n\n${brief}`,
      { label: `claude:${task.id}#${a + 1}`, phase: `task:${task.id}`, model: IMPL_MODEL, schema: IMPL })
    if (r && DONE_OK.has(r.status)) return { ...r, by: 'claude' }
    if (r && (r.status === 'blocked' || r.status === 'needs_context')) {
      // Escalate to capable model before giving up (SDD graduated response step 2)
      if (IMPL_MODEL !== 'opus') {
        log(`${task.id}: ${r.status} at ${IMPL_MODEL} — escalating to opus`)
        const esc = await agent(
          `A cheaper model (${IMPL_MODEL}) reported "${r.status}" on this task. You are the more-capable escalation. Implement task ${task.id} YOURSELF.\n\n${brief}`,
          { label: `claude-escalate:${task.id}`, phase: `task:${task.id}`, model: 'opus', schema: IMPL })
        if (esc && DONE_OK.has(esc.status)) return { ...esc, by: 'claude-escalated' }
      }
      return { ...r, by: 'claude' }
    }
    log(`claude impl failed on ${task.id} (attempt ${a + 1}/${RETRY + 1})`)
  }
  // All retries at cheap model exhausted — one final attempt at opus
  if (IMPL_MODEL !== 'opus') {
    log(`${task.id}: ${RETRY + 1} failures at ${IMPL_MODEL} — final escalation to opus`)
    const esc = await agent(
      `A cheaper model (${IMPL_MODEL}) failed ${RETRY + 1} times on this task. You are the more-capable fallback. Implement task ${task.id} YOURSELF.\n\n${brief}`,
      { label: `claude-escalate:${task.id}`, phase: `task:${task.id}`, model: 'opus', schema: IMPL })
    if (esc) return { ...esc, by: 'claude-escalated' }
  }
  return { status: 'failed', by: 'claude' }
}

// Deterministic project gate — runs the REAL command so approval never rests on a self-report.
async function verify(task) {
  if (!verifyCmd) return { passed: true, tail: '(no args.verifyCmd — deterministic gate skipped; LLM review only)' }
  // N8: the agent does NOT judge pass/fail. It runs the command, captures the real exit code via a
  // marker, and copies the integer. The HARNESS decides passed = (code === 0) — deterministic.
  // #1 TIMEOUT: a hanging test (infinite loop in the code) must not stall the run. The agent sets the Bash
  // tool timeout; if the command is killed for running too long, that is exit 124 = not passed = re-implement.
  const v = await agent(
    `Run this project's verify command with Bash, then capture its exit code. SET the Bash tool \`timeout\` parameter to ${VERIFY_TIMEOUT_MS} (ms). Run EXACTLY this (do NOT edit any files):\n` +
    `  ${verifyCmd}; echo "__RC__=$?"\n` +
    `If the Bash call TIMES OUT (the command hung), return {code:124, tail:"verify TIMED OUT after ${VERIFY_TIMEOUT_MS}ms — likely an infinite loop / hang in the code"}.\n` +
    `Otherwise find the line "__RC__=<n>" in the output and return {code:<that integer n, e.g. 0 or 1>, tail:"last ~20 lines of output"}. Do NOT interpret — just copy the integer.`,
    { label: `verify:${task.id}`, phase: `task:${task.id}`, model: 'haiku', schema: VERIFY })
  if (!v) return { passed: false, tail: 'verify agent errored' }
  return { passed: v.code === 0, code: v.code, tail: v.tail || '' }
}

// P1-strip re-witness RED — confirm each new test actually FAILS without its implementation.
// Gated on commit:true (so prod files revert to baseSha and restore from HEAD exactly) + a verifyCmd present.
// Returns {applicable, redWitnessed}: applicable=false when there's nothing to check (no tests/prod in the diff,
// no commit, no gate, or the agent errored — fail-OPEN, this is insurance not a primary gate). The failure we
// act on is applicable && !redWitnessed: the suite stayed GREEN with the impl stripped, so the test never
// exercised the new code. Soft limit: if reverting this task's prod file breaks a PRIOR task's test, the suite
// still goes red -> we under-detect (never false-reject). Restore is the agent's mandatory STEP 4.
async function redWitness(task, baseSha) {
  if (!RED_WITNESS || !verifyCmd || !doCommit || !baseSha) return { applicable: false }
  const w = await agent(
    `RE-WITNESS RED for task ${task.id}: confirm this task's NEW test fails without its implementation.` + REPO_NOTE + `\n\n` +
    `STEP 1 — list this task's changed files: \`${GIT} diff --name-only ${baseSha}..HEAD\`. Classify each as TEST ` +
    `(path matches *.test.*, *.spec.*, or a __tests__/test/tests directory) or PRODUCTION (everything else).\n` +
    `If there are NO test files OR NO production files in the diff, STOP and return {applicable:false, detail:"<why>"}.\n` +
    `STEP 2 — revert ONLY the PRODUCTION files to their pre-task state, leaving the new tests in place: ` +
    `\`${GIT} checkout ${baseSha} -- <each prod path>\`. (If a prod file is NEW to this task, this removes it — correct.)\n` +
    `STEP 3 — run the verify command and capture its exit code (SET the Bash tool \`timeout\` to ${VERIFY_TIMEOUT_MS}); run EXACTLY:\n` +
    `  ${verifyCmd}; echo "__RC__=$?"\n` +
    `STEP 4 — ALWAYS restore the tree before returning: \`${GIT} checkout HEAD -- <the same prod paths>\`, then confirm \`${GIT} status\` is clean. Do this even if STEP 3 errored.\n` +
    `Return {applicable:true, redWitnessed:<true iff __RC__ was NON-zero — the suite went RED without the impl, which is GOOD>, detail:"reverted <prod files>; suite RC=<n>"}. ` +
    `redWitnessed is false ONLY if the suite still PASSED (RC=0) without the implementation.`,
    { label: `red-witness:${task.id}`, phase: `task:${task.id}`, model: 'haiku', schema: REDWITNESS })
  return w || { applicable: false }
}

// ---- reviewers (SDD-faithful prompts, fail-closed) ----

// Spec-compliance reviewer — sourced from superpowers spec-reviewer-prompt.md.
// Key SDD principle: "CRITICAL: Do Not Trust the Report."
async function reviewSpec(task, r, baseSha) {
  const diffCmd = baseSha ? `\`${GIT} diff ${baseSha}..HEAD\`` : `\`${GIT} diff\` / \`${GIT} status\``
  const prompt =
    `You are reviewing whether an implementation matches its specification.` + REPO_NOTE + `\n\n` +
    `## What Was Requested\n${task.spec}\n\n` +
    `## What Implementer Claims\nFiles: ${JSON.stringify(r.files || [])}. Summary: ${r.summary || 'none'}.\n\n` +
    `## CRITICAL: Do Not Trust the Report\n` +
    `The implementer finished suspiciously quickly. Their report may be incomplete, inaccurate, or optimistic. You MUST verify independently.\n` +
    `DO NOT take their word for what they implemented. DO NOT accept their interpretation of requirements. DO NOT trust claims about completeness.\n` +
    `DO: Read the actual code. Compare actual implementation to requirements LINE BY LINE.\n` +
    `Check for missing pieces they claimed to implement. Look for extra features they didn't mention.\n\n` +
    `## Verify by reading code, not by trusting report\n` +
    `Inspect THIS TASK's changes using ${diffCmd} (scoped to this task only, not prior tasks). Also read the changed files directly.\n\n` +
    `Check:\n` +
    `- **Missing requirements:** Did they implement everything? Requirements they skipped?\n` +
    `- **Extra/unneeded work:** Did they build things not requested? Over-engineer? Add "nice-to-haves" not in spec?\n` +
    `- **Misunderstandings:** Did they interpret requirements differently? Solve wrong problem?\n` +
    `- **TDD compliance:** Did they write tests? Do tests actually verify the spec's acceptance criteria?\n\n` +
    `## Output — calibrated severity (SDD: not everything is Critical; acknowledge what was done well)\n` +
    `Categorize EACH finding: **critical** = a spec requirement is missing or wrong (acceptance criteria not met); ` +
    `**important** = spec partially met, OR unrequested/over-built behavior added; **minor** = nit/style-adjacent.\n` +
    `Return {approved, findings:[{severity, issue (with file:line), fix}], strengths:[...], assessment}.\n` +
    `Set approved=false if ANY critical or important finding exists; if only minor (or none), approved=true. Be specific and actionable.`
  for (let k = 0; k <= REVIEW_RETRY; k++) {
    const rev = await agent(prompt, { label: `review-spec:${task.id}#${k + 1}`, phase: `task:${task.id}`, model: 'opus', schema: REVIEW })
    if (rev) return rev
    log(`spec reviewer errored on ${task.id} (${k + 1}/${REVIEW_RETRY + 1})`)
  }
  return { approved: false, unavailable: true }   // FAIL CLOSED
}

// Code-quality reviewer — sourced from superpowers code-quality-reviewer-prompt.md.
// Runs ONLY after spec-compliance passes (SDD: "Only dispatch after spec compliance review passes").
async function reviewQuality(task, r, baseSha) {
  const diffCmd = baseSha ? `\`${GIT} diff ${baseSha}..HEAD\`` : `\`${GIT} diff\` / \`${GIT} status\``
  const prompt =
    `You are reviewing code quality for task ${task.id}. Spec compliance ALREADY PASSED — do not re-check spec.` + REPO_NOTE + `\n\n` +
    `## What Changed\nFiles: ${JSON.stringify(r.files || [])}. Summary: ${r.summary || 'none'}.\n\n` +
    `## CRITICAL: Do Not Trust the Report — inspect the code yourself\n` +
    `Use ${diffCmd} to see ONLY this task's changes (not prior tasks). Read the actual code. Check:\n\n` +
    `**Code quality:**\n` +
    `- Idioms, naming, dead code, error handling\n` +
    `- Does each file have one clear responsibility with a well-defined interface?\n` +
    `- Are units decomposed so they can be understood and tested independently?\n` +
    `- Is the code clean and maintainable? Are names clear and accurate?\n\n` +
    `**YAGNI / over-build (SDD: "Did I avoid overbuilding?"):**\n` +
    `- Did they build things not requested? Add unnecessary abstractions?\n` +
    `- Did they add "nice to haves" or future-proofing not in the spec?\n\n` +
    `**Anti-gaming (REJECT if any):**\n` +
    `- Implementer weakened/deleted existing tests to force green\n` +
    `- Implementer edited gate/verify config to force the gate green\n` +
    `- Left placeholders/stubs/TODOs claiming "done"\n` +
    `- Added test-only methods to production classes\n` +
    `- Tests mock behavior instead of testing real behavior\n\n` +
    `**Testing quality:**\n` +
    `- Do tests verify behavior (not mock behavior)?\n` +
    `- Are tests comprehensive for the acceptance criteria?\n` +
    `- Did tests follow TDD (evidence of red-green-refactor in commit history)?\n\n` +
    `**File growth / structure:** Did this change create already-large files or significantly grow existing ones? Does it follow the planned file structure?\n\n` +
    `## Output — calibrated severity (SDD: not everything is Critical; acknowledge strengths)\n` +
    `Categorize EACH finding: **critical** = anti-gaming violation (weakened tests / edited gate / placeholder claiming done) or a real correctness/maintainability defect; ` +
    `**important** = YAGNI/over-build, poor decomposition, missing error handling; **minor** = naming/style nit.\n` +
    `Return {approved, findings:[{severity, issue (with file:line), fix}], strengths:[...], assessment}.\n` +
    `Set approved=false if ANY critical or important finding exists; minor-only (or none) => approved=true.`
  for (let k = 0; k <= REVIEW_RETRY; k++) {
    const rev = await agent(prompt, { label: `review-quality:${task.id}#${k + 1}`, phase: `task:${task.id}`, model: 'opus', schema: REVIEW })
    if (rev) return rev
    log(`quality reviewer errored on ${task.id} (${k + 1}/${REVIEW_RETRY + 1})`)
  }
  return { approved: false, unavailable: true }   // FAIL CLOSED
}

// B3 fix: capture HEAD SHA before each task so reviewers can scope `git diff BASE..HEAD`
// instead of seeing ALL accumulated changes from prior tasks. SDD's code-quality-reviewer
// uses BASE_SHA/HEAD_SHA for precise diff scoping.
const HEAD_SHA = { type: 'object', required: ['sha'], properties: { sha: { type: 'string' } } }
async function captureHead(taskId) {
  const r = await agent(
    `Run \`${GIT} rev-parse HEAD\` with Bash and return {sha:"<the full sha>"}.`,
    { label: `capture-head:${taskId}`, phase: `task:${taskId}`, model: 'haiku', schema: HEAD_SHA })
  return (r && r.sha) || null
}

// N2: graduated-BLOCKED step 3 — try splitting a blocked task into smaller pieces before
// escalating to a human. Only ORIGINAL tasks decompose (never a decomposition product), and the
// MAX_TASKS ceiling bounds total growth. Returns subtasks or null (atomic / decompose declined).
async function decompose(task, reason) {
  if (task._fromDecompose) return null   // don't recursively split a split product
  const d = await agent(
    `Task ${task.id} was reported "${reason}" — likely too large or complex to implement in one pass.` + REPO_NOTE + `\n\n` +
    `TASK SPEC:\n${task.spec}\n\n` +
    `Decide: is this ATOMIC (genuinely cannot be split — return {atomic:true}), or can it be split into 2-4 SMALLER, ` +
    `independently-testable subtasks that TOGETHER fully accomplish it?\n` +
    `If splittable: return {atomic:false, subtasks:[{id, spec}]} with FRESH unique slug ids prefixed by the parent (e.g. "${task.id}-1"). ` +
    `Each subtask spec MUST embed a failing-test (red) + green criteria. Keep them surgical and ordered.`,
    { label: `decompose:${task.id}`, phase: `task:${task.id}`, model: 'opus', schema: DECOMP })
  return (d && !d.atomic && (d.subtasks || []).length) ? d.subtasks : null
}
async function escalateBlocked(task, r) {
  const subs = await decompose(task, r.status)
  if (subs) { log(`${task.id} ${r.status} — decomposed into ${subs.length} subtask(s) instead of escalating`); return { task: task.id, ok: false, reason: 'decomposed', decomposed: subs, by: r.by } }
  log(`BLOCKED ${task.id} (${r.status}) — escalating to human`)
  return { task: task.id, ok: false, reason: r.status, needsHuman: true, by: r.by }
}

// N3: SDD — "If the concerns are about correctness or scope, address them BEFORE review."
// A self-flagged correctness/scope doubt gets a fix pass before the gate; observational ones proceed.
async function triageConcerns(task, r) {
  if (r.status !== 'done_with_concerns' || !r.concerns) return r
  const t = await agent(
    `The implementer completed task ${task.id} but flagged concerns:\n"${r.concerns}"\n\n` +
    `Are these about CORRECTNESS or SCOPE (the work may be wrong/incomplete — must be addressed before review), ` +
    `or merely OBSERVATIONAL (e.g. "this file is getting large" — note and proceed)?\n` +
    `Return {addressFirst:true, why} if correctness/scope; {addressFirst:false, why} if observational.`,
    { label: `triage:${task.id}`, phase: `task:${task.id}`, model: 'opus', schema: TRIAGE })
  if (t && t.addressFirst) {
    log(`${task.id}: self-flagged concern is correctness/scope — addressing before review`)
    const fixed = await implement(task, [`Address your own flagged concern before this goes to review: ${r.concerns}`], r)
    if (DONE_OK.has(fixed.status)) return fixed
    return fixed   // blocked/needs_context/failed handled by the caller's status checks
  }
  return r
}

// One task end-to-end. Each fix-round re-runs the full ladder (gate -> spec -> quality)
// so a later fix can't silently regress an earlier gate. SDD order: spec before quality.
async function buildTask(task) {
  const baseSha = await captureHead(task.id)   // B3: snapshot before this task's changes
  let r = await implement(task)
  r = await triageConcerns(task, r)     // N3: address self-flagged correctness/scope concerns before review
  if (r.status === 'blocked' || r.status === 'needs_context') return await escalateBlocked(task, r)   // N2
  if (!DONE_OK.has(r.status)) { log(`STALLED ${task.id}`); return { task: task.id, ok: false, reason: 'impl-failed', by: r.by } }

  const allMinors = []
  let prevBlock = Infinity, stall = 0, lastStuck = null   // #2 thrash guard: blocking-finding count not shrinking
  for (let i = 0; i < MAX_FIX; i++) {
    const v = await verify(task)
    if (!v.passed) { r = await implement(task, [`Project gate failed (exit ${v.code})${v.code === 124 ? ' — the gate TIMED OUT (a hang / infinite loop in the code)' : ''}:\n${v.tail}`], r); if (!DONE_OK.has(r.status)) return await blockOrFail(task, r); continue }

    // P1-strip re-witness RED: the gate is GREEN — now confirm the new test actually DEPENDS on the impl.
    // If the suite still passes with the implementation stripped, the test is vacuous -> back to the implementer
    // (counts as a fix round, so MAX_FIX bounds it). Fail-open: an inapplicable/errored check never blocks green work.
    const w = await redWitness(task, baseSha)
    if (w.applicable && !w.redWitnessed) {
      log(`${task.id}: RE-WITNESS RED FAILED — suite passed with the implementation stripped; the test does not exercise the new code. Sending back. (${w.detail || ''})`)
      r = await implement(task, ['Your new test PASSES even when the implementation is reverted/stripped — it does not actually exercise the new behavior (it asserts nothing meaningful, or never calls the new code). Rewrite the test to assert concrete expected outputs so it FAILS without the implementation, then make it pass.'], r)
      if (!DONE_OK.has(r.status)) return await blockOrFail(task, r)
      continue
    }

    // N1: spec review first — only critical/important findings block; minor findings are logged, not fixed.
    const spec = await reviewSpec(task, r, baseSha)
    if (spec.unavailable) return { task: task.id, ok: false, reason: 'spec-review-unavailable', needsHuman: true, by: r.by }
    const specBlock = blocking(spec)

    // SDD: quality review runs ONLY after spec passes. Collect its blocking findings when it does.
    let qual = null, qualBlock = []
    if (!specBlock.length) {
      qual = await reviewQuality(task, r, baseSha)
      if (qual.unavailable) return { task: task.id, ok: false, reason: 'quality-review-unavailable', needsHuman: true, by: r.by }
      qualBlock = blocking(qual)
      if (!qualBlock.length) {
        allMinors.push(...minorsOf(spec), ...minorsOf(qual))
        return { task: task.id, ok: true, by: r.by, rounds: i + 1, selfReviewed: r.by === 'claude-fallback' || r.by === 'claude' || r.by === 'claude-escalated', concerns: r.concerns || null, minors: allMinors.length ? allMinors : null }
      }
    }

    // We have blocking findings (spec or quality). #2 progress check BEFORE spending another fix round —
    // if the blocking count is NOT shrinking across consecutive rounds, the implementer is thrashing. SDD:
    // "after repeated failed fixes, stop and question" — escalate with the stuck findings rather than silently
    // burning the remaining rounds on the same wall.
    const stuck = [...specBlock, ...qualBlock]
    stall = (stuck.length >= prevBlock) ? stall + 1 : 0
    prevBlock = stuck.length
    lastStuck = fmtFindings(stuck)
    if (stall >= 2) {
      log(`${task.id}: NO PROGRESS — ${stuck.length} blocking finding(s) not shrinking over consecutive rounds; escalating to human instead of burning the remaining fix round(s)`)
      return { task: task.id, ok: false, reason: 'no-progress', needsHuman: true, by: r.by, stuckFindings: lastStuck }
    }
    r = await implement(task, lastStuck, r)
    if (!DONE_OK.has(r.status)) return await blockOrFail(task, r)
  }
  // #2: exhausting MAX_FIX is a "needs human" outcome — surface WHY (the stuck findings), don't fail silently.
  return { task: task.id, ok: false, reason: 'max-fix-exhausted', needsHuman: true, by: r.by, stuckFindings: lastStuck }
}
async function blockOrFail(task, r) {
  if (r.status === 'blocked' || r.status === 'needs_context') return await escalateBlocked(task, r)   // N2
  return { task: task.id, ok: false, reason: 'fix-failed', by: r.by }
}

// Decompose a goal into ordered, independent, individually-testable tasks (judgment -> opus).
async function plan(g) {
  const p = await agent(
    `Decompose this goal into an ORDERED list of small, surgical, independently-testable implementation tasks. ` +
    `Each task needs a STABLE slug id and a spec embedding acceptance criteria + how to verify it.\n` +
    `Tasks should be ordered so each can be implemented, tested, and committed independently.\n` +
    `Each spec MUST include what a FAILING test looks like (red) and what "green" means.\n\nGOAL:\n${g}\n\nReturn {tasks:[{id, spec}]}.`,
    { label: 'plan', phase: 'Plan', model: 'opus', schema: PLAN })
  return (p && p.tasks) || []
}

// Dry-until-clean completeness critic.
async function critic(g, builtIds, round, priorGaps) {
  const dedup = (priorGaps && priorGaps.length)
    ? `\n\nGaps you flagged in a PRIOR round: ${priorGaps.map(x => `"${x}"`).join('; ')}.\n` +
      `Do NOT re-emit any of these unless it is STILL genuinely unaddressed after inspecting the tree — and if you re-emit, it must be the SAME underlying gap, not a reworded duplicate. Only emit GENUINELY NEW gaps.`
    : ''
  const c = await agent(
    `Completeness critic for an unattended build.` + REPO_NOTE + ` GOAL:\n${g}\n\nTasks completed so far: ${builtIds.join(', ') || 'none'}.\n` +
    `Inspect the ACTUAL working tree (\`${GIT} diff\`/\`${GIT} status\`, read files${verifyCmd ? `, and run \`${verifyCmd}\`` : ''}). ` +
    `Decide: is the goal fully met AND clean — no gaps, no stub/TODO/placeholder, and tests genuinely cover it and were NOT weakened or the gate edited to pass?\n` +
    `If yes -> {clean:true}. If not -> {clean:false, gaps:[...], newTasks:[{id, spec}]} where newTasks have FRESH unique ids that close the gaps. ` +
    `Each new task spec MUST include what a FAILING test looks like (red) and what "green" means. Keep tasks surgical.` + dedup,
    { label: `critic#${round}`, phase: 'Plan', model: 'opus', schema: CRITIC })
  return c || { clean: true, gaps: ['critic errored — stopping to avoid an unbounded loop'], newTasks: [] }
}

// Crash-resume helpers (cheap model).
async function loadDone() {
  if (!logFile) return new Set()
  const r = await agent(
    `Read ${logFile} if it exists (JSONL, one {"id","ok"} per line). Return {done:[ids where ok===true]}. Missing file => {done:[]}.`,
    { label: 'resume-load', phase: 'Preflight', model: 'haiku', schema: DONELIST })
  return new Set((r && r.done) || [])
}
async function checkpoint(res) {
  if (!logFile) return
  await agent(
    `Append exactly one line to ${logFile} (create dirs/file if needed) with Bash, then stop:\n` +
    `${JSON.stringify({ id: res.task, ok: res.ok, by: res.by || null, reason: res.reason || null })}\n` +
    `Use: printf '%s\\n' '<the json>' >> ${logFile}`,
    { label: `checkpoint:${res.task}`, phase: `task:${res.task}`, model: 'haiku' })
}

// Anti-drift: warn if the installed superpowers differs from the version our embedded prompts were sourced from.
async function checkSpDrift() {
  const r = await agent(
    `List the version directories under ~/.claude/plugins/cache/claude-plugins-official/superpowers/ ` +
    `(Bash: \`ls -1 ~/.claude/plugins/cache/claude-plugins-official/superpowers/ 2>/dev/null\`). ` +
    `Return {installed:[the directory names, e.g. "5.1.0"]}. Empty/missing => {installed:[]}.`,
    { label: 'sp-version-check', phase: 'Preflight', model: 'haiku', schema: SPVER })
  const installed = (r && r.installed) || []
  const drift = installed.length > 0 && !installed.includes(SP_VERSION)
  if (drift) log(`SP DRIFT: embedded prompts pinned to superpowers ${SP_VERSION}, but installed = ${installed.join(', ')}. Re-sync the skill files (see header comment).`)
  return { pinned: SP_VERSION, installed, drift }
}

async function preflight() {
  if (!isExternal()) return { ok: true, detail: 'claude implementer — no external CLI to cross-check' }

  // gemini's ask-gemini has NO cwd param: it runs in the MCP server's launch dir. If that is not the
  // target repo, a gemini delegate would silently edit the WRONG repo. Probe it and downgrade to claude
  // (the claude path is repo-scoped via `git -C repoDir` + REPO_NOTE, so it's always safe).
  if (IMPLEMENTER === 'gemini' && repoDir) {
    const g = await agent(
      `Find out where the Gemini CLI actually runs.\n` +
      `STEP 1: ToolSearch "select:mcp__gemini-cli__ask-gemini" to load the deferred tool.\n` +
      `STEP 2: call mcp__gemini-cli__ask-gemini with prompt "run \`pwd\` and reply with ONLY that absolute path, nothing else".\n` +
      `Return {ok:true, detail:"<gemini's path>"} if that path equals ${repoDir}; {ok:false, detail:"<gemini's path>"} if it differs.`,
      { label: 'preflight-gemini', phase: 'Preflight', model: 'haiku', schema: PREFLIGHT })
    if (g && g.ok === false) {
      log(`gemini runs in ${g.detail} != target ${repoDir} (gemini MCP can't be steered cross-repo) — downgrading implementer to claude for this run`)
      IMPLEMENTER = 'claude'
      return { ok: true, detail: `gemini cwd mismatch (${g.detail}); downgraded implementer to claude` }
    }
    return { ok: true, detail: g ? `gemini cwd ${g.detail} matches target` : 'gemini cwd probe errored — proceeding' }
  }

  // codex runs as `codex exec` via Bash (NOT the MCP). Cheap probe: confirm the binary runs AND the command
  // is permitted — if `Bash(codex *)` isn't allowlisted (or sandbox.excludedCommands lacks `codex`), this call
  // hangs on a permission prompt / sandbox failure and surfaces HERE, not after a wasted task. Never abort:
  // the per-task claude fallback covers a flaking codex.
  if (IMPLEMENTER === 'codex') {
    const c = await agent(
      `Confirm the Codex CLI is runnable and pre-approved (we use \`codex exec\`, NOT any MCP tool).\n` +
      `Run with the Bash tool (timeout 30000): \`codex --version\`\n` +
      `Return {ok:true, detail:"<version string>"} if it prints a version promptly; {ok:false, detail:"<error / it hung / permission denied>"} otherwise.`,
      { label: 'preflight-codex', phase: 'Preflight', model: 'haiku', schema: PREFLIGHT })
    if (c && c.ok === false) { log(`codex preflight WARNING: ${c.detail} — \`codex exec\` may be unrunnable/unpermitted (need permissions.allow "Bash(codex *)" + sandbox.excludedCommands ["codex"]); the run will fall back to claude per-task (check by:codex / fallbacks on the result)`); return { ok: true, detail: `codex preflight failed: ${c.detail}` } }
    return { ok: true, detail: c ? `codex runnable: ${c.detail}` : 'codex preflight errored — proceeding (per-task fallback covers)' }
  }
  return { ok: true, detail: 'no external CLI' }
}

// ---- run ----
if (!tasks.length && !goal) return { passed: [], failed: [], total: 0, note: 'pass args.tasks=[{id,spec}] OR args.goal="..." (+ optional repoDir, verifyCmd, logFile, commit, maxRounds, implementer, implModel)' }

// Fail loud on malformed task entries — non-{id,spec} items (e.g. bare strings) are otherwise
// silently dropped by the worklist filter (queue.filter(t => t && t.id ...)) so the run "succeeds"
// having built nothing. Validate the shape up front.
if (tasks.length) {
  const bad = tasks.filter(t => !t || typeof t.id !== 'string' || !t.id.trim() || typeof t.spec !== 'string' || !t.spec.trim())
  if (bad.length) return { error: 'malformed-tasks', total: 0,
    note: `args.tasks must be [{id:string, spec:string}] with non-empty id+spec; ${bad.length}/${tasks.length} entr${bad.length > 1 ? 'ies' : 'y'} fail this. First bad: ${JSON.stringify(bad[0]).slice(0, 120)}` }
}

// Seed the worklist: explicit tasks win; otherwise plan() decomposes the goal.
let queue = tasks.length ? [...tasks] : await plan(goal)
const planned = queue.length
// planOnly: return the decomposition for human sign-off BEFORE building.
// No preflight/resume needed — we're not editing code, just planning.
if (_args.planOnly) return { planOnly: true, plannedTasks: planned, tasks: queue, goal: goal || null }

// ---- preflight + resume (build path only) ----
const sp = await checkSpDrift()   // anti-drift: warn if installed superpowers != the pinned-source version
const pf = await preflight()
if (!pf.ok) { log(`ABORT: preflight repo mismatch — ${pf.detail}`); return { aborted: 'preflight', detail: pf.detail, total: tasks.length } }
const alreadyDone = await loadDone()
const seen = new Set()
const results = []
let round = 0, lastGaps = [], builtCount = 0, stopReason = null
const lowOnBudget = () => (typeof budget !== 'undefined' && budget.total) ? budget.remaining() < BUDGET_RESERVE : false
// N10: make the budget guard's status visible instead of silently inert.
if (typeof budget === 'undefined' || !budget || !budget.total) log('note: no runtime budget ceiling — maxTasks is the only runaway guard')

while (queue.length && round < MAX_ROUNDS) {
  round++
  const batch = queue.filter(t => t && t.id && !seen.has(t.id))
  batch.forEach(t => seen.add(t.id))
  // worklist (not a plain for-loop) so N2 decomposition can splice subtasks in to build THIS round.
  const worklist = batch.slice()
  while (worklist.length) {
    const task = worklist.shift()
    if (alreadyDone.has(task.id)) { log(`resume: ${task.id} already passed — skipping`); results.push({ task: task.id, ok: true, by: 'resumed', resumed: true }); continue }
    if (builtCount >= MAX_TASKS) { stopReason = 'max-tasks'; break }
    if (lowOnBudget())          { stopReason = 'budget';    break }
    const res = await buildTask(task)
    if (res.decomposed) {   // N2: a blocked task was split — build its subtasks before moving on
      const fresh = res.decomposed.filter(st => st && st.id && !seen.has(st.id))
      fresh.forEach(st => { seen.add(st.id); st._fromDecompose = true })
      worklist.unshift(...fresh)
      log(`decomposed ${res.task} -> ${fresh.length} subtask(s) queued this round`)
      continue   // parent is not itself a built result
    }
    await checkpoint(res)
    results.push(res)
    builtCount++
  }
  if (stopReason) { log(`STOP: ${stopReason} ceiling hit after ${builtCount} task(s)`); break }
  if (!goal) break
  if (!LOOP_UNTIL_CLEAN) { log('loop-until-clean OFF (default) — single plan/build pass done; pass loopUntilClean:true to enable the dry-until-clean critic'); break }
  if (lowOnBudget()) { stopReason = 'budget'; log('STOP: budget ceiling hit before re-planning'); break }
  const c = await critic(goal, results.filter(x => x.ok).map(x => x.task), round, lastGaps)   // N7: pass prior gaps to dedup
  lastGaps = c.gaps || []
  if (c.clean) { log(`round ${round}: critic says CLEAN`); queue = []; break }
  queue = (c.newTasks || []).filter(t => t && t.id && !seen.has(t.id))
  log(`round ${round}: critic found ${lastGaps.length} gap(s) -> ${queue.length} new task(s)`)
}
// roundCapped is a dry-until-clean (goal) concept: hit maxRounds with the critic still wanting work.
// For a tasks-only run, `queue` is never drained (we iterate a batch copy), so guard on `goal` to avoid a false cap.
const roundCapped = !!goal && round >= MAX_ROUNDS && queue.length > 0

const done = results.filter(Boolean)
const passedIds = done.filter(x => x.ok).map(x => x.task)

// SDD final step: one adversarial fresh-eye review over the WHOLE integrated change.
let integration = null
if (passedIds.length) {
  // #3: final full-suite gate — per-task verify can be fast/scoped; run the comprehensive suite ONCE here.
  const finalGate = FULL_VERIFY_CMD || verifyCmd
  integration = await agent(
    `Adversarial fresh-eye review of the ENTIRE integrated implementation (tasks: ${passedIds.join(', ')}).` + REPO_NOTE +
    (goal ? ` GOAL:\n${goal}\n` : ' ') +
    (finalGate ? `FIRST, run the FULL verify suite as the final gate (SET the Bash tool \`timeout\` to ${VERIFY_TIMEOUT_MS}): \`${finalGate}\`. If it exits non-zero OR times out, set approved:false with a CRITICAL finding quoting the failure — a red suite blocks integration no matter how clean the code looks.\n\n` : '') +
    `Inspect the full working tree (\`${GIT} diff\`/\`${GIT} status\`, read files). Look for:\n` +
    `- Cross-task regressions, inconsistent interfaces, duplicated logic\n` +
    `- Broken assumptions no single-task review would catch\n` +
    `- Tests that don't actually test what they claim (mock behavior vs real behavior)\n` +
    `- YAGNI violations, over-engineering, placeholder code\n` +
    `Return {approved, findings:[{severity, issue, fix}], strengths, assessment}. approved=false if any critical/important finding. Do NOT edit — only report.`,
    { label: 'integration-review', phase: 'Integrate', model: 'opus', schema: REVIEW }) || { approved: false, findings: [{ severity: 'critical', issue: 'integration reviewer errored' }] }
}

const failedList    = done.filter(x => !x.ok)
const needsHumanList = done.filter(x => x.needsHuman)
// N12: a single top-level safety flag for unattended callers — integration.approved===false now GATES.
const ok = failedList.length === 0 && needsHumanList.length === 0 &&
           (!integration || integration.approved !== false) &&
           !stopReason && !roundCapped && !degraded

return {
  ok,                                                                            // N12: safe-to-merge unattended? (all green + integration approved + no ceilings/escalations)
  goal:         goal || null,
  plannedTasks: planned,
  rounds:       round,
  roundCapped:  roundCapped,
  stopped:      stopReason,
  openGaps:     (roundCapped || stopReason) ? lastGaps : [],
  passed:       passedIds,
  failed:       done.filter(x => !x.ok).map(x => ({ task: x.task, reason: x.reason, needsHuman: x.needsHuman || false, ...(x.stuckFindings ? { stuckFindings: x.stuckFindings } : {}) })),
  needsHuman:   done.filter(x => x.needsHuman).map(x => x.task),
  fallbacks:    done.filter(x => x.by === 'claude-fallback').map(x => x.task),
  escalated:    done.filter(x => x.by === 'claude-escalated').map(x => x.task),
  selfReviewed: done.filter(x => x.selfReviewed).map(x => x.task),
  resumed:      done.filter(x => x.resumed).map(x => x.task),
  concerns:     done.filter(x => x.concerns).map(x => ({ task: x.task, concerns: x.concerns })),
  minors:       done.filter(x => x.minors).map(x => ({ task: x.task, minors: x.minors })),   // N1: non-blocking nits, logged not fixed
  degraded,
  integration,
  sp,                                                                            // {pinned, installed, drift} — embedded-prompt staleness vs installed superpowers
  repoDir:      repoDir || '(session cwd)',
  verifyCmd:    verifyCmd || null,
  implementer:  IMPLEMENTER,                                                    // effective implementer (gemini may have been downgraded to claude in preflight)
  implModel:    isExternal() ? IMPLEMENTER : IMPL_MODEL,
  total:        done.length,
}
