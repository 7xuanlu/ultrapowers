# Scale curve + re-witness head-to-head — 24-task doc-DB (2026-06-14)

Two questions the N=5 × 2-task campaign was too small to answer: (1) does the coordinator-context
divergence actually show up at scale, and (2) does re-witness RED catch anything a no-re-witness arm
ships? Ran the 24-task `longtasks-docdb` fixture through both architectures, headless.

- **superpowers (A):** `subagent-driven-development`, sonnet coordinator + sonnet impl + sonnet reviewers.
- **ultrapowers (B):** Workflow via scriptPath, sonnet impl + opus reviewers, re-witness ON.

Both completed all 24 tasks green (A: 262 tests pass; B: 226 tests pass).

## 1. Scale curve — Meter-A divergence, confirmed

| | superpowers (A) | ultrapowers (B) |
|---|--:|--:|
| Coordinator context, start → peak | **34K → 135K** | **34K → 41K** |
| Coordinator turns | 191 | **6** |
| Trajectory | monotonic climb | flat |

**Confirmed:** superpowers' coordinator context grows with task count (it runs the loop in-session);
ultrapowers' stays flat (~40K) regardless, because the Workflow runs subagents off the main
transcript. At 24 tasks the divergence is ~3.3× and widening.

**Honest correction to an earlier estimate.** A 2-task anchor led me to project ~16K/task growth and
a 200K-window wall at "~task 10". The real slope is **~4-5K/task net**: at 24 tasks superpowers'
coordinator reached **135K, still under the 200K window — no compaction triggered**. The sonnet wall
is therefore ~task 35-40, not 10. The *climb-vs-flat divergence* is real and measured; the
*catastrophic-overflow* point is further out than first claimed. (An opus[1m] coordinator, 1M window,
would climb far longer before overflowing — but pay opus prices on every re-read.)

## 2. re-witness RED head-to-head — NULL with a strong implementer

Audited every shipped task in both arms: strip the module, re-run its test; a test that stays green
(never exercised the impl) is what re-witness catches.

| Source | vacuous tests found |
|--------|--:|
| superpowers (A), 24 tasks, **no re-witness** | **0** |
| ultrapowers (B), 24 tasks, re-witness ON | 0 |
| N=5 campaign, all 4 arms, 40 task-tests | 0 |

**A competent sonnet implementer writes genuinely-exercising tests**, so re-witness RED — though
mechanically proven (`tests/re-witness-red/`, canonical `seed.sh` re-confirmed: vacuous → CAUGHT,
good/weak → pass) — **caught nothing in ~64 realistic task-tests**. It is insurance that did not fire.

*(Process note: a first per-commit audit wrongly flagged 4 "vacuous" — refactor commits reverted to a
still-working prior impl. Corrected to audit the final shipped state; the 4 were false positives.)*

### Implication: re-witness value is implementer-model-dependent
re-witness is wasted on a strong implementer but should earn its keep on a **cheap/weak one** — which
is exactly the project's own "cheap implementer + safety net" routing. So a haiku-implementer
head-to-head (10-task subset) was run to test whether re-witness fires where it's supposed to matter.

### haiku head-to-head result — also NULL
| Run | implementer | re-witness | vacuous shipped |
|-----|-------------|-----------|-----------------|
| haiku-A (superpowers) | haiku | **off** | **0 / 10** |
| haiku-B (ultrapowers) | haiku | on | 0 / 10 |

The re-witness check *ran* for every task in haiku-B (its prompts fired in the transcript), but its
per-task verdicts are subagent outputs **off the coordinator transcript**, so an internal catch can't
be observed directly. The decisive evidence is the **control**: haiku *without* re-witness (haiku-A)
shipped **0 vacuous** — the cheap model writes exercising tests unaided. So re-witness had nothing to
catch here either.

### Honest conclusion
Across **~84 task-tests spanning sonnet and haiku, with and without re-witness, zero vacuous tests
were shipped.** re-witness RED is mechanically proven (`seed.sh`: a *seeded* vacuous test is caught)
but **never demonstrably fired on natural agent output** in this benchmark. The failure mode it targets
(a test that doesn't exercise its implementation) is rare-to-nonexistent with current models on clean
TDD specs. Its value is insurance for conditions **not exercised here** — weaker models, larger/messier
real codebases, adversarial or ambiguous specs, or test-after-impl workflows. On this benchmark it is
**unfired insurance**: a per-task witness call (cost) with no observed benefit. We do **not** claim a
re-witness head-to-head win. (This sharpens, not contradicts, ADR-0002's "near-zero cost" framing —
near-zero cost, and here near-zero benefit too.)

## Cost note — NOT a valid cost comparison (it breaks two of this benchmark's own rules)

Raw figures: A $16.35 / ~21.8M tokens (all sonnet); B $30.46 / ~24.0M tokens (sonnet 6.2M + haiku
8.3M + opus 9.5M). **Do not read these as SP-vs-UP cost/tokens.** This pair was run only for the
coordinator-context *curve*; its cost/token numbers are invalid as a comparison because they violate:

- **F5 (reviewer-model parity)** — `bench/README.md` pins *both* arms' reviewers to **opus**. Here A
  was given **sonnet** reviewers (to cut demo cost) while B ran its hardcoded **opus** reviewers. So A
  was all-sonnet and B was sonnet+haiku+opus — different model mixes, not one comparison at two
  settings. A's ~1.9× lower $ is almost entirely that reviewer-model swap.
- **The metering rule** — `docs/benchmarks/metering-findings.md` / `HANDOFF.md`: *"never compare raw
  token counts across arms — different model mixes."* The 21.8M-vs-24.0M token line above is exactly
  the comparison that rule forbids (B's opus/haiku tokens are not the same unit as A's sonnet tokens).

The unfairness here runs *against* B (opus reviewers vs A's sonnet), so it is not a pro-ultrapowers
artifact — just an invalid number.

**The only model-fair cost comparison is the N=5 campaign** (impl=sonnet AND reviewers=opus on both
arms): a **tie** (`campaign-n5-2026-06-14.md`). What this long run *does* establish — the
coordinator-context curve in §1 — is model-fair, since it measures *where orchestration lives*,
independent of reviewer model.
