# Stale remote branch audit (#572, Phase A -- read-only)

> **This is a snapshot taken during active parallel development. It is a Phase A record, not a
> deletion list. Do not act on this file.** A batch of agents is working in sibling worktrees of
> this same repository right now; branches and PRs referenced below can move within minutes.
> **Phase B (blocked on #578) must re-collect every fact in this document from scratch** --
> `git ls-remote`, merge status, and `gh pr list` -- rather than trust any SHA, merge state, or PR
> number written here. This is not a hypothetical caution: this document's first version (generated
> 2026-09-02T00:18:26Z) classified `task/issue-588-mark-done` as `must_be_preserved` because its
> PR-list query found no PR referencing it -- but PR #591 had in fact already been opened against it
> five minutes earlier (00:13:30Z). The query was stale before this document was even generated, not
> the branch state changing after the fact. See "Revision history" below for exactly what changed and
> why.

Generated: 2026-09-02T00:29:41Z (corrected; see Revision history)
Repository SHA at snapshot: `dev` was at `499bb11b004024fc46b9e97300ad8909d86a5073`
Repository: `MongLong0214/agent-operator-score`
Machine-readable source of truth: [`fixtures/stale-branches/audit.json`](../fixtures/stale-branches/audit.json)
(checked by [`tests/product/stale-branch-audit.test.mjs`](../tests/product/stale-branch-audit.test.mjs))

**This is Phase A of #572 only.** Phase A is read-only: inventory, classify, and record what would
be lost. No branch was deleted, renamed, or force-pushed, and no branch was created or deleted for
audit purposes, to produce this document. (The one branch that *was* created and pushed to origin
while this document was being written is this agent's own required task branch,
`task/issue-572-work` -- the normal, unavoidable artifact of submitting this document via PR #592,
not an action the audit process took. It is recorded in the tables below like any other branch.) The
destructive phase (Phase B / "final-deletion") is explicitly out of scope here and remains blocked
on **#578** -- final release/E2E evidence must be preserved before anything is deleted. Nothing in
this document authorizes deletion; it only records what a future, separate deletion step should do
and why.

## Revision history

| generated at | what changed |
|---|---|
| 2026-09-02T00:18:26Z | Initial version. `task/issue-588-mark-done` classified `must_be_preserved` under the per-branch table because no PR referenced it at that time. |
| 2026-09-02T00:29:41Z | Coordinator correction. PR #591 (opened 00:13:30Z, five minutes before the first snapshot's stated generation time of 00:18:26Z) was already open against `task/issue-588-mark-done` when the first snapshot was generated; that snapshot's PR-list query had gone stale before the document was produced and missed it. Further review-round commits are reported to have landed on the branch locally since. Re-collected live state: moved `task/issue-588-mark-done` into the open-PR-heads table (alongside `#570`), refreshed `task/issue-570-action-pins`'s SHA (one PR-review round further than the first snapshot), and added this agent's own now-pushed branch (`task/issue-572-work`, PR #592) to the same table. Recorded the `dev` SHA at snapshot time and this history. Also recorded, rather than assumed, a discrepancy with the coordinator's report of seven other new branches -- see "Branches reported but not found on origin" below. |

## Method

Every fact below came from a read command against `MongLong0214/agent-operator-score`:

- `git ls-remote --heads origin` -- the full current list of remote branches.
- `gh api repos/MongLong0214/agent-operator-score/branches --paginate` -- the same list independently,
  via the REST API rather than the git protocol, used as a cross-check.
- `git merge-base --is-ancestor <branch> origin/dev` / `origin/main`, and `git rev-list
  origin/dev..<branch>` / `origin/main..<branch>` -- merge status and unique-commit counts.
- `git log`, `git branch -r --contains`, `git tag --contains` -- authorship, dates, and whether a
  commit exists on any other ref.
- `gh pr list --repo MongLong0214/agent-operator-score --state all --limit 500 --json ...` (355+ PRs
  fetched in full, not the default 200) -- whether any PR, open or closed, ever used a branch as its
  head, or mentioned its name in a PR body.
- `gh pr view <number>` -- current state and head SHA of specific PRs.
- `gh api search/issues -f q='repo:... "<branch name>"'` -- whether any issue anywhere on the
  repository mentions a branch by name.
- `gh api repos/MongLong0214/agent-operator-score/branches/<branch>/protection` and
  `.../rulesets` -- branch protection and ruleset status.

## Snapshot

`git ls-remote --heads origin` (cross-checked against `gh api .../branches --paginate`, independently,
same result) reported 7 heads at correction time:

| branch | head SHA |
|---|---|
| `dev` | `499bb11b004024fc46b9e97300ad8909d86a5073` |
| `fix/a-fixture-backed-agent-is-not-a-runtime` | `e75d23258fb904c12cc6b8373a2ecd7d9d2b90e1` |
| `main` | `d2c68036ebf9f9fd7287258fd3cec252133ef846` |
| `task/issue-570-action-pins` | `34ad44ccedb8d13a698ab3aa8b82237aec908f5b` |
| `task/issue-572-work` | `1afd3524f3fb4a4b5e884bd0d30b0ee3216a2d71` |
| `task/issue-588-mark-done` | `034fcac5fcbd50e64ceb7cf8e8a7d21e57e7f08a` |
| `tmp/read-claude-artifact` | `2d6392f578dd2667d5f1f6ba5073a2c4311430eb` |

`main` and `dev` are excluded from the table below by definition.

## Branches reported but not found on origin

The coordinator separately reported eight new branches in flight: `task/issue-553-work`,
`task/issue-554-work`, `task/issue-555-work`, `task/issue-556-work`, `task/issue-565-work`,
`task/issue-567-work`, `task/issue-572-work`, and `task/issue-582-work`.

This agent's own `task/issue-572-work` is accounted for above -- it is now on origin, as this PR's
head. The other seven were checked twice, independently, at the corrected snapshot time:
`git ls-remote --heads origin` and `gh api repos/MongLong0214/agent-operator-score/branches
--paginate` (which bypasses the git protocol entirely). **Both returned the same 7 heads listed
above.** Neither method found `task/issue-553-work`, `task/issue-554-work`, `task/issue-555-work`,
`task/issue-556-work`, `task/issue-565-work`, `task/issue-567-work`, or `task/issue-582-work` on
origin.

`git worktree list` / `git branch -vv` on the shared local checkout at
`/Users/isaac/projects/agent-operator-score` does show local branches with exactly those seven
names, each still sitting at `dev`'s current tip (`499bb11b`, unchanged), in worktrees at
`/private/tmp/wt-553`, `wt-554`, `wt-555`, `wt-556`, `wt-565`, `wt-567`, and `wt-582`. Read plainly:
they exist as prepared local worktree branches that have not yet been pushed to origin, so they are
not yet remote branches for a *remote*-branch audit to cover.

This is written down as a discrepancy rather than resolved by assumption, because treating an
unverified claim as settled fact is exactly the failure `task/issue-588-mark-done`'s own unmerged
commit (`034fcac`, "harden the execution-plan checks against a forged pass") exists to close in the
execution-plan governance gate -- it would have been a strange thing to do in the same document that
cites that fix approvingly. If any of these seven have been pushed by the time this file is read,
this document is stale for that branch and needs a fresh regeneration, which is exactly what the
warning at the top says to do before Phase B acts on anything here.

## Drift observed while finalizing this very correction

While finalizing the correction above, a follow-up `git fetch`/`git ls-remote` (at
2026-09-02T00:37:14Z) already showed 3 of the 7 branches listed in "Branches reported but not found
on origin" now pushed to origin: `task/issue-553-work` (`ddcf43e`), `task/issue-556-work`
(`f2048b0`), and `task/issue-565-work` (`55f651f`). `task/issue-588-mark-done`'s head had also
advanced again, to `2c445d9` -- matching neither this document's recorded `034fcac` nor the
`88523a4` cited earlier in this same correction.

None of this has been folded into the tables in this document. Doing so would only produce another
already-stale snapshot: a full audit pass per branch (merge status against `dev` and `main`, a PR
reference check across the growing PR list, a protection check) cannot complete faster than this
batch is pushing new branches. This is recorded once, here, as concrete and timestamped proof of
the claim at the top of this document, not as an update to act on.

## Open PR heads (excluded from the stale-branch table, recorded here instead)

Per the issue's own scope ("every remote branch ... that is not main, dev, or an open PR's head"),
these three branches are active in-flight work, not stale refs, so they are recorded separately.
None may be deleted while their PR is open -- ISSUE.md's prohibited-actions list forbids deleting an
open PR's head branch outright.

| branch | PR | title | notes |
|---|---|---|---|
| `task/issue-570-action-pins` | [#590](https://github.com/MongLong0214/agent-operator-score/pull/590) | feat(ci): pin every external action to a commit, and check that it stays pinned | Active review; head advanced from `7d2d1be` to `34ad44c` ("fix(ci): close the scanner bypasses the review found") between this document's two snapshots. |
| `task/issue-572-work` | [#592](https://github.com/MongLong0214/agent-operator-score/pull/592) | docs(governance): read-only audit of stale remote branches (#572 Phase A) | This is the branch this document is written from. Recorded here purely so branch coverage stays exact; it cannot meaningfully audit itself. |
| `task/issue-588-mark-done` | [#591](https://github.com/MongLong0214/agent-operator-score/pull/591) | fix(governance): bind the close-evidence confirmation to one piece of work | See "Known limitation" immediately below -- this entry's exact current head SHA is not independently confirmed by this document's own read-only commands as of the corrected snapshot. |

### Known limitation: `task/issue-588-mark-done`'s current head SHA

At the corrected snapshot time, `git ls-remote origin refs/heads/task/issue-588-mark-done` and
`gh pr view 591 --json headRefOid` both reported `034fcac5fcbd50e64ceb7cf8e8a7d21e57e7f08a` -- the
same SHA this document's first version recorded, before PR #591 existed. The coordinator has stated
that at least one further review-round commit (`88523a4`) has since landed on this branch. This
document's own read-only remote commands, run at the times stated, did not observe `88523a4` on
`origin` -- only in the shared local checkout's copy of the `task/issue-588-mark-done` branch
(`git worktree list` shows a worktree at that SHA), which is one commit ahead of what has been
pushed. This is recorded rather than silently adopted, for the same reason the previous section is:
this document verifies against the remote it is auditing, not against unpushed local state, and a
reader relying on it should re-run `git ls-remote origin refs/heads/task/issue-588-mark-done`
before trusting either SHA. Regardless of which SHA is current, the classification is unchanged:
**this branch must be preserved.** It is the head of an open PR with active review; that alone rules
out deletion, independent of exactly how many commits are on it right now.

## Per-branch audit (stale-branch table)

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

## Why `task/issue-588-mark-done` is no longer in the stale-branch table

The first version of this document audited `task/issue-588-mark-done` here, with `must_be_preserved`,
because its PR-list query (355 PRs checked) found nothing referencing it and it existed on no other
ref -- it was carrying two real, unmerged commits hardening the #588 execution-plan governance gate
with nobody watching it, so far as that query could tell. That finding was correct given what the
query saw, and the underlying facts about the commits themselves have not changed. What changed is
that the correction found PR #591, which had in fact already been opened against the branch five
minutes before the first snapshot was generated (00:13:30Z vs. 00:18:26Z) -- the first snapshot's own
query was stale, not the branch. Once found, this moves the branch from "orphaned unmerged work" to
"active work under review" -- a stronger, not weaker, reason to preserve it. It now lives in the
open-PR-heads table above instead of here, per the issue's own scoping rule.

## Repository-level facts

- `main` and `dev` are both branch-protected: `allow_deletions: false`, `allow_force_pushes: false`,
  `enforce_admins: true`. No repository rulesets are configured (`gh api .../rulesets` returns `[]`).
- The repository has `delete_branch_on_merge: true` -- normal feature/task branches are already
  removed automatically on merge, consistent with the general policy this issue documents
  (feature/task/fix branches deleted after merge; `tmp/*` capped at 7 days or task end;
  release/hotfix branches deleted after release + back-merge).
- None of the 5 branches on origin other than `main`/`dev` (7 heads total minus `main` and `dev`) have
  any branch protection of their own.

## Why the JSON lives at `fixtures/stale-branches/audit.json`, not under `governance/`

`AGENT_RULES.md` lists `governance/**` as coordinator-owned hot-file surface. The machine-readable
audit was placed at `fixtures/stale-branches/audit.json` instead so this issue does not touch that
surface. **The coordinator may want to move this file under `governance/` (or elsewhere) as part of
its own integration; nothing here depends on the exact path, only on the schema (`aos-stale-branch-audit.v1`).**

## What Phase B (blocked on #578) must still do

Per the issue's own two-phase execution section, Phase B (after #578 PASS) is:

1. **Re-collect everything in this document from scratch** -- `git ls-remote`, `gh pr list`, merge
   status against the then-current `dev`/`main`. This document is a snapshot from an actively
   developed batch and has already needed one correction before merge; treat every fact here as a
   starting point for re-verification, not as ground truth.
2. Confirm the final evidence bundle preserves what needs preserving (in particular, resolve
   `task/issue-588-mark-done` and any other branch this document could not classify as fully
   inactive -- do not delete anything still under an open PR).
3. Delete only the branches a fresh audit marks `safe_to_delete_after_578` --
   (`fix/a-fixture-backed-agent-is-not-a-runtime`, `tmp/read-claude-artifact` as of this snapshot,
   pending re-verification).
4. Re-read post-delete state and confirm the invariants the issue lists: `main`/`dev`/tag SHAs
   unchanged, open PR heads untouched, branch protection unchanged.

None of that was performed here. No `git push --delete`, `git branch -D` on a branch this agent did
not create, or `gh api -X DELETE` was run at any point during this work.
