# Stale remote branch audit (#572, Phase A -- read-only)

Generated: 2026-09-02T00:18:26Z
Repository: `MongLong0214/agent-operator-score`
Machine-readable source of truth: [`fixtures/stale-branches/audit.json`](../fixtures/stale-branches/audit.json)
(checked by [`tests/product/stale-branch-audit.test.mjs`](../tests/product/stale-branch-audit.test.mjs))

**This is Phase A of #572 only.** Phase A is read-only: inventory, classify, and record what would
be lost. No branch was created, deleted, renamed, or force-pushed to produce this document. The
destructive phase (Phase B / "final-deletion") is explicitly out of scope here and remains blocked
on **#578** -- final release/E2E evidence must be preserved before anything is deleted. Nothing in
this document authorizes deletion; it only records what a future, separate deletion step should do
and why.

## Method

Every fact below came from a read command against `MongLong0214/agent-operator-score`:

- `git ls-remote --heads origin` -- the full current list of remote branches.
- `git merge-base --is-ancestor <branch> origin/dev` / `origin/main`, and `git rev-list
  origin/dev..<branch>` / `origin/main..<branch>` -- merge status and unique-commit counts.
- `git log`, `git branch -r --contains`, `git tag --contains` -- authorship, dates, and whether a
  commit exists on any other ref.
- `gh pr list --repo MongLong0214/agent-operator-score --state all --limit 500 --json ...` (355 PRs
  fetched in full, not the default 200) -- whether any PR, open or closed, ever used a branch as its
  head, or mentioned its name in a PR body.
- `gh api search/issues -f q='repo:... "<branch name>"'` -- whether any issue anywhere on the
  repository mentions a branch by name.
- `gh api repos/MongLong0214/agent-operator-score/branches/<branch>/protection` and
  `.../rulesets` -- branch protection and ruleset status.

## Snapshot

`git ls-remote --heads origin` reported 6 heads at generation time:

| branch | head SHA |
|---|---|
| `dev` | `499bb11b004024fc46b9e97300ad8909d86a5073` |
| `fix/a-fixture-backed-agent-is-not-a-runtime` | `e75d23258fb904c12cc6b8373a2ecd7d9d2b90e1` |
| `main` | `d2c68036ebf9f9fd7287258fd3cec252133ef846` |
| `task/issue-570-action-pins` | `7d2d1be696c4a5a80cf8c1f58bcf9178bd024c63` |
| `task/issue-588-mark-done` | `034fcac5fcbd50e64ceb7cf8e8a7d21e57e7f08a` |
| `tmp/read-claude-artifact` | `2d6392f578dd2667d5f1f6ba5073a2c4311430eb` |

`main` and `dev` are excluded from the table below by definition. `task/issue-570-action-pins` is
the head of an **open** PR (#590, targeting `dev`) -- it is active in-flight work, not stale, so it
is recorded separately rather than in the per-branch table (matching the issue's own scope: "every
remote branch ... that is not main, dev, or an open PR's head").

| branch | open PR | state | reason for exclusion from the table |
|---|---|---|---|
| `task/issue-570-action-pins` | [#590](https://github.com/MongLong0214/agent-operator-score/pull/590) | OPEN | active work behind an open PR; not stale |

## Per-branch audit

### `fix/a-fixture-backed-agent-is-not-a-runtime`

| field | value |
|---|---|
| head SHA | `e75d23258fb904c12cc6b8373a2ecd7d9d2b90e1` |
| author | MongLong0214 |
| last commit | 2026-08-28T20:37:31+09:00 |
| age | 4 days |
| merged into `dev` | yes (0 commits unique to the branch) |
| merged into `main` | yes (0 commits unique to the branch) |
| unmerged commits | 0 |
| ever referenced by a PR | no (0 of 355 PRs, head or body) |
| ever referenced elsewhere | only as a named candidate in issue #572 itself |
| branch protection | none |
| **recommendation** | **safe to delete after #578** |

Reason: the tip commit is an ancestor of both `origin/dev` and `origin/main`; every commit on this
branch already lives on the integration and release lines under a different route (it was, per its
own merge-commit subject, folded in via the `chore/back-merge-0.1.10` chain). Deleting it after
#578's evidence bundle is captured loses nothing, because nothing on it is unique.

### `task/issue-588-mark-done`

| field | value |
|---|---|
| head SHA | `034fcac5fcbd50e64ceb7cf8e8a7d21e57e7f08a` |
| author | MongLong0214 (`weplay0628@gmail.com`) |
| last commit | 2026-09-02T08:29:26+09:00 |
| age | 0 days |
| merged into `dev` | **no** |
| merged into `main` | **no** |
| unmerged commits | **2**, forked exactly at `dev`'s current tip |
| ever referenced by a PR | no (0 of 355 PRs, head or body) |
| ever referenced elsewhere | **no** -- not on any other branch or tag, not in any issue, not even on #572's own candidate list |
| branch protection | none |
| **recommendation** | **must be preserved** |

Reason: this branch was not on anyone's radar. `git branch -r --contains 034fcac...` and `git tag
--contains 034fcac...` both return only this branch; `gh api search/issues` for the branch name
returns zero results anywhere in the repository. It carries two real commits on top of the current
`dev` tip:

- `bc98c45` -- marks issue #588 done and refreshes the committed GitHub-state fixture.
- `034fcac` -- "harden the execution-plan checks against a forged pass": closes 7 named gaps a final
  adversarial review found in the #588 execution-plan governance gate (forged close-evidence
  records, unauthorized attesters, a self-disabling excluded-issue check, predecessor gating that
  only covered the `ready` status, an unreported destructive-phase restriction on #572 itself, an
  unvalidated fixture-as-snapshot, undercounted status labels), plus JSON-schema-subset and
  cycle-detection bugfixes, and adds 8 new mutation guards.

**What would be lost if this branch were deleted:** the only copy of that hardening work. It exists
nowhere else in the repository. This needs a human decision -- rebase it onto `dev` and open a PR
under its own issue, or confirm the work is superseded by something that shipped a different way --
not a deletion. Until that decision is made it must survive untouched.

### `tmp/read-claude-artifact`

| field | value |
|---|---|
| head SHA | `2d6392f578dd2667d5f1f6ba5073a2c4311430eb` |
| author | MongLong0214 |
| last commit | 2026-08-29T11:33:54+09:00 |
| age | 3 days |
| merged into `dev` | yes (0 commits unique to the branch) |
| merged into `main` | yes (0 commits unique to the branch) |
| unmerged commits | 0 |
| ever referenced by a PR | no (0 of 355 PRs, head or body) |
| ever referenced elsewhere | only as a named candidate in issue #572 itself |
| branch protection | none |
| **recommendation** | **safe to delete after #578** |

Reason: fully contained in both `origin/dev` and `origin/main` via PR #538's back-merge chain. It is
a `tmp/*` branch; repository policy already caps those at 7 days or task end, and this one is 3 days
old with its only content long since merged elsewhere. Deleting it after #578 loses nothing.

## Repository-level facts

- `main` and `dev` are both branch-protected: `allow_deletions: false`, `allow_force_pushes: false`,
  `enforce_admins: true`. No repository rulesets are configured (`gh api .../rulesets` returns `[]`).
- The repository has `delete_branch_on_merge: true` -- normal feature/task branches are already
  removed automatically on merge, which is consistent with the general policy this issue documents
  (feature/task/fix branches deleted after merge; `tmp/*` capped at 7 days or task end;
  release/hotfix branches deleted after release + back-merge) and with why so few stale branches
  exist at all: three, one of which (`task/issue-588-mark-done`) was never merged and is not
  auto-deletable because it was never the head of a merged PR.
- None of the three audited branches, nor the excluded open-PR-head branch, have any branch
  protection of their own.

## Why the JSON lives at `fixtures/stale-branches/audit.json`, not under `governance/`

`AGENT_RULES.md` lists `governance/**` as coordinator-owned hot-file surface. The machine-readable
audit was placed at `fixtures/stale-branches/audit.json` instead so this issue does not touch that
surface. **The coordinator may want to move this file under `governance/` (or elsewhere) as part of
its own integration; nothing here depends on the exact path, only on the schema (`aos-stale-branch-audit.v1`).**

## What Phase B (blocked on #578) must still do

Per the issue's own two-phase execution section, Phase B (after #578 PASS) is:

1. Confirm the final evidence bundle preserves what needs preserving (in particular, resolve
   `task/issue-588-mark-done` -- do not delete it before that resolution, whatever it is).
2. Delete only the branches this audit marks `safe_to_delete_after_578`
   (`fix/a-fixture-backed-agent-is-not-a-runtime`, `tmp/read-claude-artifact`) -- and re-verify the
   classification against a fresh `git ls-remote` first, since branch state can change between Phase
   A and Phase B.
3. Re-read post-delete state and confirm the invariants the issue lists: `main`/`dev`/tag SHAs
   unchanged, open PR heads untouched, branch protection unchanged.

None of that was performed here. No `git push --delete`, `git branch -D` on a branch this agent did
not create, or `gh api -X DELETE` was run at any point during this work.
