#!/usr/bin/env bash
# bench/ladder.sh — cumulative-prefix cost-crossover ladder.
# Runs A-opus (superpowers, coord=opus) vs B-full (ultrapowers, as-shipped) over a fixed ordered
# fixture at cumulative prefixes, each rung independently metered via the trusted total_cost_usd
# rollup. Answers: (1) at what task count do the two arms' cumulative cost curves cross, and
# (2) the endpoint $ savings at the full fixture — at equal-or-better quality (node --test per rung).
#
# Each rung is a separate run.sh invocation (its own results/<TS>.json). The transient bench/runs tree
# is archived to runs-ladder/prefix-<N>/ after each rung so transcripts + outputs survive for the
# quality audit (the next rung overwrites bench/runs).
#
# Usage:  CAMPAIGN_MAX_BUDGET=100 bash bench/ladder.sh                 # real campaign
#         DRY=1 bash bench/ladder.sh                                   # plumbing check, $0
# Real runs MUST run unsandboxed (api.anthropic.com is not in the sandbox network allowlist).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

FIXTURE="bench/fixtures/longtasks-docdb.json"
ARMS="A-opus B-full"
PREFIXES="${PREFIXES:-6 12 24}"
DRY="${DRY:-0}"
export CAMPAIGN_MAX_BUDGET="${CAMPAIGN_MAX_BUDGET:-100}"

STAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE="bench/runs-ladder/$STAMP"
SUMMARY="bench/results/ladder-$STAMP.jsonl"
mkdir -p "$ARCHIVE" "bench/results"
: > "$SUMMARY"

dry_flag=""
[ "$DRY" = "1" ] && dry_flag="--dry-run"

echo "ladder: stamp=$STAMP arms='$ARMS' prefixes='$PREFIXES' cap=\$$CAMPAIGN_MAX_BUDGET dry=$DRY"
echo "ladder: fixture=$FIXTURE  summary=$SUMMARY  archive=$ARCHIVE/"

for P in $PREFIXES; do
  echo ""
  echo "========================= LADDER RUNG prefix=$P ========================="
  log="$ARCHIVE/prefix-$P.run.log"
  # Each rung: fresh provision + run both arms at cumulative prefix P.
  bash bench/run.sh --runs 1 --arms "$ARMS" --tasks "$FIXTURE" --prefix "$P" $dry_flag 2>&1 | tee "$log"

  rj="$(grep -oE '/[^ ]+/bench/results/[0-9][0-9-]*\.json' "$log" | tail -1)"
  echo "ladder: prefix=$P results=$rj"
  # Durable per-rung copy (guards against same-second results-filename collisions).
  [ -n "$rj" ] && [ -f "$rj" ] && cp "$rj" "$ARCHIVE/prefix-$P.results.json" 2>/dev/null || true
  if [ -n "$rj" ] && [ -f "$rj" ]; then
    # One summary line per arm: cost headline + agentCount + coordinator-context meter + model split.
    jq -c --argjson p "$P" --arg rj "$rj" '
      .records[] | {
        prefix: $p,
        arm: .arm,
        headlineCostUsd: .metrics.headlineCostUsd,
        agentCount: .metrics.agentCount,
        streamCarriesSubagents: .metrics.streamCarriesSubagents,
        coordCtx: .metrics.meterA,
        modelUsage: .metrics.cost.modelUsage,
        wallMs: .wallMsScript,
        tasksSha: .tasksSha,
        results: $rj
      }' "$rj" >> "$SUMMARY" || echo "ladder: WARN jq summary failed for prefix=$P" >&2
  else
    echo "ladder: WARN no results json found for prefix=$P" >&2
  fi

  # Preserve this rung's run tree (transcripts + output/verify.txt) before the next rung overwrites it.
  cp -R bench/runs "$ARCHIVE/prefix-$P.runs" 2>/dev/null || true
done

echo ""
echo "========================= LADDER COMPLETE ========================="
echo "ladder: summary -> $SUMMARY"
echo "ladder: per-rung archives -> $ARCHIVE/prefix-*.runs/"
echo ""
echo "=== cost-by-prefix (headline total_cost_usd, the cross-arm meter) ==="
jq -rs '
  sort_by(.prefix, .arm)
  | (["prefix","arm","cost_usd","agents","streamSubs","coordOutTok"] | @tsv),
    (.[] | [ .prefix, .arm,
             (.headlineCostUsd|tostring),
             (.agentCount|tostring),
             (.streamCarriesSubagents|tostring),
             ((.coordCtx.output // "n/a")|tostring) ] | @tsv)
' "$SUMMARY" 2>/dev/null || cat "$SUMMARY"
