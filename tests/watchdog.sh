#!/usr/bin/env bash
# Verify-the-verifier for Component C: prove the structural watchdog the engine wraps gate
# commands in (verify / redWitness / integration / codex) actually (a) passes a command's exit
# code through, (b) SIGKILLs a hung command at the deadline returning 124, (c) kills the whole
# process GROUP (not just the direct child), and (d) returns control gracefully so a trailing
# `; echo "__RC__=$?"` still runs — the marker the fix-loop reads survives the kill.
#
# The perl one-liner is EXTRACTED from the engine (const WATCHDOG_PERL) so this test exercises
# the real construct and cannot drift from it. If the engine lacks WATCHDOG_PERL, this fails RED.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENGINE="$ROOT/workflow/ultrapowers-development.js"

WD="$(node -e '
  const fs=require("fs");
  const s=fs.readFileSync(process.argv[1],"utf8");
  const m=s.match(/const WATCHDOG_PERL = `([^`]*)`/);
  if(!m){console.error("WATCHDOG_PERL const not found in engine");process.exit(2)}
  process.stdout.write(m[1]);
' "$ENGINE")" || { echo "FAIL: could not extract WATCHDOG_PERL from engine"; exit 1; }

fails=0
ok(){ echo "ok   - $1"; }
no(){ echo "FAIL - $1"; fails=$((fails+1)); }

# run <script-body> <timeout_sec> [trailer] -> echoes "<rc>|<stdout>"
run(){
  local f; f="$(mktemp "${TMPDIR:-/tmp}/wd_XXXXXX.sh")"
  printf '%s\n' "$1" > "$f"
  local out rc
  out="$(eval "$WD $2 \"$f\" sh ${3:-}" 2>/dev/null)"; rc=$?
  rm -f "$f"
  printf '%s|%s' "$rc" "$out"
}

# (a) passthrough: exit 0 and a non-zero code both propagate
[ "$(run 'exit 0' 5)" = "0|" ] && ok "passthrough exit 0" || no "passthrough exit 0 (got $(run 'exit 0' 5))"
[ "$(run 'exit 7' 5)" = "7|" ] && ok "passthrough exit 7" || no "passthrough exit 7 (got $(run 'exit 7' 5))"

# (b) timeout: a 30s command under a 2s cap is killed and returns 124, promptly
start=$(date +%s)
rc="$(run 'sleep 30' 2)"; rc="${rc%%|*}"
elapsed=$(( $(date +%s) - start ))
{ [ "$rc" = "124" ] && [ "$elapsed" -lt 8 ]; } && ok "timeout -> 124 in ${elapsed}s" || no "timeout (rc=$rc elapsed=${elapsed}s, want 124 and <8s)"

# (c) process GROUP kill: a backgrounded grandchild must die too. It would touch a marker after
# 5s; with a 2s cap and a 6s wait, the marker must be ABSENT (grandchild was group-killed).
MARK="$(mktemp -u "${TMPDIR:-/tmp}/wd_mark_XXXXXX")"
run "( sleep 5; touch '$MARK' ) & sleep 30" 2 >/dev/null
sleep 6
[ ! -e "$MARK" ] && ok "process-group kill (grandchild died)" || { no "process-group kill (grandchild survived, marker present)"; rm -f "$MARK"; }

# (d) marker survives the kill: the watchdog returns control to the shell, so the trailing
# `; echo "__RC__=$?"` runs and reports 124 — the signal the fix-loop branches on is not lost.
out="$(run 'sleep 30' 2 '; echo "__RC__=$?"')"; out="${out#*|}"
[ "$out" = "__RC__=124" ] && ok "__RC__ marker survives kill (=124)" || no "__RC__ marker survival (got '$out', want '__RC__=124')"

echo "----"
[ "$fails" -eq 0 ] && { echo "watchdog: all checks passed"; exit 0; } || { echo "watchdog: $fails check(s) FAILED"; exit 1; }
