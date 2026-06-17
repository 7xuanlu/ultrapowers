# multi-commit (BASE..HEAD path)

**Safety-path fixture — per-task baseSha diff scoping (B-v6 only)**

## What is actually asserted here

Multi-commit `BASE..HEAD` diffs occur **naturally** whenever a task requires more than one fix round
(each round commits, so the reviewer's `baseSha..HEAD` slice spans multiple commits). The engine
scopes each per-task review to that task's own `baseSha..HEAD` via `reviewPackage` (committed before
that task's implementer ran), so the multi-commit path is exercised any time a fix loop runs.

This is **unit-tested** via the per-task baseSha scoping in
`tests/engine/h2-resume-cannotverify.test.mjs` (Task 7), which verifies the engine rebuilds the
`cannotVerify` list correctly after a crash-resume. The safety-run.sh fixture does **not**
separately force or assert a multi-commit range — it cannot guarantee any task takes >1 fix round
in a live run.

## What the two tasks below do assert

The `config-module` and `cross-task-coupled` tasks together exercise the **per-task diff scoping**
that makes the coupling structurally real to the reviewer:

- Commit 1: `[task:config-module]` — adds `src/config.js` + `test/config.test.js`.
- Commit 2: `[task:cross-task-coupled]` — adds `src/throttle.js` + `test/throttle.test.js`.

Because the engine scopes the `cross-task-coupled` review to only Commit 2 (`baseSha..HEAD`),
`src/config.js` is **outside** the reviewer's diff slice — the coupling to `getLimit()` is
structurally invisible in the per-task review, which is what triggers the `cannotVerify` ⚠️.

## H2 crash-resume coverage

H2 (crash-resume rebuilding `cannotVerify`) is covered by the unit test
`tests/engine/h2-resume-cannotverify.test.mjs`, **not** by this live fixture.

---

*This file documents the per-task baseSha scoping scenario; it is not itself a task spec. The
authoritative task specs are in `bench/fixtures/safety-tasks.json`.*
