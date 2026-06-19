# Launch-readiness, STATE

Both 2026-06-14 tracks are **DONE** (squashed into `main` @ `bce9dc5`):

1. **Restructure**, ✅ merged. Plugin layout, `plugin.json`, `package.json`, `SECURITY.md`,
   `bench/`, the `mcp__codex__codex` → `codex exec` doc fix, and the `NOTICE` legal-name TODO are
   all closed. The command is now `commands/workflows-driven-development.md`; the engine lives at
   `workflow/ultrapowers-development.js`.
2. **Dogfood eval (fail-loud `{id,spec}` validation)**, ✅ shipped, inline in the engine
   (`workflow/ultrapowers-development.js:727-733`): malformed `args.tasks` now errors with a clear
   note instead of silently building nothing (covers empty/whitespace id+spec). Not extracted to a
   `workflow/lib/` module, it's a guard at the engine boundary, which is sufficient.

## Remaining toward a public launch (see `docs/roadmap.md` for full rationale)

Closed this session (worktree `launch-readiness`):
- ✅ **P0** `.claude-plugin/marketplace.json`, self-contained single-plugin marketplace (`source: "./"`).
- ✅ **P0** `.github/workflows/ci.yml`, runs `npm run check` + JSON-manifest validation. (Re-witness
  self-test spends tokens / needs auth → runtime/manual gate, not in CI; documented in the workflow.)
- ✅ `AGENTS.md` + `CLAUDE.md` (imports `@AGENTS.md`), repo operating manual for contributing agents.
- ✅ README, added **Safety** section linking `SECURITY.md`, a Requirements note, and the direct
  self-marketplace install path.

Still open (P1, not launch-blocking): `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, an end-to-end
`examples/` walkthrough, the pluggable-implementer registry refactor, embedding
`systematic-debugging` into the fix-loop brief, council at the final integration review, and a
tagged `v0.1.0` release with notes.
