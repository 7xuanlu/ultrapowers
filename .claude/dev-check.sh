#!/usr/bin/env bash
# Dev-only edit-time check (contributor convenience, NOT shipped to plugin users).
# Mirrors the free CI checks the instant a relevant file is edited, so breakage is
# caught locally instead of after push. Wired via .claude/settings.json PostToolUse.
#
# Reads the hook payload on stdin and runs the matching check:
#   - the engine            -> `npm run check` (the only valid syntax check; node --check rejects it)
#   - a shipped JSON manifest -> JSON.parse validity (a broken manifest blocks plugin install)
# Uses node (already required by this repo) for JSON, so it needs no `jq`.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

f="$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write((JSON.parse(s).tool_input||{}).file_path||"")}catch{}})')"
[ -n "$f" ] || exit 0

case "$f" in
  *workflow/ultrapowers-development.js)
    ( cd "$ROOT" && npm run --silent check ) ;;
  *.claude-plugin/*.json | *hooks/hooks.json | *package.json)
    node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$f" && echo "json ok: $f" ;;
esac
