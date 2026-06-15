# Plugin-restructure track — STATE

Two-track plan (user-approved "Split", 2026-06-14):

1. **Restructure** (IN PROGRESS) — execute `docs/plans/2026-06-14-ultrapowers-plugin-restructure.md`
   via superpowers:subagent-driven-development, in worktree `plugin-restructure`
   (branch `feature/plugin-restructure`, off `main` @ 0ac78a6). 8 tasks. Task 8 (NOTICE legal
   name) pauses for the user. Final adversarial review before PR to `main`.

2. **Dogfood eval (NEXT, after restructure)** — point `/ultrapowers` (the harness, dispatched
   by scriptPath to `workflow/ultrapowers-development.js`) at a *real* TDD task: add **fail-loud
   `{id,spec}` validation** to the engine so a malformed `args.tasks` (bare strings) errors
   instead of silently building nothing. Why this task: genuine red→green, re-witness RED truly
   applies (revert validation → silent-pass returns → caught), it's on the roadmap, and it
   doesn't touch dispatch. Source of the bug: memory `ultrapowers-workflow-task-args-gotchas`.
   Suggested shape: extract `workflow/lib/validate-tasks.js` + `*.test.js` (node --test), wire
   into the engine's build loop before the `t.id` filter.

Rejected alternative: feeding the restructure itself into `/ultrapowers` — poor fit
(self-modification of its own engine/command mid-run; no per-task red→green verifyCmd).
