@AGENTS.md

# CLAUDE.md, Claude Code specifics for ultrapowers (shared principles are in AGENTS.md above)

## Workflow

This repo's own development uses Superpowers skills (this is the dog-food): brainstorming →
writing-plans → subagent-driven execution under strict TDD → requesting-code-review →
finishing-a-development-branch. Worktree per feature (`feature/<kebab>`), PR before merge, never
push to `main` directly. The skills own TDD, worktree, and model-routing rules, don't restate them.

## The engine and command are the product, treat them as such

- `workflow/ultrapowers-development.js` is the deterministic coordinator. It is loaded by the
  Workflow tool with top-level `await`/`return` and a single `export`, that's why `npm run check`
  compiles it as an async IIFE instead of `node --check`. Don't add a second `export` shape without
  updating `tests/check-engine.sh`.
- `skills/workflows-driven-development/SKILL.md` is **user-only** (`disable-model-invocation: true`) and
  spends real tokens. It dispatches the engine by name with a `scriptPath` fallback; do not
  re-implement the loop inside the skill. (Ships as a `skills/` skill, not a `commands/` file, so the
  slash picker shows the short name `workflows-driven-development (ultrapowers)` instead of the full
  `/ultrapowers:workflows-driven-development` path.)

## After any edit

Run `npm run check`. For engine-behavior changes, run `npm run test:rewitness` (spends tokens) and
confirm the vacuous test is CAUGHT and the good test passes. Don't claim an engine change works
without one of these.

## Distribution

The repo is a self-contained plugin marketplace: `.claude-plugin/plugin.json` +
`.claude-plugin/marketplace.json` (`source: "./"`). It is also listed in the author's aggregator
marketplace (`7xuanlu/claude-plugins`). Keep `version` in sync across `plugin.json`,
`marketplace.json`, and `package.json` when you cut a release; tag it.
