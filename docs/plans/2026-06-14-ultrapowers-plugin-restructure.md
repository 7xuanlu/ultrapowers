# ultrapowers Plugin Restructure, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package the existing Workflow-coordinator harness as a lean, command-driven Claude Code plugin, installable from a local marketplace, with a single user-only `/workflows-driven-development` command, a SessionStart symlink hook, and load-on-demand reference docs, without changing engine behavior.

**Architecture:** The repo root *is* the plugin root. A `.claude-plugin/` manifest pair (`plugin.json` + `marketplace.json`) makes it installable. The engine moves `workflows/ → workflow/` (single source of truth); a SessionStart hook idempotently symlinks it into `~/.claude/workflows/` so `Workflow({name:'ultrapowers-development'})` resolves by name. The existing `commands/ultrapowers.md` is **renamed** to `commands/workflows-driven-development.md` (git mv + rewrite) and gains `disable-model-invocation: true`, two modes (`default` / `--thorough`), `--tasks` validation, and an `implementer:"claude"` product default. `reference/*.md` docs are *lifted* from existing ADRs/gating/memory and `Read` on demand via `${CLAUDE_PLUGIN_ROOT}`. `bench/` is retained untouched except the one engine-path reference.

**Tech Stack:** Claude Code plugin format (`.claude-plugin/`, hooks, commands), Node.js (the engine, `node --check` / `node --test`), bash (hook + bench scripts), JSON manifests.

**Spec:** `docs/design/2026-06-14-ultrapowers-plugin-design.md` (approved, adversarially reviewed). Decision log D1-D11 there governs; `[impl-verify]` flags resolved in the plan header above.

**Source facts (verified, do not re-derive):**
- Engine args surface (what the command may pass): `tasks`, `goal`, `verifyCmd`, `logFile`, `commit`, `maxRounds`(def 3), `maxTasks`(def 50), `implementer`(def `codex`), `implModel`(def `sonnet`), `codexModel`, `codexReasoning`, `codexTimeoutMs`, `verifyTimeoutMs`, `fullVerifyCmd`, `redWitness`(def true), `loopUntilClean`(def false), `repoDir`. Engine `meta.name = 'ultrapowers-development'`, **must not rename** (by-name dispatch depends on it).
- 3 live engine references: `bench/run.sh:31` (scriptPath, **breaks on move**), `commands/ultrapowers.md:23,30` (by-name, move-safe), `~/.claude/workflows/ultrapowers-development.js` (symlink, hook-managed).
- ADRs are in `docs/decisions/README.md` (no numbered files): ADR-0001 (host on Workflow primitive), ADR-0002 (re-witness RED), ADR-0003 (dry-until-clean critic). Gating rules in `docs/design/gating-and-escalation.md`. Task-args gotcha in `~/.claude/projects/-Users-lucian-Repos-ultrapowers/memory/ultrapowers-workflow-task-args-gotchas.md`.
- NOTICE legal-name TODO at `NOTICE:29` (P0). superpowers hook pattern: `hooks/hooks.json` (SessionStart matcher `startup|clear|compact`) + a bash `hooks/session-start` emitting `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"..."}}`.

---

## File structure (what each new/changed file owns)

| path | create/modify | responsibility |
|---|---|---|
| `.claude-plugin/plugin.json` | create | plugin identity/metadata (name, version, description, author, license) |
| `.claude-plugin/marketplace.json` | create | single-plugin marketplace `ultrapowers-dev`, source `./` |
| `package.json` | create | engine is Node ESM; declares `type:"module"` + `node --check`/`node --test` scripts |
| `hooks/hooks.json` | create | SessionStart matcher → runs `session-start` |
| `hooks/session-start` | create | idempotent symlink of engine into `~/.claude/workflows/`; safe (won't clobber a real file) |
| `workflow/ultrapowers-development.js` | move (git mv from `workflows/`) | the engine, single source of truth |
| `commands/workflows-driven-development.md` | move+rewrite (git mv from `commands/ultrapowers.md`) | user-only entry; gates, modes, dispatch, validation, reference pointers |
| `reference/task-list.md` | create (lift) | `args.tasks=[{id,spec}]` format + the bare-string-drops footgun |
| `reference/harness.md` | create (lift) | coordinator args + model routing + ADR-0001 |
| `reference/re-witness-red.md` | create (lift) | ADR-0002 mechanism + honest evidence caveat + boundary |
| `reference/gating.md` | create (lift) | deterministic replan/verify/escalate (binary, bounded) |
| `bench/run.sh` | modify (line 31) | repoint `WORKFLOW_JS` to `workflow/` |
| `SECURITY.md` | create | unattended code-execution disclosure (P0) |
| `NOTICE` | modify (line 29) | resolve legal-name TODO (**user decision**, Task 8) |
| `HANDOFF.md` / `README.md` | modify | reflect new paths + install instructions |

---

### Task 1: Node + plugin manifests

**Files:**
- Create: `package.json`
- Create: `.claude-plugin/plugin.json`
- Create: `.claude-plugin/marketplace.json`

- [ ] **Step 1: Create `package.json`**

The engine is ES-module JS run by `node`; declaring the package makes `node --check`/`node --test` ergonomic and signals the toolchain.

```json
{
  "name": "ultrapowers",
  "version": "0.1.0",
  "description": "Unattended SDD/TDD build harness for Claude Code (Workflow-coordinator). Complements superpowers.",
  "type": "module",
  "license": "MIT",
  "private": true,
  "scripts": {
    "check": "node --check workflow/ultrapowers-development.js",
    "test:rewitness": "bash tests/re-witness-red/seed.sh"
  }
}
```

- [ ] **Step 2: Create `.claude-plugin/plugin.json`**

```json
{
  "name": "ultrapowers",
  "version": "0.1.0",
  "description": "Unattended SDD/TDD build harness, hands-off goal→plan→build with strict TDD, two-stage fail-closed review, and mechanical re-witness-RED. Complements superpowers; does not replace it.",
  "author": { "name": "Lucian (@7xuanlu)" },
  "license": "MIT"
}
```

(`homepage`/repo URL intentionally omitted until a public remote exists, YAGNI; add at publish.)

- [ ] **Step 3: Create `.claude-plugin/marketplace.json`**

```json
{
  "name": "ultrapowers-dev",
  "owner": { "name": "Lucian (@7xuanlu)" },
  "plugins": [
    {
      "name": "ultrapowers",
      "source": "./",
      "description": "Unattended SDD/TDD build harness for Claude Code (Workflow-coordinator)."
    }
  ]
}
```

- [ ] **Step 4: Validate JSON**

Run: `for f in package.json .claude-plugin/plugin.json .claude-plugin/marketplace.json; do python3 -m json.tool "$f" >/dev/null && echo "ok $f"; done`
Expected: `ok package.json` / `ok .claude-plugin/plugin.json` / `ok .claude-plugin/marketplace.json` (module-type-agnostic, avoids `node -e`'s CommonJS/ESM ambiguity now that `package.json` is `type:module`).

- [ ] **Step 5: Commit**

```bash
git add package.json .claude-plugin/
git commit -m "feat(plugin): add plugin.json + marketplace.json + package.json manifests"
```

---

### Task 2: SessionStart symlink hook

**Files:**
- Create: `hooks/hooks.json`
- Create: `hooks/session-start`
- Test: `tests/hook/test-session-start.sh`

- [ ] **Step 1: Write the failing test**

The hook must (a) create the symlink when absent, (b) be idempotent (second run = no error, same link), (c) **not** clobber a pre-existing real file, (d) repoint a stale symlink. Test by overriding `HOME` to a temp dir.

Create `tests/hook/test-session-start.sh`:

```bash
#!/usr/bin/env bash
# Test the SessionStart symlink hook in an isolated HOME. No network, no real ~/.claude touched.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export HOME="$TMP"
HOOK="$ROOT/hooks/session-start"
LINK="$TMP/.claude/workflows/ultrapowers-development.js"
ENGINE="$ROOT/workflow/ultrapowers-development.js"

fail() { echo "FAIL: $1" >&2; exit 1; }

# (a) creates the symlink
bash "$HOOK" >/dev/null
[ -L "$LINK" ] || fail "symlink not created"
[ "$(readlink "$LINK")" = "$ENGINE" ] || fail "symlink points wrong: $(readlink "$LINK")"

# (b) idempotent, second run succeeds, link unchanged
bash "$HOOK" >/dev/null
[ "$(readlink "$LINK")" = "$ENGINE" ] || fail "idempotent run changed link"

# (c) does NOT clobber a real (non-symlink) file
rm -f "$LINK"; printf 'real' > "$LINK"
bash "$HOOK" >/dev/null
[ -L "$LINK" ] && fail "clobbered a real file with a symlink"
[ "$(cat "$LINK")" = "real" ] || fail "real file content altered"

# (d) repoints a stale/dangling symlink
ln -snf "/nonexistent/old.js" "$LINK"
bash "$HOOK" >/dev/null
[ "$(readlink "$LINK")" = "$ENGINE" ] || fail "stale symlink not repointed"

# emits valid SessionStart JSON
out="$(bash "$HOOK")"
echo "$out" | python3 -c "import json,sys; o=json.load(sys.stdin); assert o['hookSpecificOutput']['hookEventName']=='SessionStart'; print('json ok')" || fail "hook output not valid SessionStart JSON"

echo "PASS test-session-start"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bash tests/hook/test-session-start.sh`
Expected: FAIL, `hooks/session-start` does not exist yet (`bash: .../hooks/session-start: No such file`).

(Note: this test references `workflow/ultrapowers-development.js`, created in Task 3. Until then the symlink target dangles, the test still validates link creation/idempotency/no-clobber/repoint, which is path-based, not target-existence-based. Re-run after Task 3 to confirm the target resolves.)

- [ ] **Step 3: Write `hooks/session-start`**

```bash
#!/usr/bin/env bash
# SessionStart hook (ultrapowers): idempotently symlink the bundled engine into
# ~/.claude/workflows/ so Workflow({name:'ultrapowers-development'}) resolves by name.
# The bundled workflow/ultrapowers-development.js is the single source of truth; the
# symlink always points at the plugin's current engine (no "two copies in sync" burden).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENGINE="${PLUGIN_ROOT}/workflow/ultrapowers-development.js"
DEST_DIR="${HOME}/.claude/workflows"
LINK="${DEST_DIR}/ultrapowers-development.js"

mkdir -p "${DEST_DIR}"

# Only manage our own symlink slot: (re)point it at the bundled engine when the slot is a
# symlink or empty. Never clobber a real file a user may have placed there.
if [ -L "${LINK}" ] || [ ! -e "${LINK}" ]; then
  ln -snf "${ENGINE}" "${LINK}"
fi

printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":""}}\n'
exit 0
```

- [ ] **Step 4: Make executable + write `hooks/hooks.json`**

Run: `chmod +x hooks/session-start`

Create `hooks/hooks.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|clear|compact",
        "hooks": [
          {
            "type": "command",
            "command": "\"${CLAUDE_PLUGIN_ROOT}/hooks/session-start\"",
            "async": false
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bash tests/hook/test-session-start.sh`
Expected: `PASS test-session-start`

- [ ] **Step 6: Commit**

```bash
git add hooks/ tests/hook/
git commit -m "feat(plugin): SessionStart hook symlinks engine into ~/.claude/workflows/ (idempotent, no-clobber)"
```

---

### Task 3: Move the engine, repoint bench, verify unchanged

**Files:**
- Move: `workflows/ultrapowers-development.js` → `workflow/ultrapowers-development.js`
- Modify: `bench/run.sh:31`

- [ ] **Step 1: Move the engine with git (preserves history)**

```bash
mkdir -p workflow
git mv workflows/ultrapowers-development.js workflow/ultrapowers-development.js
rmdir workflows 2>/dev/null || true
```

- [ ] **Step 2: Verify the engine still parses**

Run: `node --check workflow/ultrapowers-development.js`
Expected: no output, exit 0.

- [ ] **Step 3: Repoint the one breaking reference in `bench/run.sh`**

Change line 31 from `workflows/` to `workflow/`:

```bash
WORKFLOW_JS="$(cd "$SCRIPT_DIR/.." && pwd)/workflow/ultrapowers-development.js"
```

- [ ] **Step 4: Update every stale reference to the old engine *source* path**

The grep pattern must exclude BOTH `docs/` (historical) AND `.claude/workflows` (the legitimate
runtime *symlink destination* `~/.claude/workflows/ultrapowers-development.js`, which correctly
keeps that substring, do NOT change those):

Run (include extensionless `NOTICE`/`LICENSE`, they reference the engine source too and the
`--include` globs miss them): `grep -rn "workflows/ultrapowers-development" . --include='*.sh' --include='*.md' --include='*.json' NOTICE LICENSE | grep -v '\.claude/worktrees' | grep -v 'docs/' | grep -v '\.claude/workflows'`

Every remaining hit is a stale reference to the moved engine *source* (`README.md`, `HANDOFF.md`,
`bench/README.md`, `tests/re-witness-red/*`, `NOTICE`). Update each `workflows/ultrapowers-development`
→ `workflow/ultrapowers-development` (the engine moved; these now point at a nonexistent path).
**Leave untouched** any line containing `.claude/workflows/` (symlink dest, correct).
Re-run the grep; expected: **empty**.

- [ ] **Step 5: Verify bench can still resolve the engine path**

Run: `bash -c 'SCRIPT_DIR=bench; WORKFLOW_JS="$(cd "$SCRIPT_DIR/.." && pwd)/workflow/ultrapowers-development.js"; test -f "$WORKFLOW_JS" && echo "engine resolves: $WORKFLOW_JS"'`
Expected: `engine resolves: .../workflow/ultrapowers-development.js`

- [ ] **Step 6: Re-run the hook test (target now exists)**

Run: `bash tests/hook/test-session-start.sh`
Expected: `PASS test-session-start` (symlink target now resolves to a real file).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(plugin): move engine workflows/ -> workflow/; repoint bench/run.sh"
```

---

### Task 4: Reference docs (lifted, not invented)

**Files:**
- Create: `reference/task-list.md`
- Create: `reference/harness.md`
- Create: `reference/re-witness-red.md`
- Create: `reference/gating.md`

> **Lift rule:** these are concise operational extracts of existing prose. Do **not** invent new claims. Pull each from its source and preserve every honesty caveat verbatim. Sources are listed per file.

- [ ] **Step 1: `reference/task-list.md`**, source: `~/.claude/projects/-Users-lucian-Repos-ultrapowers/memory/ultrapowers-workflow-task-args-gotchas.md`

Content:

```markdown
# Task-list format (`--tasks`)

`args.tasks` MUST be an array of `{id: string, spec: string}` objects.

- `id`, short unique slug (e.g. `"db-open"`).
- `spec`, the full task instruction (a rich multi-line string is fine).

**Footgun (silent):** bare strings are **silently dropped**. The shape is never
validated; the build loop filters out any entry lacking a truthy `.id`, so a list of
plain strings yields a "successful" run that builds **nothing** (`0 built / total:0`,
no error). The `/workflows-driven-development` command therefore **rejects** a `--tasks`
payload whose entries are not `{id,spec}` objects, failing loud with this guidance.

Example:

\```json
{ "tasks": [
  { "id": "db-open",  "spec": "Implement openDatabase(path) ... (full TDD spec)" },
  { "id": "db-close", "spec": "Implement close() ..." }
] }
\```
```

- [ ] **Step 2: `reference/harness.md`**, source: `docs/decisions/README.md` (ADR-0001) + engine arg surface (plan header)

Content (lift ADR-0001 summary + the arg table; keep it operational):

```markdown
# The harness (Workflow coordinator)

The engine is a deterministic JS **Workflow** (`workflow/ultrapowers-development.js`,
`meta.name: ultrapowers-development`). Per ADR-0001, hosting the SDD loop on the Workflow
primitive keeps intermediate `agent()` results in script variables (never re-entering an
LLM context) → the coordinator session stays flat over long runs. Trade-off: a Workflow
cannot pause mid-run for input, so human gates live in the command, before/after dispatch.

## Args the command may pass
| arg | default | meaning |
|---|---|---|
| `tasks` |, | `[{id,spec}]` pre-decomposed list (skips planning) |
| `goal` |, | goal to decompose (planning mode) |
| `verifyCmd` |, | deterministic test command (the gate) |
| `repoDir` | session cwd | absolute path to the target repo |
| `commit` | false | per-task git commits (**required** for re-witness RED) |
| `implementer` | `codex` (product passes `claude`) | implementer CLI: `claude`\|`codex`\|`gemini` |
| `implModel` | `sonnet` | model for the `claude` implementer |
| `redWitness` | true | mechanical re-witness RED (see reference/re-witness-red.md) |
| `loopUntilClean` | false | `--thorough` completeness critic (goal mode only) |
| `maxRounds` | 3 | replan-loop ceiling |
| `maxTasks` | 50 | total-task ceiling |

## Model routing (least-powerful-per-role)
implementer = cheap (`implModel`); reviewers / critic / integration = `opus`;
verify + re-witness relays = `haiku`; graduated escalation to `opus` on repeated
implementer failure.
```

- [ ] **Step 3: `reference/re-witness-red.md`**, source: `docs/decisions/README.md` (ADR-0002) + spec §6 (preserve the evidence caveat verbatim)

Content:

```markdown
# re-witness RED (ADR-0002), the headline mechanism

After a task's suite goes green, revert **only the production files** changed by this task
(keep the tests), and re-run the suite. If it is **still green**, the test never exercised
the implementation → send the task back to the implementer. Then restore the production
files.

- **Default-on**, one `haiku` call/task, **fail-open** (never blocks on its own error).
- **Gated** on `commit:true` + a `verifyCmd`, silently inert without them.
- **Boundary:** P1-strip catches *non-dependent* tests. Weak-but-dependent tests
  (e.g. type-only assertions) need a P2 mutant pass, deliberately **not** shipped in v1.
- **Evidence status (honest):** proven on a *seeded vacuous test* (`tests/re-witness-red/`);
  it has **not yet fired on an organic benchmark task**. The headline is the mechanism +
  the model-fair eval, with this caveat stated, not hidden.
```

- [ ] **Step 4: `reference/gating.md`**, source: `docs/design/gating-and-escalation.md`

Content:

```markdown
# Deterministic gating & escalation

All gates are **binary + bounded**, never confidence-scored.

- **Gate A (verify/fix-loop):** fires on deterministic signals, test exit code,
  re-witness RED, blocking-severity findings, bounded at `MAX_FIX = 3` rounds; anti-thrash
  guard stops if blocking findings don't shrink for 2 consecutive rounds.
- **Gate B (replan/critic):** critic returns binary `{clean: true|false}`; loops until clean
  or `maxRounds`/budget hit. Opt-in via `loopUntilClean:true` (**goal mode only**).
- **Gate C (escalate to human):** named terminal conditions (implementer blocked,
  no-progress, max-fix exhausted, review unavailable, integration veto, budget ceiling,
  degraded) set `needsHuman:true` for the command's critical-review gate; graduated first
  (e.g. try decompose before escalating).
```

- [ ] **Step 5: Verify each file is non-empty and renders**

Run: `for f in reference/*.md; do echo "== $f =="; head -3 "$f"; done; ls reference | wc -l`
Expected: 4 files, each with a `#` title.

- [ ] **Step 6: Commit**

```bash
git add reference/
git commit -m "docs(plugin): add load-on-demand reference/ docs (lifted from ADRs/gating/memory)"
```

---

### Task 5: Rename + rewrite the command

**Files:**
- Move+rewrite: `commands/ultrapowers.md` → `commands/workflows-driven-development.md`

- [ ] **Step 1: git mv (preserve history)**

```bash
git mv commands/ultrapowers.md commands/workflows-driven-development.md
```

- [ ] **Step 2: Replace the file contents**

Write `commands/workflows-driven-development.md` (full content, this is the user-only entry; it owns the gates, the modes, the validation, and dispatch). Preserve the existing two-gate structure; add `disable-model-invocation`, `--thorough` (goal-only) + `--tasks` validation, `implementer:"claude"` default, and reference pointers via `${CLAUDE_PLUGIN_ROOT}`:

````markdown
---
description: "Unattended SDD build harness, strict TDD, model-routed, two-stage fail-closed review, mechanical re-witness-RED. Human gates ONLY at plan approval + critical review. Complements superpowers."
disable-model-invocation: true
---

# /workflows-driven-development

User-only entry to the **ultrapowers** harness. Spends real tokens → never auto-invoked.
You (the model running this command) own the two human gates and dispatch the deterministic
Workflow engine. Do **not** re-implement the loop, dispatch the engine.

## Usage
```
/workflows-driven-development <goal>                 plan → build the planned tasks → stop
/workflows-driven-development <goal> --thorough      + completeness-critic loop until clean (GOAL MODE ONLY)
/workflows-driven-development --tasks <tasks.json>    advanced: run a pre-decomposed [{id,spec}] list
/workflows-driven-development help                   modes, cost, task-list format
```

## On `help`
Print the Usage block above, then: "default = one disciplined pass; `--thorough` adds a
completeness critic that loops until no new findings (goal mode only). Built-in always-on:
strict TDD, two-stage opus review (fail-closed), re-witness RED, per-task commit. Task-list
format: see `${CLAUDE_PLUGIN_ROOT}/reference/task-list.md`." Then stop.

## Workspace isolation (do first, before any gate)
If the target repo is on `main`/`master`, create a feature worktree/branch first
(`EnterWorktree` or `git checkout -b feature/<goal-slug>`). The harness commits per task.

## GATE 1, plan approval (goal mode)
For a `<goal>`: dispatch planning only, then present the task list to the human.
```
Workflow({ name:'ultrapowers-development', args:{ goal:<goal>, planOnly:true } })
```
Show the proposed tasks and ask: **Approve this plan / edit / abort?** Do not build until approved.
> A Workflow cannot pause mid-run (ADR-0001), so approval happens *before* the build dispatch.

For `--tasks <file>`: **validate first.** Read the file; if any entry is not a
`{id,spec}` object, **reject** with: "tasks must be `[{id,spec}]` objects, bare strings are
silently dropped (see `${CLAUDE_PLUGIN_ROOT}/reference/task-list.md`)." If `--thorough` was
also passed, **warn**: "`--thorough` is ignored in --tasks mode (the completeness critic runs
in goal mode only)." Then skip to dispatch.

## Dispatch (the build)
Default args (product defaults, `implementer:"claude"` so a clean install needs no external CLI):
```
Workflow({ name:'ultrapowers-development', args:{
  // one of:
  goal:  <approved goal>,            // goal mode
  tasks: <validated [{id,spec}]>,    // --tasks mode
  repoDir: '<abs path of the build dir>',
  verifyCmd: <the project's test command>,
  implementer: 'claude',
  implModel: 'sonnet',
  commit: true,
  loopUntilClean: <true only if --thorough AND goal mode>,
  logFile: '<repoDir>/.claude/ultrapowers-run.jsonl',
  maxRounds: 3, maxTasks: 50
} })
```
> **Dispatch fallback:** if by-name resolution fails (the engine symlink may not be live in a
> freshly-installed session), dispatch the same args with
> `scriptPath: '${CLAUDE_PLUGIN_ROOT}/workflow/ultrapowers-development.js'` instead of `name`.

## GATE 2, critical review (on return)
Surface the final JSON + the per-model token/cost report. If the result sets
`needsHuman:true`, `integration.approved === false`, or a `stopped`/`degraded`/`BLOCKED`
flag, present it and ask: **accept / send back / raise the model ceiling?** Otherwise report
the green summary (tasks built, tests, re-witness outcomes).

## Reference (Read on demand, don't preload)
- task-list format + footgun → `${CLAUDE_PLUGIN_ROOT}/reference/task-list.md`
- engine args + model routing → `${CLAUDE_PLUGIN_ROOT}/reference/harness.md`
- re-witness RED (mechanism + evidence caveat) → `${CLAUDE_PLUGIN_ROOT}/reference/re-witness-red.md`
- deterministic gating/escalation → `${CLAUDE_PLUGIN_ROOT}/reference/gating.md`
````

- [ ] **Step 3: Verify frontmatter + no stale `/ultrapowers` self-references**

Run: `head -4 commands/workflows-driven-development.md; echo '---'; grep -n 'ultrapowers-development\|disable-model-invocation\|implementer' commands/workflows-driven-development.md; echo '--- stale check ---'; grep -n '/ultrapowers\b' commands/workflows-driven-development.md || echo "no stale /ultrapowers alias refs"`
Expected: frontmatter has `disable-model-invocation: true`; dispatch uses `name:'ultrapowers-development'` + `implementer:'claude'`; no stale `/ultrapowers` references (or only an intentional alias note).

- [ ] **Step 4: Commit**

```bash
git add commands/
git commit -m "feat(plugin): rename /ultrapowers -> /workflows-driven-development (user-only, modes, validation, claude default)"
```

---

### Task 6: SECURITY.md (P0, unattended code execution)

**Files:**
- Create: `SECURITY.md`

- [ ] **Step 1: Write `SECURITY.md`**

```markdown
# Security

ultrapowers is an **unattended build harness**: when you run
`/workflows-driven-development`, it dispatches a Workflow that **writes files, runs your
project's test/verify command, and makes git commits** in the target repo on your behalf,
across many disposable subagents, with human gates only at plan-approval and critical-review.

## What this means for you
- **Run it on code and in a repo you trust**, ideally in an isolated worktree/branch (the
  command creates one if you're on `main`). The harness commits per task; review the branch
  before merging.
- **`verifyCmd` is executed.** Whatever you pass as the verify/test command runs on your
  machine with your permissions. Do not point it at untrusted scripts.
- **External implementer CLIs are opt-in.** The product default `implementer:"claude"` needs
  no external CLI. `codex`/`gemini` shell out to those tools only if you select them.
- **The SessionStart hook** creates one symlink in `~/.claude/workflows/` pointing at the
  bundled engine. It never clobbers an existing real file and is removable (the symlink
  dangles harmlessly if the plugin is uninstalled).

## Reporting
Open a private security report via the repository's security advisories, or contact the
maintainer. Do not file public issues for sensitive vulnerabilities.
```

- [ ] **Step 2: Commit**

```bash
git add SECURITY.md
git commit -m "docs: add SECURITY.md (unattended code-execution disclosure)"
```

---

### Task 7: Integration verification

**Files:**
- Create: `tests/check-engine.sh` (engine syntax-check helper)
- Modify: `package.json` (`scripts.check`, fix the broken `node --check`)
- (verification only otherwise; may touch `README.md`/`HANDOFF.md` for install docs)

> **Plan correction (engine validation):** the engine is a **Workflow-format** script, it has
> top-level `return`/`await` (valid in the runtime's async wrap) plus `export const meta`, so it
> is neither a pure ESM module nor CommonJS. Stock `node --check` **rejects it** ("Illegal return
> statement" at the top-level `return`). The correct syntax check strips the `export` keyword and
> compiles the body as an async IIFE via `vm.Script` (parse-only). Task 1's `package.json`
> `scripts.check` (`node --check …`) is therefore broken-as-written and is fixed here.

- [ ] **Step 1: Create the engine syntax-check helper `tests/check-engine.sh`**

```bash
#!/usr/bin/env bash
# Syntax-check the Workflow engine the way the runtime loads it: strip the `export`
# keyword(s) and compile the body as an async IIFE (parse-only via vm.Script). Stock
# `node --check` rejects the engine's top-level `return`/`await`; this does not.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
node --input-type=commonjs -e '
  const fs = require("fs");
  const s = fs.readFileSync(process.argv[1], "utf8").replace(/^export\s+/gm, "");
  new (require("vm").Script)("(async()=>{" + s + "\n})()");
  console.log("engine syntax ok");
' "$ROOT/workflow/ultrapowers-development.js"
```
Run: `bash tests/check-engine.sh`
Expected: `engine syntax ok`.

- [ ] **Step 2: Fix `package.json` `scripts.check`**, change `"check": "node --check workflow/ultrapowers-development.js"` to `"check": "bash tests/check-engine.sh"`. Verify: `node -e 0` not needed, run `bash tests/check-engine.sh` (already green above).

- [ ] **Step 3: Engine + all JSON valid**

Run: `bash tests/check-engine.sh && for f in package.json .claude-plugin/plugin.json .claude-plugin/marketplace.json hooks/hooks.json; do python3 -m json.tool "$f" >/dev/null || { echo "BAD $f"; exit 1; }; done && echo "all json ok"`
Expected: `engine syntax ok` then `all json ok`, exit 0.

- [ ] **Step 4: Hook test green (final)**

Run: `bash tests/hook/test-session-start.sh`
Expected: `PASS test-session-start`.

- [ ] **Step 5: re-witness mechanism proof still works**

Run: `bash tests/re-witness-red/seed.sh >/dev/null && echo "seed ok"`
Expected: `seed ok` (the seed harness still builds its three controlled repos).

- [ ] **Step 6: bench dry-run smoke (engine path resolves end-to-end)**

Run: `bash bench/run.sh --help 2>/dev/null || grep -n 'workflow/ultrapowers-development.js' bench/run.sh`
Expected: `bench/run.sh:31` now references `workflow/` (confirms the repoint; a full dry-run is optional and costs nothing only with `--dry-run`).

- [ ] **Step 7: Plugin install smoke (manual, document the steps)**

Add an **Install** section to `README.md` and verify the steps yourself:
```
/plugin marketplace add /Users/lucian/Repos/ultrapowers
/plugin install ultrapowers@ultrapowers-dev
# new session → SessionStart hook runs → ~/.claude/workflows/ultrapowers-development.js symlink exists
/workflows-driven-development help
```
Verify: `ls -l ~/.claude/workflows/ultrapowers-development.js` shows a symlink into the plugin; `/workflows-driven-development help` resolves and prints modes.
> If the command does not resolve by name in the same session, fall back to the documented
> `scriptPath` dispatch and note the session-restart caveat (the `[impl-verify]` ordering flag).

- [ ] **Step 8: Commit**

```bash
git add tests/check-engine.sh package.json README.md HANDOFF.md 2>/dev/null; git commit -m "test(plugin): engine syntax-check helper + fix package.json check; install docs; verify plugin loads" || echo "nothing to commit"
```

---

### Task 8: NOTICE legal name (user decision, do not invent)

**Files:**
- Modify: `NOTICE:29`

- [ ] **Step 1: Resolve the legal-name TODO, ASK the user**

`NOTICE:29` reads: *"Maintainer note: set your own legal name / org in LICENSE and in the copyright line above before any public release."* This is a **P0 pre-launch blocker** and a **legal identity decision**, do not guess a name. Ask the user: *"For LICENSE/NOTICE copyright, ship as `Lucian (@7xuanlu)` or a different legal name/org?"* Apply their answer to `NOTICE` (copyright line + remove the maintainer-note TODO) and `LICENSE`.

- [ ] **Step 2: Commit**

```bash
git add NOTICE LICENSE
git commit -m "chore: set copyright legal name; close NOTICE pre-release TODO"
```

---

## Final integration review (after all tasks)

Per the project's superpowers:subagent-driven-development config: after the last task, dispatch a fresh
adversarial fresh-eye review of the integrated plugin before any merge to `main`. Check:
manifests valid + discoverable; hook idempotent/no-clobber/repoint; engine moved with no
dangling refs (3 call-sites reconciled); command is user-only with working `--tasks`
validation + `--thorough` goal-only guard + `claude` default + reference pointers; reference
docs preserve every honesty caveat (esp. re-witness "not yet fired on an organic task");
SECURITY.md present; NOTICE legal name resolved. Then finish the branch (PR to `main`).
