# Discussion log

Running design log for ultrapowers. We moved the conversation here out of the `lore` repo.
Newest at top. Keep STATE-of-thinking here; durable decisions graduate to `docs/decisions/`.

## N=5 × 4-arm campaign DONE (2026-06-14) — `docs/benchmarks/campaign-n5-2026-06-14.md`

First full `bench/run.sh` run. **$88.07**, 20/20 green. **Quality TIE** (20/20 self-test + 20/20 an
independent spec suite — catches self-test gaming). **No total-cost winner at N=5** (cost-matched
A-sonnet $3.90 vs B-parity $4.03 median = dead heat; A-opus higher variance than B-full). **Decisive
~8× Meter-A flatness** for ultrapowers (B coordinator ~6 turns, num_turns=1, flat across all runs; A
~46-56 own turns) — attributed to the Workflow primitive, not ours. Confirms the docs' thesis: the
benchmark honestly shows Meter-A flatness + quality parity; it does NOT support a Meter-B "cheaper"
claim. re-witness RED was not exercised (tasks too easy). Two bugs fixed en route: `--bare`
auth/discovery (commit 5261c88) and a bash-3.2 empty-array crash on the B arms (af9a93f).

## ARM-A `--bare` blocker RESOLVED — both arms verified headless (2026-06-14)

`bench/run.sh` ran `claude --bare -p` for every arm. Confirmed empirically that `--bare` is
non-viable here: it authenticates only via `ANTHROPIC_API_KEY`/`apiKeyHelper` (none in this env →
`"Not logged in"`), and it skips the plugin/workflow auto-discovery both arms depend on. **Fix =
drop `--bare`** — environment-forced, not a judgment call; matches the accepted pilot and keeps
OAuth billing so the $/task cost-anchor holds. Also moved the real invocation to
`bypassPermissions` (not `acceptEdits`, which would hang an unattended run on a Bash/git prompt) and
pointed ARM B at the Workflow by `scriptPath` (the repo's source-of-truth file, verified to load
headless).

**Verified end-to-end, both arms, `slugify` (1 task), $4.21 total incl. probes:**
- ARM A (superpowers, sonnet): 6/6 green; SDD genuinely fired (1 Skill + 4 Agent dispatches);
  per-task commits on `eval`; $2.02.
- ARM B (ultrapowers Workflow via scriptPath): 7/7 green; returned
  `{ok:true, passed:["slugify"], integration:{approved:true}}`; $1.88.

Honest-framing note: dropping `--bare` means the global `~/.claude/CLAUDE.md` loads into **both**
arms — a *symmetric* confound (advantages neither differentially), disclosed in `bench/README.md`
F2. The N=5 × 4-arm campaign (~$90-130) is now unblocked, still pending explicit user go.

## Where things stand (2026-06-13)

**What exists:** the harness (`workflow/ultrapowers-development.js`) + the `/workflows-driven-development`
command, ported from Superpowers' SDD/TDD discipline onto Claude Code's Workflow primitive,
plus re-witness RED and a dynamic loop-until-clean critic.

**Settled this session:**
- Token framing corrected: ultrapowers wins **Meter A** (flat coordinator context) decisively;
  **Meter B** (total billed) is *not* near-zero and only wins on long builds. Don't claim
  total-token savings. (`docs/benchmarks/token-benchmark.md`)
- Novelty graded honestly (`docs/research/oss-landscape.md`): re-witness RED is the one scarce
  mechanism; the coordinator's efficiency is the Workflow primitive's, not ours; the dynamic
  critic exists elsewhere (CAMEL/Magentic-One). Defensible claim = **integration novelty +
  divergence from Superpowers** (which *declined* both the external coordinator and the dynamic
  critic — #1041, #1647).
- re-witness RED catch-path **proven** (`tests/re-witness-red/`).
- Attribution done: Superpowers is MIT © 2025 Jesse Vincent; we embed verbatim portions →
  `NOTICE` + `LICENSE-superpowers`.

## Open questions / next steps

1. ~~**Measurement** — fill `token-benchmark.md` from run `wf_7ad7c92f-406`.~~ **DONE.** 3-task
   build: 471,404 subagent tokens (Meter B), ~2k main-session delta (Meter A, measured flat),
   integration approved. Confirms Meter-A flatness; N=3 is small-regime so no Meter-B win yet.
   Still want a large-N run + same-spec Superpowers baseline for the crossover.
2. **P2 mutant** — should we ship a mutation probe to catch weak-but-dependent tests (the `weak`
   case re-witness RED misses)? The 14-chain study said its cost isn't yet justified; revisit if
   a harder corpus shows real weak tests.
3. **Diverse-lens integration panel** — upgrade the single final integration review to an N-lens
   voting panel (correctness / security / cross-task coupling)? Discussed as "feature-like."
4. **Verification debt** (before public claims): source-read CAMEL `workforce.py` and
   swarm-orchestrator `src/falsification` Layer 1 (see oss-landscape.md).
5. **Packaging** — ship as a Claude Code plugin/marketplace entry? Skill vs raw workflow+command?
6. **Publish** — create the GitHub remote (not done; awaiting explicit go) and set the real
   legal name in `LICENSE`/`NOTICE`.
7. **Same-spec head-to-head** vs Superpowers — harness exists (`bench/`); fairness review says it can
   honestly prove **Meter-A flatness only** (no honest Meter-B headline at small N). **ARM-A pilot
   PASSED 2026-06-14:** headless superpowers (`superpowers:subagent-driven-development`) genuinely fired, fairness
   pins held, $1.89 for one slugify task (sonnet $0.70 + opus $1.18), 6/6 green. Metering solved
   (`metering-findings.md`). Full **N=5 × 4-arm ≈ $90-130**, pending user go.
   **BLOCKER RESOLVED 2026-06-14** (see top entry): dropped `--bare` from `bench/run.sh`
   (auth-forced), switched to `bypassPermissions`, ARM B via `scriptPath`; both arms verified green
   headless ($4.21). Campaign now unblocked, still pending user go.
8. **Roadmap landed** (`docs/roadmap.md`): P0 launch-blockers = `plugin.json`/marketplace manifest +
   close the `NOTICE` legal-name TODO. Key stance: **depend on Superpowers' interactive skills, don't
   re-port them**; ultrapowers is *one stage in the Superpowers lifecycle*.

## Standing constraints to honor

- The token efficiency is the Workflow primitive's — never claim we invented it.
- Keep Superpowers credited and respected; ultrapowers complements, not replaces.
- re-witness RED is the headline; everything else is integration or inherited.
