# The harness (Workflow coordinator)

The engine is a deterministic JS **Workflow** (`workflow/ultrapowers-development.js`,
`meta.name: ultrapowers-development`), dispatched by `scriptPath` from the WDD skill — it is
**not** registered in `~/.claude/workflows/`, so it stays out of the slash list and the model
cannot dispatch it directly (which would bypass the human gates). Per ADR-0001, hosting the SDD loop on the Workflow
primitive keeps intermediate `agent()` results in script variables (never re-entering an
LLM context) → the coordinator session stays flat over long runs. Trade-off: a Workflow
cannot pause mid-run for input, so human gates live in the command, before/after dispatch.

## Args the command may pass
| arg | default | meaning |
|---|---|---|
| `tasks` |, | `[{id,spec}]` pre-decomposed list (skips planning) |
| `goal` |, | goal to decompose (planning mode) |
| `verifyCmd` |, | deterministic test command (the gate) |
| `repoDir` | session cwd | absolute path to the target repo |
| `commit` | false | per-task git commits (**required** for re-witness RED) |
| `implementer` | `codex` (product passes `claude`) | implementer CLI: `claude`\|`codex`\|`gemini` |
| `implModel` | `sonnet` | model for the `claude` implementer |
| `redWitness` | true | mechanical re-witness RED (see reference/re-witness-red.md) |
| `loopUntilClean` | false | `--thorough` completeness critic (goal mode only) |
| `maxRounds` | 3 | replan-loop ceiling |
| `maxTasks` | 50 | total-task ceiling |

## Model routing (least-powerful-per-role)
implementer = cheap (`implModel`); reviewers / critic / integration = `opus`;
verify + re-witness relays = `haiku`; graduated escalation to `opus` on repeated
implementer failure.
