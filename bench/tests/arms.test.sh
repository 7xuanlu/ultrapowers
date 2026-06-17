#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
grep -q 'B-v5' "$ROOT/bench/run.sh" || { echo "FAIL: no B-v5 arm"; exit 1; }
grep -q 'B-v6' "$ROOT/bench/run.sh" || { echo "FAIL: no B-v6 arm"; exit 1; }
grep -q 'git show' "$ROOT/bench/run.sh" || { echo "FAIL: B-v5 must resolve the engine from a git ref"; exit 1; }
echo "arms ok"
