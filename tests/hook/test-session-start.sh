#!/usr/bin/env bash
# Test the SessionStart legacy-cleanup hook in an isolated HOME. No network, no real ~/.claude touched.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export HOME="$TMP"
HOOK="$ROOT/hooks/session-start"
LINK="$TMP/.claude/workflows/ultrapowers-development.js"

fail() { echo "FAIL: $1" >&2; exit 1; }

# (a) removes the legacy symlink (whatever it points at)
mkdir -p "$(dirname "$LINK")"
ln -snf "/some/old/engine.js" "$LINK"
bash "$HOOK" >/dev/null
[ -e "$LINK" ] && fail "legacy symlink not removed"

# (b) idempotent: runs cleanly when the link is already absent
bash "$HOOK" >/dev/null
[ -e "$LINK" ] && fail "link reappeared"

# (c) no workflows dir at all: must not error
rm -rf "$TMP/.claude"
bash "$HOOK" >/dev/null || fail "errored when ~/.claude/workflows absent"

# (d) does NOT remove a real (non-symlink) file a user placed there
mkdir -p "$(dirname "$LINK")"; printf 'real' > "$LINK"
bash "$HOOK" >/dev/null
[ -f "$LINK" ] || fail "removed a real file"
[ "$(cat "$LINK")" = "real" ] || fail "real file content altered"

# emits valid SessionStart JSON
out="$(bash "$HOOK")"
echo "$out" | python3 -c "import json,sys; o=json.load(sys.stdin); assert o['hookSpecificOutput']['hookEventName']=='SessionStart'; print('json ok')" || fail "hook output not valid SessionStart JSON"

echo "PASS test-session-start"
