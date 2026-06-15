# Security

ultrapowers is an **unattended build harness**: when you run
`/workflows-driven-development`, it dispatches a Workflow that **writes files, runs your
project's test/verify command, and makes git commits** in the target repo on your behalf,
across many disposable subagents, with human gates only at plan-approval and critical-review.

## What this means for you
- **Run it on code and in a repo you trust**, ideally in an isolated worktree/branch (the
  command creates one if you're on `main`). The harness commits per task; review the branch
  before merging.
- **`verifyCmd` is executed.** Whatever you pass as the verify/test command runs on your
  machine with your permissions. Do not point it at untrusted scripts.
- **External implementer CLIs are opt-in.** The product default `implementer:"claude"` needs
  no external CLI. `codex`/`gemini` shell out to those tools only if you select them.
- **The SessionStart hook** creates one symlink in `~/.claude/workflows/` pointing at the
  bundled engine. It never clobbers an existing real file and is removable (the symlink
  dangles harmlessly if the plugin is uninstalled).

## Reporting
Report privately — **do not open a public issue** for a sensitive vulnerability.

- **Preferred:** GitHub private vulnerability reporting on this repository
  (**Security → Report a vulnerability**). This requires the repo's private advisories to be
  enabled; until then, use the fallback.
- **Fallback:** contact the maintainer **[@7xuanlu](https://github.com/7xuanlu)** via GitHub.

Please allow time to triage before any public disclosure.
