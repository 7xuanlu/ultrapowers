# OSS landscape & novelty analysis

Evidence-tagged competitive analysis behind Ultrapowers' positioning. Tags: `[V url]` =
verified (primary source fetched/quoted), `[I]` = inferred, `[U]` = unknown. Star counts
observed **2026-06-13**. "I did not find X" is used in place of "nobody does X", absence of
evidence is not evidence of absence.

## The three claimed differentiators, honestly graded

| Axis | Verdict | Strength |
|------|---------|----------|
| Flat-coordinator (zero-context-growth) | Real **vs Superpowers** (they keep an LLM controller in-session and have declined moving off it; measured **~8× flatter** at N=5 `[V campaign-n5-2026-06-14.md]`), but the flat coordinator is **Anthropic's Workflow primitive, not our invention**. It's a **scaling/capability** property (survives long builds) independent of cost: total cost was a tie at N≤5, and one v6 run (N=1/point) measured UP ~2× cheaper at N=12/24 `[V cost-and-context-ladder-2026-06-17.md]` (mechanical pass-count parity, LLM quality-judge not run; partly an SP-v6 regression; PROJECTED past task 24). | strong *as a divergence from Superpowers*; table-stakes *vs the Workflow platform* |
| Dynamic loop-until-clean critic | **Not unique**, CAMEL Workforce, OWL, Magentic-One, XAgent ship dynamic task injection | weak alone; novel only *in combination* |
| **Mechanical re-witness RED** | **Found shipped nowhere** as a per-task step in a TDD build loop | **strongest; ~80% confidence** |

## Comparison table (general harnesses)

| Project | Stars (2026-06-13) | adversarial review | model routing | critic ADDS tasks | re-witness RED / test-integrity |
|---|---|---|---|---|---|
| Superpowers (obra), **parent** | 226,861 `[V api]` | yes (2-stage) | yes | no (fixed plan) | watch-fail *by instruction only* |
| OpenHands | ~76.9k `[V page ±1k]` | yes (critic) | yes | partial | no |
| MetaGPT | ~68.8k `[V page ±1k]` | partial | partial | no | no |
| Cline | 63,218 `[V api]` | no | partial | no | no |
| claude-flow/ruflo | 59,306 `[V]` | partial | partial | no | no |
| AutoGen Magentic-One | 58,926 `[V api]` | yes | yes (LLM coord) | **yes (stall-gated replan)** | no |
| gpt-engineer | ~55.2k `[V page ±1k]` | no | no | no | no |
| aider | 46,151 `[V api]` | no | yes | no | no |
| gpt-pilot | 33,748 `[V api]` | partial | partial | no | no |
| ChatDev | 33,389 `[V api]` | partial | partial | no | no |
| OWL (camel-ai) | 19,843 `[V api]` | partial | partial | **yes (Workforce engine)** | no |
| SWE-agent | 19,499 `[V api]` | yes (opt-in) | partial | no | benchmark-only |
| CAMEL Workforce (camel-ai) | 17,177 `[V api]` | partial | partial | **yes, `quality_score < 60` ⇒ decompose ⇒ inject subtasks** `[V, source-read pending]` | no |
| XAgent | 8,531 `[V api]` (unmaintained) | no | no | yes (completion-gated) | no |
| tdd-guard | 2,192 `[V api]` | no | partial | no | enforces failing-test-first; never reverts impl |
| **swarm-orchestrator** | **95** `[V api]` | no | no | no | **closest: "Differential Gate" base-vs-patch + mutation, but POST-HOC PR auditor** |

Academic prior art (papers, not shipped harnesses): AdverTest / "Test vs Mutant", ConVerTest,
Meta's LLM mutation testing, all synthetic-mutant test *generation*, not a build loop. `[V]`

## Superpowers' own roadmap (does it already do this?), no

Searched obra/superpowers issues (open+closed), PRs, commits, docs/specs. **Discussions
disabled; no ROADMAP.** The maintainer is aware of this direction and has declined it in core:

- `[V #1041#issuecomment-4184707674]` obra, 2026-04-03: *"It's purely prompt driven... I think
  there is a ton of value in external orchestrators, but moving to that model is dramatically
  more complicated for most users."*
- `[V #1647]` "dynamic-workflows" loop-until-approved critic, **closed not_planned** by obra
  2026-05-31: *"This was made up by an agent that didn't even test it."* (Ultrapowers' version
  IS tested, see `tests/re-witness-red/`.)
- `[V #1647]` flags the exact constraint we solved via the command wrapper: *"workflows forbid
  mid-run input, so SDD's implementer-asks-questions step can't be expressed."* Ultrapowers puts
  the human gates in the `/ultrapowers` command (plan approval + critical review), autonomous
  Workflow in between.
- `[V PR #1717]` (draft, 2026-06-10), what Superpowers IS doing instead: deterministic bash
  helpers + a `progress.md` ledger, ~20-25% token savings, **controller stays an LLM in the
  main session**. Context-accumulation acknowledged (`[V #1152]`: *"consumes full 5h token
  budget in a single run"*); chosen fix = state files + context reset, NOT an external coordinator.

## Coordinator landscape (Q2)

| Framework | Coordinator: pure CODE or LLM-context-accumulating | Dynamic loop-until-clean critic that injects net-new tasks? |
|---|---|---|
| Claude Code Workflows (Anthropic) | **PURE CODE**, `[V code.claude.com/docs/en/workflows]`: *"Intermediate results stay in script variables instead of landing in Claude's context"* | scriptable, no built-in critic |
| LangGraph | PURE CODE (graph) | hand-rollable, no built-in critic |
| CrewAI sequential | linear code | no (predefined list) |
| CrewAI hierarchical | LLM-accumulating (manager_llm) | no (re-delegate fixed tasks) |
| AutoGen GroupChat | LLM-accumulating | no |
| AutoGen Magentic-One | LLM-accumulating | **yes (ledger replan)** |
| CAMEL Workforce | LLM-accumulating | **yes (quality-gated)** |
| OpenHands | LLM-accumulating | no |
| DSPy | compile-time optimizer (N/A) | no |

**No framework ships {pure-code zero-context coordinator + built-in dynamic loop-until-clean
critic}.** Magentic-One/CAMEL have the critic with an LLM coordinator; LangGraph/Workflows have
the pure coordinator without a built-in critic. Ultrapowers occupies the empty cell, by
*assembling* existing pieces, plus re-witness RED.

## Open verification debt (before any public claim)

1. Read CAMEL `workforce.py` + `prompts.py` to confirm the `quality_score < 60` decompose-gate
   verbatim (currently via summarizer, not source).
2. Read swarm-orchestrator `src/falsification` Layer 1 to confirm it is base-vs-patch (proves
   the test depends on *the change*), distinct from re-witness RED's impl-revert (proves the
   test depends on *the implementation*). Strongly evidenced by its dev.to writeup, not yet
   source-confirmed.
