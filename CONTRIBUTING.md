# Contributing to ultrapowers

Thanks for considering a contribution. ultrapowers is a small, opinionated tool. It
**complements** [Superpowers](https://github.com/obra/superpowers) rather than replacing it, and
contributions are held to the same discipline it enforces on the code it builds.

Read [`AGENTS.md`](./AGENTS.md) first; it is the operating manual (the discipline bar, load-bearing
invariants, verification commands, security carve-out, and attribution rules). This file is the
human-facing process on top of it.

## The bar

- **TDD where it applies.** Code/logic changes go red → green → refactor: write the failing test
  first, watch it fail, then make it pass. Docs, JSON manifests, and CI YAML have no unit test;
  verify them by validity and by reading.
- **Never weaken re-witness-RED.** Stripping a task's production files and re-running the suite to
  prove it fails is the headline mechanism. Its proof lives in `tests/re-witness-red/`.
- **Surgical changes.** Touch only what the task needs; match existing style; no drive-by refactors
  or speculative surface.
- **Honest claims.** Tag factual/benchmark claims (`[V]`/`[I]`/`[ESTIMATE]`/`[U]`). No *unqualified*
  per-bill cost discount: the N=5 head-to-head was a tie; one v6 run (N=1/point) measured UP ~2×
  cheaper at N=12/24 (`[V cost-and-context-ladder-2026-06-17.md]`) — mechanical pass-count parity (LLM
  quality-judge not run), partly an SP-v6 regression, PROJECTED past task 24. A tagged, N-scoped
  discount carrying those caveats is allowed; unqualified "cheaper" marketing is not. Mark projections
  as projected.

## Dev setup & checks

```
git clone https://github.com/7xuanlu/ultrapowers
cd ultrapowers
npm run check          # engine parse + (in CI) JSON-manifest validation, free, no deps
npm run test:rewitness # re-witness-RED catch path, SPENDS TOKENS / needs Claude Code auth
```

CI runs `npm run check` + manifest validation only. Run `test:rewitness` locally before any change
to engine behavior and confirm the vacuous test is CAUGHT and the good test passes.

### Optional: local invariant-review gate

So you never forget to run the `invariant-reviewer` before a PR, enable the local pre-push hook:

```
npm run hooks:install   # = git config core.hooksPath .githooks
```

On `git push`, when the outgoing diff touches an invariant-relevant file — the engine, embedded
prompts, manifests (`.claude-plugin/`, `package.json`, `hooks/hooks.json`), `README.md`,
`docs/benchmarks/`, `SECURITY.md`, or the `NOTICE`/`LICENSE-superpowers` attribution files — it
dispatches the `invariant-reviewer` (opus, ~1 min) and **blocks the push on a critical invariant violation**.
It needs the `claude` CLI authed locally; if absent or it can't complete, it fails open (warns,
allows). Bypass any push with `git push --no-verify` (or `SKIP_INVARIANT_REVIEW=1 git push`).
Note: `core.hooksPath` makes git use `.githooks/` for all hooks, superseding `.git/hooks/`.

## Where things live

| path | what |
|------|------|
| `workflow/ultrapowers-development.js` | the deterministic Workflow coordinator (the engine) |
| `skills/workflows-driven-development/SKILL.md` | the user-only skill (owns the human gates; dispatches the engine, never re-implement the loop) |
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

## Releases

Releases are automated by [release-please](https://github.com/googleapis/release-please). It watches
Conventional Commits on `main` and opens a release PR that bumps the version (`package.json`,
`.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`) and updates `CHANGELOG.md`; merging
that PR tags the version and cuts the GitHub Release.

Because PRs are **squash-merged**, the PR title becomes the only commit on `main`, so it must be a
Conventional Commit (`feat:`, `fix:`, `docs:`, `chore:` ...). A non-conventional title means no
release is proposed; `feat:` and `fix:` bump the version, while `docs:`/`chore:`/`test:` land
without one.

By contributing you agree your contribution is licensed under the repository's [MIT](./LICENSE)
license, and you agree to the [Code of Conduct](./CODE_OF_CONDUCT.md).
