# Design: claude-plugins marketplace sync + release fixes

Date: 2026-06-18
Status: approved (brainstorming) + adversarial review integrated; pending spec review
Scope: cross-repo (ultrapowers, claude-plugins, origin, boule)

## Problem

`7xuanlu/claude-plugins` is a storefront marketplace that lists three plugins, each
living in its own repo and pinned by commit `sha` in `.claude-plugin/marketplace.json`.
Verified current state (2026-06-18):

| Plugin | Source type | Pinned sha | Latest release | Tag commit | Pin vs release |
|--------|-------------|-----------|----------------|------------|----------------|
| ultrapowers | `github` | `bce9dc5` (pre-launch) | v0.1.0 | `0552410` | **behind** (6 PRs) |
| origin | `git-subdir` (path `plugin`) | `048d77a` | v0.8.4 | `c2217ed` | **ahead** (pin is 18h newer than the tag) |
| boule | `github` | `3e9036b` | v0.1.0 | `3e9036b` | **in sync** |

Two concrete problems:

1. **Stale storefront (ultrapowers).** ultrapowers' pin is six PRs behind its real code
   and serves the pre-launch description. There is no automation in `claude-plugins`
   (no `.github/`), so the bump is a manual step that gets forgotten. (origin is
   deliberately ahead of its tag; boule is current — only ultrapowers is wrong.)
2. **ultrapowers release miss.** PR #5 ("Upgrade harness to Superpowers v6 parity") is a
   substantive feature merged to `main`, but its squash-commit title is not a
   Conventional Commit, so `release-please` proposed no release. The v6 upgrade is on
   `main` but in no release; v0.1.0 is still the latest tag.

## Goals

- Fix the two problems above (one-time).
- Build automation so a release in any of the three plugin repos updates its pin in
  `claude-plugins` automatically, fast, self-healing, and **never rolls a pin backward**.

Non-goals (YAGNI):

- Auto-syncing plugin **descriptions** (editorial; would clobber curated copy).
- Pinning to anything other than published releases (no main-HEAD / prerelease pins).
- Generalizing to plugins not yet in the marketplace.

## Decisions

| Decision | Choice |
|----------|--------|
| Sync architecture | **Hybrid**: `repository_dispatch` on release (instant) + nightly `schedule` (backstop) + `workflow_dispatch` (manual) |
| Instant-path auth | One **fine-grained PAT** (`MARKETPLACE_SYNC_TOKEN`): Contents read/write **+ Metadata read** on `claude-plugins`, as a secret in the three source repos. GitHub App noted as the hardening path (not now). |
| Pin target | Each repo's **latest published release** tag's commit, **advance-only** (no-downgrade guard) |
| Apply method | Open a **PR, then immediately squash-merge it** (`gh pr merge --squash`) using the default `GITHUB_TOKEN`. `--admin` is unnecessary: claude-plugins has no branch protection, so a normal merge succeeds (and `--auto` would *fail* on an unprotected repo). |
| ultrapowers release miss | **Cut v0.2.0** via release-please, forced with a `Release-As` footer, crediting the v6 upgrade |
| Proof sandboxes | Delete both local throwaway repos |
| Watchdog branch | Merge existing **PR #7** before cutting v0.2.0 |

## Part A: one-time fixes

### A1. Merge the watchdog branch (PR #7)

`fix/codex-watchdog-group-timeout` (commit 280abfa) is **already open as PR #7** with a
Conventional title (`fix: structural group-killing timeout for codex exec implementer`).
Merge it into `main`.

### A2. Cut ultrapowers v0.2.0

`release-please` derives the next version from Conventional Commits since v0.1.0. That
range has only `chore:`/`style:`/`docs:` + the non-Conventional #5 (invisible) + the
new `fix:` (PR #7) — yielding a patch and omitting the v6 upgrade from the changelog.

To land **v0.2.0** and credit the feature reliably:

- Merge PR #7 via the **GitHub merge API with an explicit squash commit body** that
  contains the footer `Release-As: 0.2.0`. (Do NOT rely on the default squash body — it
  is the branch's commit messages, which do not carry the footer. The API `commit_message`
  field is the reliable carrier.) This forces release-please to propose v0.2.0.
- When the release PR opens, hand-edit `CHANGELOG.md` / release notes to credit PR #5
  (its non-Conventional title kept it out of the auto-generated notes).
- Merge the release PR. release-please tags v0.2.0, bumps `package.json`,
  `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, cuts the GitHub
  Release. The `release: published` event then drives the Part B sync to advance
  ultrapowers' pin in `claude-plugins`.

### A3. Delete the proof sandboxes

`/Users/lucian/Repos/ultrapowers-proof` and
`/Users/lucian/Repos/ultrapowers-proof-gemini` are local-only throwaway TDD sandboxes
(no git remotes) created to prove the codex and gemini implementers. Confirm exact paths,
then remove. Destructive; performed outside any worktree.

### A4. Correct the stale pin now

Run the Part B sync once via `workflow_dispatch`. Expected first-run result with the
advance-only guard:

- **ultrapowers:** advances (after v0.2.0 lands) — `bce9dc5` is behind the v0.2.0 commit.
- **origin:** skipped + logged — its tag commit `c2217ed` is *behind* the current pin
  `048d77a`; the guard refuses to roll back.
- **boule:** no-op — pin already equals the tag commit.

The stale ultrapowers **description** in `marketplace.json` is refreshed by hand in the
same change (editorial, one-time; not automated).

## Part B: sync automation

### Component 1: `marketplace-sync` script (claude-plugins)

Pure, unit-tested logic. No network, no git. Location: `scripts/sync-marketplace.mjs`
(+ tests). The advance-only policy lives here so it is testable.

- **Input:** the parsed `marketplace.json` object, and a map
  `pluginName -> { tag, sha, relation }`, where `relation` is the position of the release
  commit relative to the current pin (`ahead` | `behind` | `identical` | `diverged` |
  `unknown`), computed by the workflow via the compare API.
- **Output:** `{ updated: <new marketplace object>, changes: [...], skips: [...] }`.
- **Rules:**
  - Update a plugin's `source.ref` (to the tag) and `source.sha` (to the commit)
    **only when `relation === 'ahead'`**.
  - Any other relation → no change, recorded in `skips` with the reason (this is the
    no-downgrade guard: `behind`/`diverged` never roll a pin back).
  - Works for both source shapes: `github` (`repo`/`ref`/`sha`) and `git-subdir`
    (`url`/`path`/`ref`/`sha`) — `path` is never touched.
  - A plugin absent from the input map (no release resolved) is left unchanged.
  - Stable JSON write: preserve key order and 2-space formatting.

### Component 2: `sync-marketplace.yml` (claude-plugins)

The engine. Triggers:

```yaml
on:
  repository_dispatch:
    types: [plugin-released]
  schedule:
    - cron: "0 7 * * *"   # nightly backstop
  workflow_dispatch:
permissions:
  contents: write
  pull-requests: write
```

Steps:

1. Checkout `claude-plugins`.
2. For each plugin in `marketplace.json`:
   a. Resolve the source repo's **latest published release**
      (`GET /repos/{o}/{r}/releases/latest` — excludes drafts and prereleases).
      - **No release / 404** → log a WARNING (loud, not silent) and skip the plugin.
        This covers the boule-goes-prerelease hazard and deleted-release case.
   b. Dereference the tag to a commit sha (`GET /git/ref/tags/{tag}`, following
      annotated-tag objects to the underlying commit). Do not trust the release's
      `target_commitish` (it can be a branch name, e.g. ultrapowers v0.1.0's is `main`).
   c. Compute `relation` = `GET /compare/{currentPinnedSha}...{releaseSha}` status
      mapped to `ahead`/`behind`/`identical`/`diverged`. Reads are public → default
      `GITHUB_TOKEN` suffices.
3. Run the `marketplace-sync` script with the resolved map.
4. Log every `skip` with its reason. If `changes` is empty → exit (no-op).
5. Otherwise open a PR with the updated `marketplace.json`
   (`peter-evans/create-pull-request`), then immediately squash-merge it
   (`gh pr merge --squash`). Default `GITHUB_TOKEN` (same-repo write). No `--auto`, no
   `--admin` (no protections to wait on or bypass).

### Component 3: `notify-marketplace.yml` (each of ultrapowers, origin, boule)

Tiny notifier. Trigger and action:

```yaml
on:
  release:
    types: [published]
jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - name: Dispatch to claude-plugins
        env:
          GH_TOKEN: ${{ secrets.MARKETPLACE_SYNC_TOKEN }}
        run: |
          gh api repos/7xuanlu/claude-plugins/dispatches \
            -f event_type=plugin-released \
            -F client_payload[plugin]=<plugin-name> \
            -F client_payload[tag]=${{ github.event.release.tag_name }}
```

`POST /repos/{o}/{r}/dispatches` requires the PAT to have **Contents: write** (verified
against the fine-grained-PAT permission reference); Metadata: read is always required.
The `client_payload` is informational — the sync re-derives every pin itself, so a
dispatch naming one plugin still reconciles the whole manifest (cheap, extra-robust).

### Data flow

```
release:published (ultrapowers | origin | boule)
  -> notify-marketplace.yml  -- repository_dispatch (PAT) -->
     claude-plugins: sync-marketplace.yml
       per plugin: latest release -> tag commit -> relation vs current pin
       -> marketplace-sync script (advance-only edit)
       -> PR -> squash-merge
nightly cron + manual dispatch -> same job (backstop / on-demand)
```

## Error handling

- **No release for a plugin (incl. only-prerelease, deleted release):** WARN loud, skip,
  do not fail, do not change the pin.
- **Relation `behind`/`diverged`/`identical`:** skip + log; never roll back (no-downgrade).
- **GH API error / rate limit:** fail the run; nightly cron and next dispatch retry.
- **No drift:** no PR (idempotent).
- **Dispatch POST fails** (expired PAT): notifier run fails visibly; nightly cron still
  reconciles within <=24h — closes the missing-backstop failure mode that caused the
  original staleness.
- **Annotated vs lightweight tags:** dereference tag objects to the commit so the pin is
  always a commit, never a tag object. (All current tags are lightweight; release-please
  may cut annotated ones, so the path is kept.)

## Security

- One PAT replicated across three repos: a leak from any repo's Actions context grants
  Contents: write on the storefront. Mitigations: fine-grained scope (only
  `claude-plugins`, only Contents+Metadata), and the advance-only guard limits damage to
  "pin moved forward to a real release commit." GitHub App (installed only on
  `claude-plugins`, short-lived tokens) is the recommended later hardening.
- The sync resolves pins from each source repo's releases and merges without a human
  gate (per the chosen apply method). Acceptable for a personal solo marketplace; the
  advance-only + real-release-commit constraints bound what can be shipped. Revisit
  (human-merge gate) if the marketplace gains external maintainers.
- Restrict who can run `workflow_dispatch` via repo/environment settings if desired.

## Testing

- **Unit (TDD), `marketplace-sync` script:**
  - `relation:'ahead'` updates ref+sha (github shape).
  - `relation:'ahead'` updates ref+sha (git-subdir shape; `path` preserved).
  - `relation:'behind'` / `'diverged'` / `'identical'` → no change, recorded as skip
    (no-downgrade guard).
  - plugin missing from the map → untouched.
  - multiple plugins, mixed relations, in one pass.
  - stable serialization (key order/format preserved).
- **Integration (manual `workflow_dispatch`) — corrected success criteria:** after
  v0.2.0 lands, one run advances **only ultrapowers**; **origin is skipped** (behind,
  logged); **boule is a no-op** (identical). Verify the resulting ultrapowers
  `sha`/`ref` equal the v0.2.0 tag commit.
- **Notifier wiring:** verified end-to-end when v0.2.0 publishes — the release event
  triggers the dispatch and the ultrapowers pin PR.

## Prerequisites (human-provided)

- Create the fine-grained PAT (Contents: read/write, Metadata: read, scoped to
  `claude-plugins`); add it as secret `MARKETPLACE_SYNC_TOKEN` in ultrapowers, origin,
  boule.
- No repo-settings change needed for merge (plain squash-merge works without protection).

## Sequencing

1. Part B machinery first (script + workflows + tests).
2. A1 (merge PR #7 with `Release-As: 0.2.0` body) -> A2 (review + merge release PR ->
   v0.2.0). The v0.2.0 release exercises the notifier end-to-end.
3. A4: if the notifier-driven sync did not already advance ultrapowers, run one manual
   `workflow_dispatch`; apply the one-time description refresh in the same PR.
4. A3 (delete sandboxes) any time; independent.
