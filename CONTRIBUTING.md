# Contributing to ultrapowers

Thanks for considering a contribution. ultrapowers is a small, opinionated tool — it
**complements** [Superpowers](https://github.com/obra/superpowers) rather than replacing it, and
contributions are held to the same discipline it enforces on the code it builds.

Read [`AGENT.md`](./AGENT.md) first — it is the operating manual (the discipline bar, load-bearing
invariants, verification commands, security carve-out, and attribution rules). This file is the
human-facing process on top of it.

## The bar

- **TDD where it applies.** Code/logic changes go red → green → refactor: write the failing test
  first, watch it fail, then make it pass. Docs, JSON manifests, and CI YAML have no unit test —
  verify them by validity and by reading.
- **Never weaken re-witness-RED.** Stripping a task's production files and re-running the suite to
  prove it fails is the headline mechanism. Its proof lives in `tests/re-witness-red/`.
- **Surgical changes.** Touch only what the task needs; match existing style; no drive-by refactors
  or speculative surface.
- **Honest claims.** Tag factual/benchmark claims (`[V]`/`[I]`/`[ESTIMATE]`/`[U]`). Never claim a
  per-bill cost discount — the flat coordinator is a scaling property, not a saving. Mark
  projections as projected.

## Dev setup & checks

```
git clone https://github.com/7xuanlu/ultrapowers
cd ultrapowers
npm run check          # engine parse + (in CI) JSON-manifest validation — free, no deps
npm run test:rewitness # re-witness-RED catch path — SPENDS TOKENS / needs Claude Code auth
```

CI runs `npm run check` + manifest validation only. Run `test:rewitness` locally before any change
to engine behavior and confirm the vacuous test is CAUGHT and the good test passes.

## Where things live

| path | what |
|------|------|
| `workflow/ultrapowers-development.js` | the deterministic Workflow coordinator (the engine) |
| `commands/workflows-driven-development.md` | the user-only command (owns the human gates; dispatches the engine — never re-implement the loop) |
| `reference/` | load-on-demand command docs |
| `tests/`, `bench/` | self-tests and the benchmark harness |
| `NOTICE`, `LICENSE-superpowers` | attribution for the verbatim-embedded Superpowers text |

Adding an implementer today means editing the `IMPLEMENTER` branches in `implement()`/`preflight()`;
a registry refactor that turns this into a clean extension point is planned (see `docs/roadmap.md`).
Any external implementer must ship with its sandbox/security note.

## Pull requests

1. Branch off `main` (`feature/<kebab>`); never push to `main` directly.
2. [Conventional Commits](https://www.conventionalcommits.org/). Keep PRs focused.
3. Keep `NOTICE` / `LICENSE-superpowers` accurate if you touch any embedded text, keep obra
   credited, and never let positioning drift into "ultrapowers > superpowers."
4. CI must be green (`npm run check` + manifests). Describe how you verified behavior.

By contributing you agree your contribution is licensed under the repository's [MIT](./LICENSE)
license, and you agree to the [Code of Conduct](./CODE_OF_CONDUCT.md).
