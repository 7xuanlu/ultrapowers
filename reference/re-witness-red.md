# re-witness RED (ADR-0002) — the headline mechanism

After a task's suite goes green, revert **only the production files** changed by this task
(keep the tests), and re-run the suite. If it is **still green**, the test never exercised
the implementation → send the task back to the implementer. Then restore the production
files.

- **Default-on**, one `haiku` call/task, **fail-open** (never blocks on its own error).
- **Gated** on `commit:true` + a `verifyCmd` — silently inert without them.
- **Boundary:** P1-strip catches *non-dependent* tests. Weak-but-dependent tests
  (e.g. type-only assertions) need a P2 mutant pass, deliberately **not** shipped in v1.
- **Evidence status (honest):** proven on a *seeded vacuous test* (`tests/re-witness-red/`);
  it has **not yet fired on an organic benchmark task**. The headline is the mechanism +
  the model-fair eval, with this caveat stated, not hidden.
