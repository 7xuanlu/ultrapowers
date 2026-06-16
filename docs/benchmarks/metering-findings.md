# Metering, empirical findings (`claude -p`)

Resolves the `TODO(real-cli)` token-field question in `bench/run.sh` and **corrects** the
fairness critique's A2 fear. Measured 2026-06-14 against the live CLI.

## What `claude -p --output-format json` emits (final result object)

```jsonc
{ "type":"result", "total_cost_usd": 0.40287,
  "usage": { "input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens" },
  "modelUsage": { "claude-opus-4-8[1m]": { "inputTokens", "outputTokens", "costUSD", ... } } }
```

## The load-bearing finding: subagent work IS rolled up; the stream does NOT itemize it

Test: a `claude -p` that spawns one Task subagent, captured with `--output-format stream-json --verbose`.

- **All `assistant` stream messages were tagged MAIN**, the subagent's *own* turns do **not**
  appear as separate stream messages with per-message `usage`. Only the Task **result** comes back
  as a `user` message carrying `parent_tool_use_id`.
- **Yet `result.total_cost_usd` rose $0.30 → $0.40 and `result.usage.output` rose 5 → 208** once the
  subagent ran, i.e. `result.usage` / `total_cost_usd` / `modelUsage` **include** the subagent's work.

**Implication, opposite of fairness-critique A2.** A2 feared `result.total_cost_usd` *excludes*
subagents (→ ~100× undercount) and mandated stream-summing with `parent_tool_use_id` dedup.
Empirically the reverse holds: **the stream can't be summed for subagents (they aren't itemized),
and `result.*` already rolls them up.** So:

```
ARM A (superpowers via claude -p):  use result.total_cost_usd + result.modelUsage  (authoritative, subagents included)
                                    do NOT stream-sum (it would MISS subagent tokens)
ARM B (ultrapowers Workflow):       use the Workflow's reported subagent_tokens + agent_count,
                                    priced per-model; main-session delta is the tiny return object.
```

Both arms are then comparable on **price-weighted cost (`$`)**, which is the meter that matters
(F-controls already say: never compare raw token counts across arms, different model mixes).

## Cost reality (informs campaign sizing)

A *trivial* `claude -p` call already costs **~$0.30** (≈25.6k cache-creation tokens of system-prompt
overhead per invocation). A full superpowers build (multi-turn, TDD + 2-stage review subagents) is
many turns × subagents → realistically **several dollars per ARM-A run**. Budget the campaign as
`≈ (per-build $) × 4 arms × N runs` and confirm N before launching (see `bench/README.md`).

## Action for `bench/run.sh`

`meter()` should, for ARM A, read `result.total_cost_usd` + `result.modelUsage` directly (drop the
stream-sum path for subagents). The `--dry-run` scaffold and field shapes above are confirmed; this
removes the last `TODO(real-cli)` blocker for a real campaign.
