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

# (b) idempotent — second run succeeds, link unchanged
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
