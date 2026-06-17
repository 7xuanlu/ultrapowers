#!/usr/bin/env bash
# bench/safety-run.sh — Safety-path fixture runner (B-v6 only, H4).
#
# Exercises the v6 engine's risky paths: cannot_verify routing (cross-task-coupled),
# spec-fail block (spec-incomplete), and per-task baseSha diff scoping (Task 7).
#
# This is NOT a cost-comparison benchmark. It runs B-v6 only and asserts pass/fail outcomes:
#   (a) cross-task-coupled produces at least one cannotVerify entry in result.cannotVerify
#       [PROBABILISTIC: the structural coupling is real (per-task diff scoping excludes config-module's
#        commit from cross-task-coupled's reviewPackage), but whether the LLM reviewer emits
#        cannot_verify is non-deterministic. See bench/README.md §8.2.]
#   (b) if cannotVerify is non-empty, the engine must have routed to integration (result.integration
#       present) OR escalated to human (result.needsHuman contains "cross-task")
#   (c) if cannotVerify is non-empty, result.integration must be present (integration gate ran)
#   (d) spec-incomplete is NOT in result.passed (specVerdict='fail' path blocks it)
#   (e) spec-incomplete appears in result.failed[].task OR result.needsHuman (failure path actually fired)
#
# Multi-commit BASE..HEAD coverage: multi-commit diffs occur naturally when a task takes >1 fix
# round. This is unit-tested via the per-task baseSha scoping in tests/engine/h2-resume-cannotverify.test.mjs
# (Task 7), NOT separately forced here. See bench/tasks/multi-commit.md.
#
# Offline / CI mode: when `claude` is not on PATH, the script:
#   - runs all file-shape assertions it can (fixture JSON valid, scripts exist + syntax-clean)
#   - prints "requires live claude CLI — skipping live run"
#   - exits 0 so offline CI never spuriously fails
#
# Usage: bash bench/safety-run.sh [--dry-run]
#
# Verified syntax-clean with: bash -n bench/safety-run.sh
# Requires for live run: bash, git, jq, claude CLI on PATH.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ─── paths ───
TASKS="$SCRIPT_DIR/fixtures/safety-tasks.json"
WORKFLOW_JS="$ROOT/workflow/ultrapowers-development.js"
VERIFY_CMD="node --test"
RUNS_ROOT="$SCRIPT_DIR/runs"
TS="$(date +%Y%m%d-%H%M%S)"
OUT="$SCRIPT_DIR/results/safety-$TS"

DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help)
      sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "safety-run.sh: unknown arg '$1'" >&2; exit 2 ;;
  esac
done

# ─── offline file-shape assertions (always run, including in CI) ───
echo "safety-run.sh: checking file shapes..."

[ -f "$TASKS" ] || { echo "FAIL: missing $TASKS"; exit 1; }
jq empty "$TASKS" || { echo "FAIL: $TASKS is not valid JSON"; exit 1; }

task_count="$(jq 'length' "$TASKS")"
[ "$task_count" -eq 3 ] || { echo "FAIL: expected 3 tasks in $TASKS, got $task_count"; exit 1; }

for id in config-module cross-task-coupled spec-incomplete; do
  jq -e --arg id "$id" 'any(.[]; .id == $id)' "$TASKS" >/dev/null \
    || { echo "FAIL: missing task id '$id' in $TASKS"; exit 1; }
done

[ -f "$SCRIPT_DIR/tasks/cross-task-coupled.md" ] \
  || { echo "FAIL: missing bench/tasks/cross-task-coupled.md"; exit 1; }
[ -f "$SCRIPT_DIR/tasks/multi-commit.md" ] \
  || { echo "FAIL: missing bench/tasks/multi-commit.md"; exit 1; }
[ -f "$SCRIPT_DIR/tasks/spec-incomplete.md" ] \
  || { echo "FAIL: missing bench/tasks/spec-incomplete.md"; exit 1; }

bash -n "${BASH_SOURCE[0]}" || { echo "FAIL: syntax error in safety-run.sh"; exit 1; }

echo "safety-run.sh: file-shape assertions OK"

# ─── gate: live run requires claude on PATH ───
if ! command -v claude >/dev/null 2>&1; then
  echo "safety-run.sh: requires live claude CLI — skipping live run (offline/CI mode, exit 0)"
  exit 0
fi

if [ "$DRY_RUN" -eq 1 ]; then
  echo "safety-run.sh: --dry-run set — skipping live run"
  exit 0
fi

# ─── provision a fresh fixture repo (mirrors bench/run.sh provision()) ───
TEMPLATE_DIR="$SCRIPT_DIR/fixtures/target-repo-template"
REPO_DIR="$RUNS_ROOT/B-v6-safety/$TS/repo"

ensure_template() {
  if [ -d "$TEMPLATE_DIR" ]; then return; fi
  echo "safety-run.sh: creating target-repo template at $TEMPLATE_DIR"
  mkdir -p "$TEMPLATE_DIR/src" "$TEMPLATE_DIR/test"
  printf '%s\n' '{ "name": "bench-target", "type": "module", "scripts": { "test": "node --test" } }' \
    > "$TEMPLATE_DIR/package.json"
  : > "$TEMPLATE_DIR/src/.gitkeep"
  : > "$TEMPLATE_DIR/test/.gitkeep"
  printf '%s\n' 'Bench target. Implement tasks under src/, test under test/.' > "$TEMPLATE_DIR/README.md"
  printf '%s\n' 'node_modules' > "$TEMPLATE_DIR/.gitignore"
  ( node --version 2>/dev/null || echo 'v18' ) > "$TEMPLATE_DIR/.nvmrc"
}

ensure_template

rm -rf "$REPO_DIR"
mkdir -p "$(dirname "$REPO_DIR")"
cp -R "$TEMPLATE_DIR" "$REPO_DIR"
git -C "$REPO_DIR" init -q
git -C "$REPO_DIR" add -A
git -C "$REPO_DIR" -c user.name=bench -c user.email=bench@local commit -q -m "init: bench target template"
git -C "$REPO_DIR" checkout -q -b eval

echo "safety-run.sh: repo provisioned at $REPO_DIR"

# ─── run B-v6 arm (mirrors build_arm_b_version_prompt / execute() in bench/run.sh) ───
mkdir -p "$OUT"
TRANSCRIPT="$OUT/transcript.jsonl"
STDERR_LOG="$OUT/stderr.log"
RESULT="$OUT/result.json"

SAFETY_MAX_BUDGET="${SAFETY_MAX_BUDGET:-5}"

PROMPT="Call the Workflow tool with scriptPath \"$WORKFLOW_JS\" and the args below, then return the Workflow's final JSON result verbatim (nothing else):
{
  \"tasks\": $(cat "$TASKS"),
  \"repoDir\": \"$REPO_DIR\",
  \"verifyCmd\": \"$VERIFY_CMD\",
  \"implementer\": \"claude\",
  \"implModel\": \"sonnet\",
  \"commit\": true,
  \"redWitness\": false,
  \"maxRounds\": 3,
  \"maxTasks\": 50
}"

echo "safety-run.sh: launching B-v6 arm on safety-tasks.json..."
(
  cd "$REPO_DIR" &&
  claude -p \
    --output-format stream-json --verbose \
    --permission-mode bypassPermissions \
    --max-budget-usd "$SAFETY_MAX_BUDGET" \
    --append-system-prompt "Headless bench run; no human is watching; never ask to continue; execute all tasks to completion." \
    "$PROMPT"
) > "$TRANSCRIPT" 2> "$STDERR_LOG" \
  || echo "safety-run.sh: WARN claude exited non-zero (see $STDERR_LOG)" >&2

# Extract the Workflow result JSON from the last result-type event in the transcript.
jq -s '[ .[] | select(.type=="result") ] | last | .result // .' "$TRANSCRIPT" > "$RESULT" \
  || { echo "FAIL: could not extract result from transcript at $TRANSCRIPT"; exit 1; }

echo "safety-run.sh: result written to $RESULT"

# ─── assertions ───
echo "safety-run.sh: running assertions..."

# C1 (a): cannotVerify non-empty — PROBABILISTIC: structural coupling is real (per-task diff scoping
# excludes config-module's commit from cross-task-coupled's reviewPackage), but LLM-judgment whether
# the reviewer emits cannot_verify. See bench/README.md §8.2 for the probabilistic-assertion note.
jq -e '.cannotVerify | length > 0' "$RESULT" >/dev/null \
  || { echo "FAIL: no cannot_verify entry produced by the cross-task-coupled task"; exit 1; }

# C1 (b) / I1: if cannotVerify is non-empty, integration must have run (result.integration != null).
# This catches a bug where cannot_verify is emitted but the integration gate is skipped.
jq -e 'if (.cannotVerify | length > 0) then .integration != null else true end' "$RESULT" >/dev/null \
  || { echo "FAIL: cannotVerify is non-empty but result.integration is null (integration gate skipped)"; exit 1; }

# C1 (b): if cannotVerify is non-empty, engine must route to integration OR escalate to human.
# Ties the cannot_verify ⚠️ to H3 (integration gate) as well as H4 (cannot_verify field).
jq -e 'if (.cannotVerify | length > 0)
       then (.integration != null) or ((.needsHuman // []) | index("cross-task") != null)
       else true end' "$RESULT" >/dev/null \
  || { echo "FAIL: cannotVerify is non-empty but neither integration ran nor needsHuman contains cross-task"; exit 1; }

# I2: spec-incomplete must NOT be in passed
jq -e '(.passed | index("spec-incomplete")) == null' "$RESULT" >/dev/null \
  || { echo "FAIL: spec-incomplete task wrongly in passed (spec-fail block not triggered)"; exit 1; }

# I2 (strengthened): the failure path must actually have fired — spec-incomplete must appear in
# failed[].task OR in needsHuman (can't be just "never ran")
jq -e '(([.failed[]?.task] | index("spec-incomplete")) != null)
       or ((.needsHuman // []) | index("spec-incomplete") != null)' "$RESULT" >/dev/null \
  || { echo "FAIL: spec-incomplete is absent from both result.failed[].task and result.needsHuman (failure path may not have fired)"; exit 1; }

echo "safety-run.sh: safety-path ok"
echo "safety-run.sh: results -> $OUT"
exit 0
