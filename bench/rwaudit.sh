#!/usr/bin/env bash
# re-witness audit — measure how many SHIPPED tests are vacuous (never exercise their implementation),
# i.e. how many re-witness RED would have caught. Operates on the FINAL shipped state (eval HEAD):
# for each test/<name>.test.js, remove its module src/<name>.js and re-run ONLY that test. If it
# still PASSES, the test is vacuous. Runs on a throwaway copy; the source repo is untouched.
#
# Usage: bench/rwaudit.sh <repo-dir>
# Requires: git, node>=18.
set -uo pipefail
SRC="${1:?usage: rwaudit.sh <repo-dir>}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cp -R "$SRC/." "$WORK/"
cd "$WORK"
git checkout -qf eval 2>/dev/null || git checkout -qf HEAD 2>/dev/null || true
shopt -s nullglob
vac=0 ok=0
for tf in test/*.test.js test/*.test.mjs; do
  base="$(basename "$tf" | sed -E 's/\.test\.(m?js)$//')"
  mod=""
  for ext in js mjs; do [ -f "src/$base.$ext" ] && mod="src/$base.$ext"; done
  if [ -z "$mod" ]; then echo "  $base: SKIP (no matching src/$base.js)"; continue; fi
  mv "$mod" "$mod.bak"
  if node --test "$tf" >/dev/null 2>&1; then
    echo "  $base: VACUOUS (passed with $mod removed)"; vac=$((vac+1))
  else
    echo "  $base: ok (went RED without impl)"; ok=$((ok+1))
  fi
  mv "$mod.bak" "$mod"
done
echo "── vacuous=$vac  exercising=$ok ──"
