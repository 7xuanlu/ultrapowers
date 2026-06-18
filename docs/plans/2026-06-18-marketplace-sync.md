# Marketplace Sync + Release Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automate `7xuanlu/claude-plugins` marketplace pin sync for ultrapowers/origin/boule (instant on release + nightly backstop, advance-only), and fix the two diagnosed problems (ultrapowers release miss; stale pin).

**Architecture:** A pure, unit-tested Node script (`sync-marketplace.mjs`) holds the advance-only pin policy; a network script (`resolve-pins.mjs`) resolves each plugin's latest-release commit + its relation to the current pin via the GitHub REST API; a workflow in claude-plugins (`sync-marketplace.yml`) wires them together and lands changes as an auto-squash-merged PR; a tiny notifier (`notify-marketplace.yml`) in each source repo fires `repository_dispatch` on release. Triggers: dispatch (instant) + nightly cron (self-healing) + manual.

**Tech Stack:** Node 20 (ESM, built-in `node:test`, global `fetch` — no external deps), GitHub Actions, `gh` CLI (in CI), GitHub REST API.

## Global Constraints

- **Dependency-free:** no npm dependencies; tests use `node --test`, HTTP uses global `fetch`. (Mirrors the ultrapowers repo.)
- **Advance-only:** a pin is only ever moved to a release commit whose `relation` to the current pin is `ahead`. `behind`/`identical`/`diverged`/`unknown` → skip + log. Never roll a pin backward.
- **Pin target:** each repo's latest *published* release (`releases/latest` excludes drafts and prereleases). The pinned `sha` is always a commit (annotated tags are dereferenced); `ref` is set to the tag.
- **Source shapes:** support both `github` (`repo`/`ref`/`sha`) and `git-subdir` (`url`/`path`/`ref`/`sha`); never modify `path`. Preserve JSON key order and 2-space indentation.
- **Apply method:** open a PR then immediately `gh pr merge --squash` with the default `GITHUB_TOKEN` (no `--auto`, no `--admin`; claude-plugins has no branch protection).
- **Auth:** the sync job (resolve/apply/PR) uses the default `GITHUB_TOKEN`. Only the per-repo notifier uses the fine-grained PAT secret `MARKETPLACE_SYNC_TOKEN` (Contents: read/write + Metadata: read on claude-plugins) to POST the dispatch.
- **Repos with destructive/irreversible ops** (PR merges, release cut, dir deletion) require human approval at execution time.

## Working directories

- **claude-plugins tasks (1-3):** a local clone at `/Users/lucian/Repos/claude-plugins`. Clone if absent: `git clone git@github.com:7xuanlu/claude-plugins.git /Users/lucian/Repos/claude-plugins` (SSH — local `gh`/HTTPS API has a TLS cert failure). Work on branch `feature/marketplace-sync`.
- **ultrapowers notifier (Task 4a):** the current worktree (`.claude/worktrees/feature+marketplace-sync`).
- **origin / boule notifiers (Task 4b):** local clones or GitHub web PRs; tiny config files.
- **Operational tasks (A1-A5):** GitHub-side; use the GitHub MCP tools (local `gh` TLS is broken).

## File Structure

| File | Repo | Responsibility |
|------|------|----------------|
| `scripts/sync-marketplace.mjs` | claude-plugins | Pure advance-only pin update + CLI wrapper |
| `scripts/sync-marketplace.test.mjs` | claude-plugins | Unit tests for the pure policy |
| `scripts/resolve-pins.mjs` | claude-plugins | Resolve latest-release commit + relation (network) |
| `scripts/resolve-pins.test.mjs` | claude-plugins | Unit test for the pure `repoOf` helper |
| `package.json` | claude-plugins | `type: module`, `test` script |
| `.github/workflows/ci.yml` | claude-plugins | Run `node --test` + validate marketplace.json |
| `.github/workflows/sync-marketplace.yml` | claude-plugins | The sync engine (dispatch/cron/manual) |
| `.github/workflows/notify-marketplace.yml` | ultrapowers, origin, boule | Notifier: dispatch on `release: published` |

---

### Task 1: Pure pin-sync policy (`sync-marketplace.mjs`)

**Files:**
- Create: `scripts/sync-marketplace.mjs` (claude-plugins clone)
- Test: `scripts/sync-marketplace.test.mjs`
- Create: `package.json`

**Interfaces:**
- Produces: `syncMarketplace(manifest, resolved) -> { updated, changes, skips }`
  - `manifest`: parsed marketplace.json object.
  - `resolved`: `Record<string, { tag: string, sha: string, relation: 'ahead'|'behind'|'identical'|'diverged'|'unknown' }>`.
  - `changes`: `Array<{ name, fromSha, toSha, ref }>`; `skips`: `Array<{ name, reason, fromSha, toSha }>`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "claude-plugins-marketplace",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test scripts/*.test.mjs"
  }
}
```

- [ ] **Step 2: Write the failing test** (`scripts/sync-marketplace.test.mjs`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncMarketplace } from './sync-marketplace.mjs';

const manifest = () => ({
  name: '7xuanlu',
  plugins: [
    { name: 'origin', source: { source: 'git-subdir', url: 'https://github.com/7xuanlu/origin.git', path: 'plugin', ref: 'main', sha: 'OLDORIGIN' }, description: 'd', category: 'memory' },
    { name: 'boule', source: { source: 'github', repo: '7xuanlu/boule', ref: 'main', sha: 'BOULESHA' }, description: 'd' },
    { name: 'ultrapowers', source: { source: 'github', repo: '7xuanlu/ultrapowers', ref: 'main', sha: 'OLDUP' }, description: 'd' },
  ],
});

test('advance: github shape updates ref+sha', () => {
  const { updated, changes } = syncMarketplace(manifest(), { ultrapowers: { tag: 'v0.2.0', sha: 'NEWUP', relation: 'ahead' } });
  const up = updated.plugins.find((p) => p.name === 'ultrapowers');
  assert.equal(up.source.sha, 'NEWUP');
  assert.equal(up.source.ref, 'v0.2.0');
  assert.deepEqual(changes, [{ name: 'ultrapowers', fromSha: 'OLDUP', toSha: 'NEWUP', ref: 'v0.2.0' }]);
});

test('advance: git-subdir shape updates ref+sha, preserves path', () => {
  const { updated } = syncMarketplace(manifest(), { origin: { tag: 'v0.9.0', sha: 'NEWORIGIN', relation: 'ahead' } });
  const o = updated.plugins.find((p) => p.name === 'origin');
  assert.equal(o.source.sha, 'NEWORIGIN');
  assert.equal(o.source.ref, 'v0.9.0');
  assert.equal(o.source.path, 'plugin');
  assert.equal(o.source.source, 'git-subdir');
});

test('no-downgrade: behind relation does not change pin', () => {
  const { updated, changes, skips } = syncMarketplace(manifest(), { origin: { tag: 'v0.8.4', sha: 'TAGCOMMIT', relation: 'behind' } });
  assert.equal(updated.plugins.find((p) => p.name === 'origin').source.sha, 'OLDORIGIN');
  assert.equal(changes.length, 0);
  assert.equal(skips[0].reason, 'behind');
});

test('identical relation is a no-op skip', () => {
  const { changes, skips } = syncMarketplace(manifest(), { boule: { tag: 'v0.1.0', sha: 'BOULESHA', relation: 'identical' } });
  assert.equal(changes.length, 0);
  assert.equal(skips[0].reason, 'identical');
});

test('diverged relation does not change pin', () => {
  const { changes, skips } = syncMarketplace(manifest(), { ultrapowers: { tag: 'vX', sha: 'WEIRD', relation: 'diverged' } });
  assert.equal(changes.length, 0);
  assert.equal(skips[0].reason, 'diverged');
});

test('plugin missing from map is untouched', () => {
  const { updated, changes, skips } = syncMarketplace(manifest(), {});
  assert.equal(changes.length, 0);
  assert.equal(skips.length, 0);
  assert.equal(updated.plugins.find((p) => p.name === 'boule').source.sha, 'BOULESHA');
});

test('mixed relations in one pass', () => {
  const { changes, skips } = syncMarketplace(manifest(), {
    ultrapowers: { tag: 'v0.2.0', sha: 'NEWUP', relation: 'ahead' },
    origin: { tag: 'v0.8.4', sha: 'TC', relation: 'behind' },
    boule: { tag: 'v0.1.0', sha: 'BOULESHA', relation: 'identical' },
  });
  assert.equal(changes.length, 1);
  assert.equal(changes[0].name, 'ultrapowers');
  assert.equal(skips.length, 2);
});

test('key order preserved in github source', () => {
  const { updated } = syncMarketplace(manifest(), { boule: { tag: 'v0.2.0', sha: 'NB', relation: 'ahead' } });
  assert.deepEqual(Object.keys(updated.plugins.find((p) => p.name === 'boule').source), ['source', 'repo', 'ref', 'sha']);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /Users/lucian/Repos/claude-plugins && node --test scripts/sync-marketplace.test.mjs`
Expected: FAIL — `Cannot find module './sync-marketplace.mjs'`.

- [ ] **Step 4: Write minimal implementation** (`scripts/sync-marketplace.mjs`)

```js
// Pure advance-only marketplace pin policy + thin CLI wrapper.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export function syncMarketplace(manifest, resolved) {
  const changes = [];
  const skips = [];
  const plugins = (manifest.plugins || []).map((p) => {
    const r = resolved[p.name];
    if (!r) return p; // no release resolved -> leave unchanged (workflow logs the warning)
    if (r.relation !== 'ahead') {
      skips.push({ name: p.name, reason: r.relation, fromSha: p.source?.sha, toSha: r.sha });
      return p;
    }
    const fromSha = p.source?.sha;
    // Overwriting existing keys preserves their original position (JS insertion order).
    const source = { ...p.source, ref: r.tag, sha: r.sha };
    changes.push({ name: p.name, fromSha, toSha: r.sha, ref: r.tag });
    return { ...p, source };
  });
  return { updated: { ...manifest, plugins }, changes, skips };
}

// CLI: node sync-marketplace.mjs <manifestPath> <resolvedJsonPath>
// Rewrites the manifest in place; prints { changes, skips } JSON to stdout.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [manifestPath, resolvedPath] = process.argv.slice(2);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const resolved = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  const { updated, changes, skips } = syncMarketplace(manifest, resolved);
  fs.writeFileSync(manifestPath, JSON.stringify(updated, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ changes, skips }, null, 2) + '\n');
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test scripts/sync-marketplace.test.mjs`
Expected: PASS — 8 tests.

- [ ] **Step 6: Commit**

```bash
git add package.json scripts/sync-marketplace.mjs scripts/sync-marketplace.test.mjs
git commit -m "feat: advance-only marketplace pin-sync policy with tests"
```

---

### Task 2: Release resolver (`resolve-pins.mjs`)

**Files:**
- Create: `scripts/resolve-pins.mjs` (claude-plugins clone)
- Test: `scripts/resolve-pins.test.mjs`

**Interfaces:**
- Consumes: nothing from Task 1 at runtime (separate script); its stdout JSON is the `resolved` input the Task 1 CLI reads.
- Produces: `repoOf(source) -> string|null` (exported, unit-tested). CLI: `node resolve-pins.mjs <manifestPath>` prints `Record<name,{tag,sha,relation}>` to stdout; logs (`::warning::`/progress) to stderr.

- [ ] **Step 1: Write the failing test** (`scripts/resolve-pins.test.mjs`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repoOf } from './resolve-pins.mjs';

test('repoOf reads github shape', () => {
  assert.equal(repoOf({ source: 'github', repo: '7xuanlu/boule' }), '7xuanlu/boule');
});

test('repoOf derives owner/repo from git-subdir url', () => {
  assert.equal(repoOf({ source: 'git-subdir', url: 'https://github.com/7xuanlu/origin.git', path: 'plugin' }), '7xuanlu/origin');
});

test('repoOf returns null when unresolvable', () => {
  assert.equal(repoOf({ source: 'local' }), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/resolve-pins.test.mjs`
Expected: FAIL — `Cannot find module './resolve-pins.mjs'`.

- [ ] **Step 3: Write minimal implementation** (`scripts/resolve-pins.mjs`)

```js
// Resolve each marketplace plugin to its source repo's latest published release
// commit + relation vs the current pin. Network code (GitHub REST, global fetch).
// The pure policy lives in sync-marketplace.mjs; only repoOf is unit-tested here.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export function repoOf(source = {}) {
  if (source.repo) return source.repo;
  if (source.url) return source.url.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');
  return null;
}

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
async function api(path) {
  return fetch(`https://api.github.com${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'claude-plugins-sync',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const resolved = {};
  for (const p of manifest.plugins || []) {
    const repo = repoOf(p.source || {});
    const curSha = p.source?.sha;
    if (!repo) { console.error(`::warning::no source repo for ${p.name}`); continue; }

    const relRes = await api(`/repos/${repo}/releases/latest`);
    if (relRes.status === 404) { console.error(`::warning::no published release for ${p.name} (${repo}) — skipping`); continue; }
    if (!relRes.ok) throw new Error(`releases/latest ${repo}: ${relRes.status}`);
    const tag = (await relRes.json()).tag_name;

    const refRes = await api(`/repos/${repo}/git/ref/tags/${encodeURIComponent(tag)}`);
    if (!refRes.ok) throw new Error(`git/ref/tags ${repo} ${tag}: ${refRes.status}`);
    const obj = (await refRes.json()).object;
    let sha = obj.sha;
    if (obj.type === 'tag') { // annotated tag -> dereference to commit
      const tRes = await api(`/repos/${repo}/git/tags/${sha}`);
      if (!tRes.ok) throw new Error(`git/tags ${repo} ${sha}: ${tRes.status}`);
      sha = (await tRes.json()).object.sha;
    }

    let relation = 'unknown';
    if (curSha) {
      const cRes = await api(`/repos/${repo}/compare/${curSha}...${sha}`);
      if (cRes.ok) relation = (await cRes.json()).status; // ahead|behind|identical|diverged
      else if (cRes.status !== 404) throw new Error(`compare ${repo}: ${cRes.status}`);
    }
    resolved[p.name] = { tag, sha, relation };
    console.error(`resolved ${p.name}: ${tag} ${sha.slice(0, 7)} (${relation})`);
  }
  process.stdout.write(JSON.stringify(resolved, null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/resolve-pins.test.mjs`
Expected: PASS — 3 tests.

- [ ] **Step 5: Smoke-test resolution against live repos** (read-only)

Run: `node scripts/resolve-pins.mjs .claude-plugin/marketplace.json`
Expected (stderr): `resolved origin: v0.8.4 c2217ed (behind)`, `resolved boule: v0.1.0 3e9036b (identical)`, `resolved ultrapowers: v0.1.0 0552410 (ahead)` (ultrapowers shows `ahead` only until v0.2.0; the point is the relations resolve without error). stdout: a JSON map.

- [ ] **Step 6: Commit**

```bash
git add scripts/resolve-pins.mjs scripts/resolve-pins.test.mjs
git commit -m "feat: resolve latest-release commit + relation per plugin"
```

---

### Task 3: claude-plugins CI + sync workflow

**Files:**
- Create: `.github/workflows/ci.yml` (claude-plugins clone)
- Create: `.github/workflows/sync-marketplace.yml`

**Interfaces:**
- Consumes: `scripts/resolve-pins.mjs`, `scripts/sync-marketplace.mjs` (Tasks 1-2), `.claude-plugin/marketplace.json`.

- [ ] **Step 1: Create CI** (`.github/workflows/ci.yml`)

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm test
      - name: Validate marketplace.json
        run: node -e "JSON.parse(require('fs').readFileSync('.claude-plugin/marketplace.json','utf8'));console.log('ok')"
```

- [ ] **Step 2: Run the test suite locally (proxy for CI)**

Run: `npm test`
Expected: PASS — all tests from Tasks 1-2 (11 total).

- [ ] **Step 3: Create the sync workflow** (`.github/workflows/sync-marketplace.yml`)

```yaml
name: sync-marketplace

# Advance-only sync of plugin pins to their latest published releases.
# Instant via repository_dispatch from each plugin repo's release; nightly cron
# is the self-healing backstop; workflow_dispatch is manual/on-demand.
on:
  repository_dispatch:
    types: [plugin-released]
  schedule:
    - cron: "0 7 * * *"
  workflow_dispatch:

permissions:
  contents: write
  pull-requests: write

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Resolve latest-release pins
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: node scripts/resolve-pins.mjs .claude-plugin/marketplace.json > /tmp/resolved.json

      - name: Apply advance-only pin updates
        id: apply
        run: |
          node scripts/sync-marketplace.mjs .claude-plugin/marketplace.json /tmp/resolved.json | tee /tmp/out.json
          changed=$(node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('/tmp/out.json','utf8')).changes.length))")
          echo "changed=$changed" >> "$GITHUB_OUTPUT"

      - name: Open and squash-merge PR
        if: steps.apply.outputs.changed != '0'
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          set -euo pipefail
          branch="sync/marketplace-${GITHUB_RUN_ID}"
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git checkout -b "$branch"
          git add .claude-plugin/marketplace.json
          git commit -m "chore: sync plugin pins to latest releases"
          git push origin "$branch"
          gh pr create --base main --head "$branch" \
            --title "chore: sync plugin pins to latest releases" \
            --body "Automated advance-only pin sync. Changes/skips in the workflow run log."
          # Retry: mergeable state can be UNKNOWN immediately after create.
          for i in 1 2 3 4 5; do
            if gh pr merge "$branch" --squash --delete-branch; then break; fi
            echo "merge not ready, retry $i"; sleep 5
          done
```

- [ ] **Step 4: Validate workflow YAML**

Run: `node -e "const y=require('fs').readFileSync('.github/workflows/sync-marketplace.yml','utf8'); if(!/on:|jobs:/.test(y)) throw new Error('bad'); console.log('yaml shape ok')"`
(Optionally `actionlint` if installed.) Expected: `yaml shape ok`.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml .github/workflows/sync-marketplace.yml
git commit -m "ci: marketplace test CI + advance-only sync workflow"
```

- [ ] **Step 6: Open the claude-plugins PR**

```bash
git push origin feature/marketplace-sync
```
Then open a PR (GitHub MCP `create_pull_request`, base `main`) titled
`feat: automated advance-only marketplace pin sync`. Do NOT enable the notifier path
verification yet (needs the PAT — see Prerequisite gate). Merging this PR is a human-gated
step.

- [ ] **Step 7: Manual integration verification (after merge)**

Trigger `sync-marketplace.yml` via `workflow_dispatch`. Expected log: `ultrapowers` skipped/`identical` or advanced (depending on whether v0.2.0 has landed), `origin` skipped `behind`, `boule` `identical`. With no v0.2.0 yet and the pre-launch ultrapowers pin, ultrapowers resolves `ahead` to v0.1.0's commit `0552410` and a PR bumps it — acceptable (still forward). Confirm the run opens+merges a PR only when something advanced.

---

### Task 4: Notifier workflow in each source repo

**Files:**
- Create: `.github/workflows/notify-marketplace.yml` in **ultrapowers** (this worktree), **origin**, **boule**.

**Interfaces:**
- Consumes: secret `MARKETPLACE_SYNC_TOKEN` (Prerequisite gate); the claude-plugins `repository_dispatch` type `plugin-released` (Task 3).

- [ ] **Step 1: Add the notifier to ultrapowers** (`.github/workflows/notify-marketplace.yml`, in the current worktree)

```yaml
name: notify-marketplace

# On a published release, tell the claude-plugins marketplace to re-sync pins.
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
            -F "client_payload[plugin]=ultrapowers" \
            -F "client_payload[tag]=${{ github.event.release.tag_name }}"
```

- [ ] **Step 2: Commit (ultrapowers worktree)**

```bash
git add .github/workflows/notify-marketplace.yml
git commit -m "ci: notify claude-plugins marketplace on release"
```

- [ ] **Step 3: Add the same notifier to origin and boule**

Identical file, with `client_payload[plugin]` set to `origin` and `boule` respectively.
Deliver via a small PR per repo (clone + branch + PR, or GitHub MCP `create_or_update_file`
on a branch + `create_pull_request`). Branch: `ci/notify-marketplace`.

- [ ] **Step 4: Verification (after Prerequisite gate + merges)**

Deferred to Task A3 — the v0.2.0 release is the first live `release: published` event;
confirm the ultrapowers notifier run dispatches and the claude-plugins sync runs.

---

### Prerequisite gate (human-provided) — before Task 4 verification / Task A3

- [ ] Create a fine-grained PAT: resource owner `7xuanlu`, repo access = **only** `claude-plugins`, permissions **Contents: read and write** + **Metadata: read**.
- [ ] Add it as Actions secret `MARKETPLACE_SYNC_TOKEN` in `ultrapowers`, `origin`, and `boule`.

(If the user defers the PAT, the cron/manual sync still works; only the instant dispatch is inert until the secret exists.)

---

### Task A1: Merge PR #7 forcing v0.2.0

**Irreversible (merge). Human-gated.**

- [ ] **Step 1: Squash-merge PR #7 with a `Release-As` footer**

Use GitHub MCP `merge_pull_request`: `owner=7xuanlu`, `repo=ultrapowers`, `pullNumber=7`,
`merge_method=squash`,
`commit_title="fix: structural group-killing timeout for codex exec implementer (#7)"`,
`commit_message` ending with a blank line then `Release-As: 0.2.0`.

- [ ] **Step 2: Verify release-please proposes v0.2.0**

After the `release-please` workflow runs on the push to main, list open PRs
(`list_pull_requests` owner/repo=7xuanlu/ultrapowers, state=open). Expected: a
"chore(main): release 0.2.0" PR. If it shows 0.1.1, the footer did not land — re-merge an
empty commit carrying `Release-As: 0.2.0` (do via a tiny PR, not a direct push to main).

---

### Task A2: Cut v0.2.0 and credit PR #5

**Irreversible (release). Human-gated.**

- [ ] **Step 1: Credit the v6 upgrade in the release PR**

On the release-please PR branch, edit `CHANGELOG.md` to add a `### Features` entry for the
Superpowers v6 parity upgrade (PR #5) — its non-Conventional squash title kept it out of
the auto-generated notes. (Edit via GitHub MCP `create_or_update_file` on the release PR's
head branch.)

- [ ] **Step 2: Merge the release PR**

Squash-merge it (GitHub MCP `merge_pull_request`). release-please tags v0.2.0, bumps the
three version fields, and cuts the GitHub Release.

- [ ] **Step 3: Verify**

`get_latest_release` owner/repo=7xuanlu/ultrapowers → `tag_name == v0.2.0`.

---

### Task A3: Confirm the end-to-end sync advanced ultrapowers

- [ ] **Step 1: Check the dispatch fired**

After v0.2.0 publishes (and the PAT secret exists), the ultrapowers `notify-marketplace`
run should dispatch and the claude-plugins `sync-marketplace` run should open+merge a pin
PR. If the secret was not yet set, run `sync-marketplace.yml` via `workflow_dispatch`.

- [ ] **Step 2: Verify the pin**

`get_file_contents` claude-plugins `.claude-plugin/marketplace.json` → the `ultrapowers`
entry `source.sha` equals the v0.2.0 tag commit and `source.ref == v0.2.0`. origin/boule
unchanged.

---

### Task A4: One-time description refresh (editorial)

- [ ] **Step 1:** In claude-plugins `.claude-plugin/marketplace.json`, replace the stale
ultrapowers `description` ("Unattended SDD/TDD build harness — strict TDD, two-stage
fail-closed review, mechanical re-witness-RED. Complements superpowers.") with the current
tagline used in the ultrapowers plugin.json. Deliver as a small PR (the sync never touches
descriptions). Verify JSON still parses.

---

### Task A5: Delete the proof sandboxes

**Destructive. Human-gated — confirm exact paths first.**

- [ ] **Step 1: Confirm both are throwaway (no remote)**

```bash
for d in /Users/lucian/Repos/ultrapowers-proof /Users/lucian/Repos/ultrapowers-proof-gemini; do
  echo "$d:"; git -C "$d" remote -v; done
```
Expected: no remotes for either.

- [ ] **Step 2: Delete after explicit confirmation**

```bash
rm -rf /Users/lucian/Repos/ultrapowers-proof /Users/lucian/Repos/ultrapowers-proof-gemini
```

---

## Notes on sequencing

Build order: Tasks 1-3 (claude-plugins PR) → Task 4 (notifiers) → Prerequisite gate (PAT) →
A1 → A2 → A3 → A4 → A5. A5 is independent and may run any time. The PAT gate only blocks the
*instant* path and Task A3's notifier-driven verification; cron/manual sync works without it.
