#!/usr/bin/env bash
# Seed 3 controlled repos to reproduce the re-witness-RED proof.
# Each: a committed-green `add(a,b)` with a different test (vacuous / good / weak).
# Then run the redWitness() prompt (see workflow/ultrapowers-development.js) against each,
# passing baseSha = HEAD~1. Expected: vacuous -> redWitnessed:false (CAUGHT); good/weak -> true.
set -e
ROOT=${1:-/tmp/up-rwproof}
rm -rf "$ROOT"; mkdir -p "$ROOT"

mkrepo() {
  local d="$ROOT/$1"; mkdir -p "$d"
  ( cd "$d"
    git init -q; git config user.email t@t.t; git config user.name t
    echo "# proof-$1" > README.md
    git add -A; git commit -qm base >/dev/null )
  printf 'export function add(a, b) { return a + b }\n' > "$d/impl.mjs"
}

mkrepo vacuous
cat > "$ROOT/vacuous/impl.test.mjs" <<'EOF'
import { test } from 'node:test'
import assert from 'node:assert/strict'
test('add works', () => { assert.strictEqual(2 + 2, 4) })   // never imports add -> vacuous
EOF

mkrepo good
cat > "$ROOT/good/impl.test.mjs" <<'EOF'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { add } from './impl.mjs'
test('adds', () => { assert.strictEqual(add(2, 3), 5); assert.strictEqual(add(-1, 1), 0) })
EOF

mkrepo weak
cat > "$ROOT/weak/impl.test.mjs" <<'EOF'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { add } from './impl.mjs'
test('returns a number', () => { assert.strictEqual(typeof add(2, 3), 'number') })  // type-only
EOF

for c in vacuous good weak; do
  ( cd "$ROOT/$c"; git add -A; git commit -qm "[task:add] add(a,b)" >/dev/null
    node --test impl.test.mjs >/dev/null 2>&1 && g=GREEN || g=RED
    echo "$c committed=$g  repo=$ROOT/$c  baseSha=$(git rev-parse HEAD~1)" )
done
