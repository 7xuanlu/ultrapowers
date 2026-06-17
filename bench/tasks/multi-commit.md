# multi-commit (BASE..HEAD path)

**Safety-path fixture — multi-commit integration scenario (B-v6 only, H4)**

The `config-module` and `cross-task-coupled` tasks in `bench/fixtures/safety-tasks.json` together
exercise the multi-commit `BASE..HEAD` diff path. Because both tasks commit to the same repo,
the integration review sees a range of commits rather than a single diff:

- Commit 1: `[task:config-module]` — adds `src/config.js` + `test/config.test.js`.
- Commit 2: `[task:cross-task-coupled]` — adds `src/throttle.js` + `test/throttle.test.js`.

The integration reviewer must reason over `BASE..HEAD` (both commits together) to detect the
cross-task dependency. The `cannotVerify` ⚠️ checklist item from `cross-task-coupled` must surface
in the integration review, and any resume from that checkpoint must rebuild the ⚠️ item (the H2
reuse path with a real `logFile`).

---

*This file documents the multi-commit integration scenario; it is not itself a task spec. The
authoritative task specs are in `bench/fixtures/safety-tasks.json`.*
