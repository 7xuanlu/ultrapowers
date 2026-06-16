# Proof: re-witness RED catch path

Reproducible evidence that the harness's `redWitness()` step catches a vacuous test that the
deterministic gate (green suite) does not. Run 2026-06-13 with 3 blind haiku agents executing
the **verbatim shipped `redWitness` prompt** against 3 controlled repos.

## Setup

Three single-function (`add(a,b)`) repos, each committed green, differing only in the test:

| case | the test | what it represents |
|------|----------|--------------------|
| `vacuous` | `assert(2+2===4)`, never imports `add` | a test that doesn't exercise the code |
| `good` | `assert(add(2,3)===5)` + more | a real, discriminating test |
| `weak` | `assert(typeof add(2,3)==='number')` | imports the code, but asserts only the type |

The probe: `git checkout <baseSha> -- <prod files>` (strip the impl, keep the test on HEAD),
re-run the suite, record the exit code, then `git checkout HEAD -- <prod files>` to restore.

## Results, exactly as predicted

| case | strip impl → suite | `redWitnessed` | outcome |
|------|--------------------|----------------|---------|
| `vacuous` | RC=0 (still GREEN) | **false → CAUGHT** | harness sends the task back to rewrite the test |
| `good`    | RC=1 (RED)         | true → passes  | proceeds to review |
| `weak`    | RC=1 (RED)         | true → slips through | **P1 boundary** (needs a P2 mutant, not shipped) |

All three repos were confirmed `status=clean, re-green=GREEN` after the probe, the mandatory
restore step worked every time.

## What it proves / its boundary

- **Proven:** a test that does not depend on the implementation is caught at near-zero cost,
  where two-stage LLM review can miss it on non-trivial code.
- **Boundary:** P1-strip removes the production file, so a test that *imports* the code fails
  for the right reason and passes the check, even if its assertion is weak (the `weak` case).
  Catching weak-but-dependent tests requires a P2 mutant (replace the impl with a plausible-wrong
  version); deliberately not shipped, see ADR-0002.

## Reproduce

See `seed.sh` for the repo setup; the probe prompt is the `redWitness()` function in
`workflow/ultrapowers-development.js`. Requires Node ≥ 18 (uses `node --test`).
