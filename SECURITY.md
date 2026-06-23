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

## Self-configuring preflight (Scout / red-witness / cache-reach)

When you give the harness only a goal (no `verifyCmd`), a one-time **Preflight** discovers how
to verify and how the build cache works, by reading the repo. Two of those steps mutate the
working tree, and you should understand them:

- **Red-witnessing the discovered command seeds a real break.** Before trusting a
  self-discovered verify command as the deterministic gate, the harness makes a **small,
  deliberately-breaking edit to one production source file**, runs the command, confirms it
  goes red (proving the command actually exercises the code, not a vacuous pass), then
  **restores the file**. This runs **once, in Preflight, before any task is built** (the run is
  serial, so no task ever builds on the seeded break), and **only under `commit:true`** (so a
  per-commit baseline exists for recovery). **Limitation:** the restore is an instruction to the
  subagent, not a structural engine guarantee — a crashed or timed-out witness agent could in
  principle leave the seeded break in the tree. Because it precedes all task work and the tree
  is committed per task, you will see any stray change in the branch diff you review before
  merging; still, run the harness on a repo under version control and review the branch.
- **Cache-reach symlinks across the worktree boundary.** For a `local-dir` cache (e.g. a build
  output dir with no compiler-cache wrapper), the harness **symlinks that directory from the
  repo's main checkout into the disposable worktree** so a fresh worktree isn't cold. This is
  reversible (a symlink, never an overwrite of a real dir) and **refuses if the main checkout
  appears to be mid-build** (to avoid poisoning a shared cache). For `wrapper`/`remote` caches
  the wrapper is kept, never blanked; if its cache dir isn't in the sandbox write-allowlist the
  harness logs a cold-build warning rather than disabling the wrapper. The allowlist grant is a
  **separate, supervised, one-time step** — the unattended run never edits `settings.json`.

## Reporting
Report privately, **do not open a public issue** for a sensitive vulnerability.

- **Preferred:** GitHub private vulnerability reporting on this repository
  (**Security → Report a vulnerability**). This requires the repo's private advisories to be
  enabled; until then, use the fallback.
- **Fallback:** contact the maintainer **[@7xuanlu](https://github.com/7xuanlu)** via GitHub.

Please allow time to triage before any public disclosure.
