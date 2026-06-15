#!/usr/bin/env bash
# bench/run.sh — head-to-head orchestrator: superpowers (ARM A) vs ultrapowers (ARM B).
#
# Runs the SAME fixed task list (bench/tasks.json) through both architectures, N times each, and
# collects token meters + wall-clock + final repo state into bench/results/<timestamp>/. Idempotent:
# every arm/run gets a fresh `cp -R` of the byte-identical template; nothing reuses a dirty tree.
#
# Arms (matched pairs — see bench/README.md §F14):
#   A-sonnet   superpowers, coordinator --model sonnet   (SDD "standard" reading)
#   A-opus     superpowers, coordinator --model opus     (SDD "most-capable" reading)
#   B-parity   ultrapowers, redWitness:false             (cost-matched review stage set)
#   B-full     ultrapowers, as shipped (re-witness ON)   (what-you-actually-get)
#
# HONESTY: every value that must come from the real `claude` CLI is written into the result JSON as a
# `TODO(real-cli)` marker, NOT a fabricated number. Token field names are pinned against a real
# transcript before any campaign (bench/README.md §6). This script does the DETERMINISTIC scaffolding
# (provision, dispatch, collect, metering plumbing); it never invents a measurement.
#
# Usage:  bash bench/run.sh --runs N [--arms "A-sonnet A-opus B-parity B-full"] [--tasks FIXTURE.json] [--prefix N] [--dry-run]
#
# Verified runnable shape with `bash -n bench/run.sh`. Requires: bash, git, jq. `claude` is required
# only for a real (non --dry-run) campaign.

set -euo pipefail

# ─────────────────────────────── paths & defaults ───────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BENCH_DIR="$SCRIPT_DIR"
# ARM B drives the ultrapowers Workflow by scriptPath (the repo's source-of-truth copy), so the
# benchmark pins the exact file under test rather than whatever happens to be installed in ~/.claude.
WORKFLOW_JS="$(cd "$SCRIPT_DIR/.." && pwd)/workflow/ultrapowers-development.js"
TEMPLATE_DIR="$BENCH_DIR/fixtures/target-repo-template"
TASKS_JSON="$BENCH_DIR/tasks.json"
RUNS_ROOT="$BENCH_DIR/runs"
TS="$(date +%Y%m%d-%H%M%S)"
RESULTS_DIR="$BENCH_DIR/results/$TS"
RESULTS_JSON="$BENCH_DIR/results/$TS.json"

N=1
ARMS="A-sonnet A-opus B-parity B-full"
DRY_RUN=0
VERIFY_CMD="node --test"
# Per-run $ circuit-breaker for the real invocation — a runaway backstop set well above any legit run
# (A-sonnet/B ~ $2-5, A-opus 2-task ~ $10-20). NOT the budget control; it only stops a pathological
# loop in an unattended campaign. Override via env: CAMPAIGN_MAX_BUDGET=NN bash run.sh ...
CAMPAIGN_MAX_BUDGET="${CAMPAIGN_MAX_BUDGET:-50}"
# Scaling study (council fix #2): run a deterministic CUMULATIVE PREFIX of a FIXED ordered fixture.
# --tasks <file> swaps the built-in 2-task heredoc for an ordered fixture; --prefix <N> keeps only the
# first N tasks (identical bytes for every arm/run, sha-pinned AFTER slicing) so the ladder
# {6,12,24,...} measures cumulative-work scaling, not per-task difficulty (which cancels in the A-B delta).
TASKS_SRC=""
TASKS_PREFIX=""

# ─────────────────────────────── arg parse ───────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --runs)    N="$2"; shift 2 ;;
    --arms)    ARMS="$2"; shift 2 ;;
    --tasks)   TASKS_SRC="$2"; shift 2 ;;
    --prefix)  TASKS_PREFIX="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help)
      sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "run.sh: unknown arg '$1'" >&2; exit 2 ;;
  esac
done

need() { command -v "$1" >/dev/null 2>&1 || { echo "run.sh: missing required tool '$1'" >&2; exit 2; }; }
need git
need jq
if [ "$DRY_RUN" -eq 0 ]; then need claude; fi

mkdir -p "$RESULTS_DIR" "$RUNS_ROOT"

# ─────────────────────────────── fixtures: template + tasks.json ───────────────────────────────
# Idempotent: (re)create the byte-identical target template if absent. One template, all arms/runs.
ensure_template() {
  if [ -d "$TEMPLATE_DIR" ]; then return; fi
  echo "run.sh: creating target-repo template at $TEMPLATE_DIR"
  mkdir -p "$TEMPLATE_DIR/src" "$TEMPLATE_DIR/test"
  printf '%s\n' '{ "name": "bench-target", "type": "module", "scripts": { "test": "node --test" } }' \
    > "$TEMPLATE_DIR/package.json"
  : > "$TEMPLATE_DIR/src/.gitkeep"
  : > "$TEMPLATE_DIR/test/.gitkeep"
  printf '%s\n' 'Bench target. Implement tasks under src/, test under test/.' > "$TEMPLATE_DIR/README.md"
  printf '%s\n' 'node_modules' > "$TEMPLATE_DIR/.gitignore"
  # Pin the measuring machine's Node version so a minor bump can't silently perturb node:test output.
  ( node --version 2>/dev/null || echo 'v18' ) > "$TEMPLATE_DIR/.nvmrc"
}

# Idempotent: regenerate tasks.json from the canonical heredoc. This is THE single task source —
# ARM B reads it as args.tasks; ARM A gets it pasted verbatim. The .md files under tasks/ mirror it.
ensure_tasks() {
  cat > "$TASKS_JSON" <<'TASKS_EOF'
[
  {
    "id": "slugify",
    "spec": "Implement `slugify(input: string): string`, default-exported from src/slugify.js, with tests in test/slugify.test.js using node:test (import { test } from 'node:test') and node:assert/strict.\n\nAcceptance criteria (each is one test case):\n1. Lowercases: \"Hello\" -> \"hello\"\n2. Spaces (incl. runs) -> single hyphens: \"a  b   c\" -> \"a-b-c\"\n3. Strips non-alphanumeric except hyphen: \"Café!! #1\" -> \"caf-1\" (drop accents/punctuation; a non-alnum char becomes a hyphen boundary, not retained)\n4. Trims leading/trailing hyphens: \"  -hi-  \" -> \"hi\"\n5. Collapses multiple hyphens: \"a---b\" -> \"a-b\"\n6. Empty / all-punctuation input -> \"\": \"\" -> \"\", \"!!!\" -> \"\"\n\nTDD: write test/slugify.test.js FIRST with the 6 cases above; watch them fail (module missing) -- that is RED. Then implement to GREEN.\n\nConstraints: no external dependencies; single responsibility (slug function only, no CLI, no extra exports beyond the default).\n\nVerify: `node --test` exits 0 with the 6 slugify tests passing."
  },
  {
    "id": "parseDuration",
    "spec": "Implement `parseDuration(input: string): number`, default-exported from src/parseDuration.js, returning the total MILLISECONDS for a human duration string. Tests in test/parseDuration.test.js (node:test + node:assert/strict).\n\nGrammar: one or more whitespace-tolerant <number><unit> segments, summed. Units (case-insensitive): ms, s, m, h, d -> 1, 1000, 60000, 3600000, 86400000. Numbers may be integers or decimals (\"1.5h\"). Segments may be space-separated (\"1h 30m\") or concatenated (\"1h30m\"). A bare number with no unit is INVALID.\n\nAcceptance criteria (each >=1 test case):\n1. Single segment: \"500ms\"->500, \"2s\"->2000, \"1m\"->60000, \"1h\"->3600000, \"1d\"->86400000\n2. Decimal: \"1.5h\"->5400000, \"0.5s\"->500\n3. Multi-segment concatenated: \"1h30m\"->5400000\n4. Multi-segment spaced, mixed case: \"1H 30M 15s\"->5415000\n5. Leading/trailing whitespace tolerated: \"  2m  \"->120000\n6. INVALID -> throw a TypeError with a message containing the offending input: \"\", \"abc\", \"10\" (no unit), \"5x\" (bad unit), \"1.2.3s\" (bad number) all throw.\n\nTDD: write the test file FIRST covering all 6 groups incl. the throw cases (use assert.throws with the TypeError + message-substring check); watch RED; implement to GREEN.\n\nConstraints: no external dependencies; no regex catastrophic-backtracking on adversarial input; single responsibility (parser only, no CLI, no formatting helper, no exports beyond the default).\n\nVerify: `node --test` exits 0 with all parseDuration tests passing."
  }
]
TASKS_EOF
  # --tasks: swap the built-in heredoc for an external ORDERED fixture (validated).
  if [ -n "$TASKS_SRC" ]; then
    [ -f "$TASKS_SRC" ] || { echo "run.sh: --tasks file not found: $TASKS_SRC" >&2; exit 2; }
    jq empty "$TASKS_SRC" || { echo "run.sh: --tasks file is not valid JSON" >&2; exit 2; }
    cp "$TASKS_SRC" "$TASKS_JSON"
  fi
  jq empty "$TASKS_JSON" || { echo "run.sh: tasks.json is not valid JSON" >&2; exit 2; }
  # --prefix N (council fix #2): deterministic CUMULATIVE PREFIX of the fixed order. Same bytes for
  # every arm/run; sha pinned AFTER slicing. Task order is fixed + identical across arms so the
  # estimand is cumulative-work scaling, not per-task difficulty.
  if [ -n "$TASKS_PREFIX" ]; then
    case "$TASKS_PREFIX" in (''|*[!0-9]*) echo "run.sh: --prefix must be a positive integer" >&2; exit 2 ;; esac
    local total; total="$(jq 'length' "$TASKS_JSON")"
    if [ "$TASKS_PREFIX" -lt 1 ] || [ "$TASKS_PREFIX" -gt "$total" ]; then
      echo "run.sh: --prefix $TASKS_PREFIX out of range (fixture has $total tasks)" >&2; exit 2
    fi
    jq --argjson n "$TASKS_PREFIX" '.[0:$n]' "$TASKS_JSON" > "$TASKS_JSON.tmp" && mv "$TASKS_JSON.tmp" "$TASKS_JSON"
    echo "run.sh: cumulative prefix — first $TASKS_PREFIX of $total tasks"
  fi
}

# F1: pin the task bytes so neither arm can be fed a drifted spec.
TASKS_SHA=""
pin_tasks_sha() {
  if command -v sha256sum >/dev/null 2>&1; then TASKS_SHA="$(sha256sum "$TASKS_JSON" | awk '{print $1}')"
  else TASKS_SHA="$(shasum -a 256 "$TASKS_JSON" | awk '{print $1}')"; fi
  echo "run.sh: tasks.json sha256=$TASKS_SHA"
}

# ─────────────────────────────── provision (identical for every arm/run) ───────────────────────────────
# F2/F11: fresh cp -R of the template, git init + initial commit, then `eval` branch created OUT-OF-BAND
# for BOTH arms (so ARM A doesn't pay in-band for branch creation while B gets it free).
provision() { # $1 = destination repo dir
  local dir="$1"
  rm -rf "$dir"
  mkdir -p "$(dirname "$dir")"
  cp -R "$TEMPLATE_DIR" "$dir"
  git -C "$dir" init -q
  git -C "$dir" add -A
  git -C "$dir" -c user.name=bench -c user.email=bench@local commit -q -m "init: bench target template"
  git -C "$dir" checkout -q -b eval
}

# ─────────────────────────────── per-arm dispatch ───────────────────────────────
# ARM A prompt: same task bytes, fairness pins mandated in-prompt (audited post-hoc, see README §6).
build_arm_a_prompt() { # $1 = repo dir ; tasks JSON on stdin would be large, so read the file
  local dir="$1"
  cat <<PROMPT
Use the superpowers:subagent-driven-development skill to execute the task list below IN THIS REPO ($dir). It is already a fresh git repo on a branch called 'eval' (created for you; do NOT create or switch branches).

FAIRNESS PINS (mandatory, do not deviate):
- Dispatch every IMPLEMENTER subagent with model=sonnet.
- Dispatch BOTH reviewer subagents (spec compliance, then code quality) with model=opus.
- Verify each task with: $VERIFY_CMD
- Commit after each task: '[task:<id>] <summary>'.
- At most 3 fix rounds per task; if still failing, mark the task BLOCKED and move on.
- Do NOT add re-witness-RED, a completeness critic, or any task beyond those listed below. Run exactly the tasks listed below, in order, then do the final integration review.

TASKS (JSON, same bytes as ARM B):
$(cat "$TASKS_JSON")

When all tasks are done, run the final adversarial code review over the whole change as the skill specifies, then stop.
PROMPT
}

# ARM B prompt: drive the ultrapowers-development Workflow with the same task bytes.
build_arm_b_prompt() { # $1 = repo dir ; $2 = parity|full
  local dir="$1" mode="$2" extras=""
  [ "$mode" = "parity" ] && extras='"redWitness": false,'
  cat <<PROMPT
Call the Workflow tool with scriptPath "$WORKFLOW_JS" and the args below, then return the Workflow's final JSON result verbatim (nothing else):
{
  "tasks": $(cat "$TASKS_JSON"),
  "repoDir": "$dir",
  "verifyCmd": "$VERIFY_CMD",
  "implementer": "claude",
  "implModel": "sonnet",
  "commit": true,
  $extras
  "maxRounds": 3,
  "maxTasks": 50
}
PROMPT
}

# Execute one arm/run. Writes transcript.jsonl + stderr.log + meta.json into the run dir.
# In --dry-run mode it writes a stub transcript with TODO(real-cli) markers instead of calling claude.
execute() { # $1 = arm  $2 = run_id  $3 = repo dir  $4 = run dir
  local arm="$1" run_id="$2" repo="$3" rundir="$4"
  local transcript="$rundir/transcript.jsonl" stderr_log="$rundir/stderr.log"
  local prompt coord_model="" t_start t_end wall_ms

  case "$arm" in
    A-sonnet) coord_model="sonnet"; prompt="$(build_arm_a_prompt "$repo")" ;;
    A-opus)   coord_model="opus";   prompt="$(build_arm_a_prompt "$repo")" ;;
    B-parity) prompt="$(build_arm_b_prompt "$repo" parity)" ;;
    B-full)   prompt="$(build_arm_b_prompt "$repo" full)" ;;
    *) echo "run.sh: unknown arm '$arm'" >&2; return 2 ;;
  esac

  t_start="$(date +%s)"
  if [ "$DRY_RUN" -eq 1 ]; then
    # No real CLI: leave an explicit, un-fabricated marker. Metering will read TODO, not a fake number.
    printf '%s\n' '{"type":"result","TODO":"real-cli","note":"--dry-run: no claude invocation; tokens/cost not measured"}' \
      > "$transcript"
    printf '%s\n' "DRY RUN — would invoke: claude -p ${coord_model:+--model $coord_model} --output-format stream-json --verbose --permission-mode bypassPermissions" \
      > "$stderr_log"
  else
    # REAL invocation. Both arms run headless so both emit the same stream-json event shape.
    # NO --bare: this environment authenticates via OAuth/keychain, and --bare reads auth ONLY from
    # ANTHROPIC_API_KEY/apiKeyHelper (verified: --bare => "Not logged in" here). --bare also skips the
    # plugin + workflow auto-discovery both arms depend on (ARM A's superpowers plugin, ARM B's
    # Workflow). Verified non-bare: the superpowers skill auto-loads and the Workflow tool runs by
    # scriptPath. TRADE-OFF: non-bare also loads the global ~/.claude/CLAUDE.md into BOTH arms — a
    # SHARED, symmetric confound (it advantages neither arm differentially), the same condition under
    # which the accepted pilot ran. bypassPermissions (not acceptEdits) so an unattended run never
    # hangs on a Bash/git permission prompt.
    local extra_a=()
    [ -n "$coord_model" ] && extra_a=(--model "$coord_model")
    (
      cd "$repo" &&
      claude -p \
        "${extra_a[@]+"${extra_a[@]}"}" \
        --output-format stream-json --verbose \
        --permission-mode bypassPermissions \
        --max-budget-usd "$CAMPAIGN_MAX_BUDGET" \
        --append-system-prompt "Headless bench run; no human is watching; never ask to continue; execute all tasks to completion." \
        "$prompt"
    ) > "$transcript" 2> "$stderr_log" || echo "run.sh: WARN arm=$arm run=$run_id exited non-zero (see $stderr_log)" >&2
  fi
  t_end="$(date +%s)"
  wall_ms=$(( (t_end - t_start) * 1000 ))

  jq -n \
    --arg arm "$arm" --arg run "$run_id" --arg repo "$repo" \
    --arg coord "${coord_model:-n/a}" --arg sha "$TASKS_SHA" \
    --argjson wall "$wall_ms" --argjson dry "$DRY_RUN" \
    '{arm:$arm, run:($run|tonumber), repoDir:$repo, coordModel:$coord, tasksSha:$sha, wallMsScript:$wall, dryRun:($dry==1)}' \
    > "$rundir/meta.json"
}

# ─────────────────────────────── metering ───────────────────────────────
# Meter B (total billed) + Meter A (coordinator context) from a transcript, dedup-by-id, subagents
# included. If the transcript holds no real usage (dry run, or fields not yet pinned), every numeric
# slot is the string "TODO(real-cli)" — never a fabricated 0 dressed up as a measurement.
#
# TODO(real-cli): the field paths below (.message.usage.*, .parent_tool_use_id) are the documented
# shape but MUST be pinned against a real transcript from your installed `claude` version before a
# campaign (bench/README.md §6). headless.md confirms `result` carries total_cost_usd + a per-model
# cost breakdown and stream-json emits per-message events; the exact usage/parent_tool_use_id field
# names are [UNKNOWN] until you verify them locally. Do NOT trust these numbers until pinned.
meter() { # $1 = transcript ; emits a JSON object on stdout
  local t="$1"
  # Has any real per-message usage? (a dry-run stub has none)
  local has_usage
  has_usage="$(jq -s 'any(.[]; .type=="assistant" and (.message.usage != null))' "$t" 2>/dev/null || echo false)"
  if [ "$has_usage" != "true" ]; then
    jq -n '{
      meterB:{input:"TODO(real-cli)", output:"TODO(real-cli)", cache_create:"TODO(real-cli)", cache_read:"TODO(real-cli)"},
      meterA:{input:"TODO(real-cli)", output:"TODO(real-cli)"},
      cost:{total_cost_usd:"TODO(real-cli)", duration_ms:"TODO(real-cli)", duration_api_ms:"TODO(real-cli)", modelUsage:"TODO(real-cli)"},
      agentCount:"TODO(real-cli)",
      note:"no per-message usage in transcript (dry-run or field names not yet pinned)"
    }'
    return
  fi
  # Meter B (stream-sum) — Σ usage over ALL assistant msgs, dedup by id. Cross-arm-valid ONLY when the
  # stream carries subagents (streamCarriesSubagents below): TRUE for ARM A, FALSE for ARM B — its
  # Workflow runs subagents OFF this stream, so agentCount=0 and meterB==meterA. README §6 (corrected).
  local meterB meterA cost agent_count
  meterB="$(jq -s '
    [ .[] | select(.type=="assistant") | .message ] | unique_by(.id)
    | { input:        ([.[].usage.input_tokens]                     | add // 0),
        output:       ([.[].usage.output_tokens]                    | add // 0),
        cache_create: ([.[].usage.cache_creation_input_tokens // 0] | add // 0),
        cache_read:   ([.[].usage.cache_read_input_tokens // 0]     | add // 0) }
  ' "$t")"
  # Meter A — coordinator context only: usage on top-level (non-subagent) events.
  meterA="$(jq -s '
    [ .[] | select(.type=="assistant" and (.parent_tool_use_id|not)) | .message ] | unique_by(.id)
    | { input:([.[].usage.input_tokens]|add // 0), output:([.[].usage.output_tokens]|add // 0) }
  ' "$t")"
  # Price-weighted cost + per-model breakdown from the result message. total_cost_usd + modelUsage is
  # the rollup-correct CROSS-ARM headline — it rolls up subagent work for BOTH arms (verified vs the
  # N=5 campaign: B's modelUsage carries haiku+opus+sonnet its JS coordinator never ran).
  cost="$(jq -s '
    ([ .[] | select(.type=="result") ] | last)
    | { total_cost_usd:(.total_cost_usd // "TODO(real-cli)"),
        duration_ms:(.duration_ms // "TODO(real-cli)"),
        duration_api_ms:(.duration_api_ms // "TODO(real-cli)"),
        modelUsage:(.modelUsage // "TODO(real-cli)") }
  ' "$t")"
  # Distinct subagent count — cross-check vs the Workflow result's agent_count for ARM B (README §6).
  agent_count="$(jq -s '[ .[] | select(.type=="assistant" and (.parent_tool_use_id != null)) | .parent_tool_use_id ] | unique | length' "$t")"
  # streamCarriesSubagents = does the claude -p stream actually include subagent usage? (A: yes; B: no)
  local stream_subs="false"
  if [ "${agent_count:-0}" -gt 0 ] 2>/dev/null; then stream_subs="true"; fi
  jq -n --argjson b "$meterB" --argjson a "$meterA" --argjson c "$cost" --argjson n "$agent_count" \
        --argjson subs "$stream_subs" \
    '{ meterB:$b, meterA:$a, cost:$c, agentCount:$n,
       streamCarriesSubagents:$subs,
       headlineCostUsd:($c.total_cost_usd),
       meterNote:(if $subs
         then "meterB includes subagents (stream-carried); cross-arm token compare OK"
         else "meterB is COORDINATOR-ONLY (subagents off-stream, agentCount=0) — do NOT cross-compare meterB; use headlineCostUsd + modelUsage" end) }'
}

# ─────────────────────────────── collect outputs for the judge ───────────────────────────────
# Copy ONLY src/ + test/ (template scaffolding is identical across arms) + verify.txt + gitlog.txt.
collect() { # $1 = repo dir  $2 = run dir
  local repo="$1" rundir="$2" out="$rundir/output"
  mkdir -p "$out"
  [ -d "$repo/src" ]  && cp -R "$repo/src"  "$out/" 2>/dev/null || true
  [ -d "$repo/test" ] && cp -R "$repo/test" "$out/" 2>/dev/null || true
  if [ "$DRY_RUN" -eq 0 ]; then
    ( cd "$repo" && $VERIFY_CMD ) > "$out/verify.txt" 2>&1 || true
    echo "exit=$?" >> "$out/verify.txt" || true
  else
    printf '%s\n' 'TODO(real-cli): verify not run in --dry-run' > "$out/verify.txt"
  fi
  git -C "$repo" log --oneline --stat > "$out/gitlog.txt" 2>/dev/null || true
}

# ─────────────────────────────── main loop ───────────────────────────────
ensure_template
ensure_tasks
pin_tasks_sha

echo "run.sh: campaign $TS — N=$N, arms: $ARMS, dry-run=$DRY_RUN"
echo "run.sh: results -> $RESULTS_JSON"

# Accumulate every run's record into a results array file (idempotent: fresh per timestamp).
: > "$RESULTS_DIR/records.jsonl"

run_i=1
while [ "$run_i" -le "$N" ]; do
  for arm in $ARMS; do
    repo="$RUNS_ROOT/$arm/$run_i/repo"
    rundir="$RUNS_ROOT/$arm/$run_i"
    mkdir -p "$rundir"
    echo "run.sh: --- arm=$arm run=$run_i ---"
    provision "$repo"
    execute "$arm" "$run_i" "$repo" "$rundir"
    metered="$(meter "$rundir/transcript.jsonl")"
    collect "$repo" "$rundir"
    # One record per run, merging meta + meters.
    jq -s '.[0] * {metrics:.[1]}' "$rundir/meta.json" <(printf '%s' "$metered") \
      >> "$RESULTS_DIR/records.jsonl"
  done
  run_i=$(( run_i + 1 ))
done

# ─────────────────────────────── assemble the campaign result JSON ───────────────────────────────
# Group by arm; emit raw per-run records (publish the table, not just summary stats — README §7).
# Summary stats (median/SD/CIs) are computed by the analysis step, not fabricated here.
jq -s --arg ts "$TS" --arg sha "$TASKS_SHA" --argjson dry "$DRY_RUN" '
  {
    timestamp: $ts,
    tasksSha: $sha,
    dryRun: ($dry==1),
    arms: (group_by(.arm) | map({ (.[0].arm): . }) | add),
    records: .,
    note: "Per-run raw records. Summary stats (median/mean/SD/bootstrap-CI), the ARM-A routing audit, and the cost|success stratification are produced by the analysis step from these records — NOT precomputed here. Headline cross-arm cost = total_cost_usd + modelUsage (rolls up subagents for BOTH arms); meterB (stream-sum) is coordinator-only for ARM B — see streamCarriesSubagents per record (README §6, corrected 2026-06-14)."
  }
' "$RESULTS_DIR/records.jsonl" > "$RESULTS_JSON"

echo "run.sh: done. $RESULTS_JSON"
echo "run.sh: per-run trees under $RUNS_ROOT/<arm>/<run>/ ; judge inputs under .../output/"
[ "$DRY_RUN" -eq 1 ] && echo "run.sh: NOTE this was --dry-run; all token/cost fields are TODO(real-cli) placeholders."
exit 0
