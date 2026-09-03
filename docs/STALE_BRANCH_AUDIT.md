# Stale remote branch audit (#572, Phase A -- read-only)

> **This is a snapshot, not a deletion list. Do not act on this file.** Phase B (blocked on #578
> and #588) must collect a fresh observation with `scripts/collect-branch-state.mjs` and authorize
> every deletion against that, not against this document --
> `deletionAuthorizationFindings` refuses outright when no observation is supplied. Snapshots go
> stale faster than they can be written: while this one was being collected, PR #611 merged and
> `task/issue-560-operator-events` stopped existing, 121 seconds before the observation was taken.

- **Generated:** 2026-09-03T00:37:58Z
- **Repository:** `MongLong0214/agent-operator-score`
- **Live observation digest:** `sha256:27c4f210eb41eaf2aed2fb36d3078e0850c4891027a4022f56edbe7c48fdd04f`
- **`dev` at snapshot:** `38c32f751f7e242ec20e891e9e6478ffc66145de`
- **`main` at snapshot:** `d2c68036ebf9f9fd7287258fd3cec252133ef846`
- **Machine-readable source of truth:** [`fixtures/stale-branches/audit.json`](../fixtures/stale-branches/audit.json)
- **Checked by:** `npm run verify:branch-audit`, `npm run verify:branch-cleanup-invariants`, `npm run verify:no-open-pr-head-deletion`

This document is rendered from the fixture. Where the two disagree the fixture wins, and
`tests/product/stale-branch-audit.test.mjs` parses the summary table below and fails when it does
not hold exactly one row per audited branch, at the recorded SHA.

## Where these facts came from

Everything external in this audit was collected by `scripts/collect-branch-state.mjs`, which runs
each read-only command and records the command line, exit code, byte count and a SHA-256 of its raw
output beside the answer. The head list was taken over two independent transports --
`git ls-remote --heads origin` and the REST branch list -- and cross-checked; one transport read
twice would prove nothing.

The point of collecting them there rather than here is narrow and worth stating. The deletion gate
in `scripts/branch-audit.mjs` authorizes a deletion only against a freshly collected observation,
never against this document's copy of these facts. Otherwise the party proposing the deletion would
supply both the evidence and the verdict.

What the receipts cannot do is prove the observation came from GitHub rather than from a text
editor: an offline checker has no way to authenticate a transcript. They exist so a human or a CI
job with credentials can re-run each command and compare digests. That is the honest boundary, and
it is stated rather than hidden.

| command | exit | bytes | digest |
|---|---|---|---|
| `git ls-remote --heads origin` | 0 | 534 | `sha256:d6285487507ae4c8858ebfda66c89e3b075501e506cd44fdcc3d53b7c240a692` |
| `gh api repos/MongLong0214/agent-operator-score/branches?per_page=100 --jq [.[]|{name:.name,sha:.commit.sha,protected:.protected}]` | 0 | 716 | `sha256:1b2d8743729a4f5e082400e3e43dc8dc6a6007839aec29c0741bc22e977546e1` |
| `gh api repos/MongLong0214/agent-operator-score/pulls?state=open&per_page=100 --jq [.[]|{number:.number,head_branch:.head.ref,head_sha:.head.sha,base:.base.ref,state:"OPEN"}]` | 0 | 433 | `sha256:b6c18d80a8ea1eab52d8d64be2d1e77623531801d9667c080c3980ec036b4838` |
| `git ls-remote --tags origin` | 0 | 2323 | `sha256:e4110333eb2096c906041412784a350fe30b478de0af6caf9f24d61a5b2012db` |
| `gh api repos/MongLong0214/agent-operator-score/branches/main/protection` | 0 | 1845 | `sha256:a61f822cb0c04a82978c62885dcf4f79608597db586540bd95de31ed00573aba` |
| `gh api repos/MongLong0214/agent-operator-score/branches/dev/protection` | 0 | 1839 | `sha256:23df58f6a5b41ffe54474d6561826e50b771c36dca772c62c4031869f67648a0` |
| `gh api repos/MongLong0214/agent-operator-score/rulesets` | 0 | 2 | `sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` |
| `gh api repos/MongLong0214/agent-operator-score --jq {default_branch:.default_branch,delete_branch_on_merge:.delete_branch_on_merge}` | 0 | 55 | `sha256:04b3744dbdb6b9e806fd4889e9265d060b44b5aea20f8fd84fec0c0525076020` |
| `gh api search/issues?q=repo%3AMongLong0214%2Fagent-operator-score%20%22fix%2Fa-fixture-backed-agent-is-not-a-runtime%22&per_page=100 --jq [.items[]|{number:.number,is_pull_request:(.pull_request!=null),state:.state,title:.title}]` | 0 | 463 | `sha256:8c6b86bd27b63da3e081c83356983305a1e45460a353af0561e33c4cc95a945a` |
| `gh api search/issues?q=repo%3AMongLong0214%2Fagent-operator-score%20%22task%2Fissue-556-strict-confinement%22&per_page=100 --jq [.items[]|{number:.number,is_pull_request:(.pull_request!=null),state:.state,title:.title}]` | 0 | 169 | `sha256:a08a5fcc7a9c1e701a7cff43cea17923420dd7992336b32c0d0bd06ee7ed8660` |
| `gh api search/issues?q=repo%3AMongLong0214%2Fagent-operator-score%20%22task%2Fissue-561-model-identity%22&per_page=100 --jq [.items[]|{number:.number,is_pull_request:(.pull_request!=null),state:.state,title:.title}]` | 0 | 169 | `sha256:a08a5fcc7a9c1e701a7cff43cea17923420dd7992336b32c0d0bd06ee7ed8660` |
| `gh api search/issues?q=repo%3AMongLong0214%2Fagent-operator-score%20%22task%2Fissue-572-branch-audit%22&per_page=100 --jq [.items[]|{number:.number,is_pull_request:(.pull_request!=null),state:.state,title:.title}]` | 0 | 3 | `sha256:37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570` |
| `gh api search/issues?q=repo%3AMongLong0214%2Fagent-operator-score%20%22tmp%2Fread-claude-artifact%22&per_page=100 --jq [.items[]|{number:.number,is_pull_request:(.pull_request!=null),state:.state,title:.title}]` | 0 | 463 | `sha256:8c6b86bd27b63da3e081c83356983305a1e45460a353af0561e33c4cc95a945a` |

## Phase A is read-only, and Phase B has not run

Phase A is inventory, classification and a preservation plan. Nothing here authorizes deletion. No
ref was deleted, renamed or force-pushed to produce this document, and none was created or deleted
for audit purposes. The one branch this work adds to `origin` is the branch it is submitted from
(`task/issue-572-branch-audit`) -- the ordinary artifact of opening a pull request, recorded in the
fixture under `heads_created_after_this_snapshot` because its SHA is the SHA of the commit carrying
this file.

**No deletion log is emitted by this PR.** The canonical execution plan reserves the
`branch-deletion-log` output for the blocked `final-deletion` phase; shipping it here would be
doing Phase B's work in Phase A. What this audit records instead is the contract that artifact has
to satisfy -- see "What Phase B must do" below. Phase B is blocked on **#578** (final release/E2E
evidence preserved) and **#588** (the close-evidence confirmation bound to that work), and whether
those cleared is decided by `fixtures/execution-plan/github-state.json`, not by anything the
deletion log says about itself.

## Snapshot

Both transports returned the same 7 heads (the 6 below plus this PR's own branch).

| branch | head SHA | classification | in dev / main | commits reaching neither | release tags | open PR | recommendation |
|---|---|---|---|---|---|---|---|
| `fix/a-fixture-backed-agent-is-not-a-runtime` | `e75d23258fb904c12cc6b8373a2ecd7d9d2b90e1` | MERGED | yes / yes | 0 | v0.1.11, v0.1.12, v0.1.13, v0.1.14, v0.1.15, v0.1.16, v0.1.17 | none | **safe_to_delete_after_578** |
| `task/issue-556-strict-confinement` | `b731f527c487a49a1585d8420a196dec8c1327ec` | ACTIVE | no / no | 43 | none | [#609](https://github.com/MongLong0214/agent-operator-score/pull/609) | **must_be_preserved** |
| `task/issue-561-model-identity` | `78ed2b4c0a4ee882ef48d98d274103c98d3ce920` | ACTIVE | no / no | 21 | none | [#607](https://github.com/MongLong0214/agent-operator-score/pull/607) | **must_be_preserved** |
| `tmp/read-claude-artifact` | `2d6392f578dd2667d5f1f6ba5073a2c4311430eb` | MERGED | yes / yes | 0 | v0.1.16, v0.1.17 | none | **safe_to_delete_after_578** |

`main` (`d2c68036ebf9f9fd7287258fd3cec252133ef846`) and `dev` (`38c32f751f7e242ec20e891e9e6478ffc66145de`) are excluded
by definition and are listed in the fixture's snapshot so a reader can see they were excluded rather
than missed.

## What happened to the branches earlier snapshots recorded

None was deleted by this audit; each was merged and removed by the repository's
`delete_branch_on_merge` setting.

| branch | SHA the earlier snapshot recorded | PR that consumed it | merge commit | note |
|---|---|---|---|---|
| `task/issue-570-action-pins` | `34ad44ccedb8d13a698ab3aa8b82237aec908f5b` | [#590](https://github.com/MongLong0214/agent-operator-score/pull/590) MERGED 2026-09-02T07:10:00Z | `8e87da05e2233d00a5a65ba008a00dfafc2d1d97` | Merged into dev and removed by the repository's delete_branch_on_merge setting, not by this audit. Its content is on dev. |
| `task/issue-572-work` | `1afd3524f3fb4a4b5e884bd0d30b0ee3216a2d71` | [#592](https://github.com/MongLong0214/agent-operator-score/pull/592) MERGED 2026-09-02T02:47:36Z | `ea1fe9ec6e7efe360da5ab7ceaa316a7cbfa65d9` | The first version of this audit. Merged into dev and auto-deleted; its content remains readable at that merge commit. |
| `task/issue-588-mark-done` | `034fcac5fcbd50e64ceb7cf8e8a7d21e57e7f08a` | [#591](https://github.com/MongLong0214/agent-operator-score/pull/591) MERGED 2026-09-02T05:10:28Z | `50c4ddb9643ec170e469f26f47f99a7df4a24802` | The branch the first snapshot could not classify. Merged into dev and auto-deleted; the work it worried about losing is on dev. |
| `task/issue-560-operator-events` | `5a697b290f2b6c320c79852f9be8e892b5fe28a5` | [#611](https://github.com/MongLong0214/agent-operator-score/pull/611) MERGED 2026-09-03T00:35:57Z | `38c32f751f7e242ec20e891e9e6478ffc66145de` | Audited as ACTIVE in the v2 snapshot and gone from this one: PR #611 merged 121 seconds before this observation was collected, and delete_branch_on_merge removed the branch. Recorded rather than quietly dropped, because a branch that disappears between two snapshots is precisely the state a stored audit cannot see and a fresh observation can. |

This is why the warning at the top is not boilerplate. Four heads have turned over across three
snapshots of this same file, one of them while this snapshot was being taken.

## Per-branch audit

### `fix/a-fixture-backed-agent-is-not-a-runtime`

| field | value |
|---|---|
| current SHA | `e75d23258fb904c12cc6b8373a2ecd7d9d2b90e1` |
| last update | 2026-08-28T20:37:31+09:00 (5 days before this snapshot) |
| owner (last committer) | MongLong0214 <97578200+MongLong0214@users.noreply.github.com> |
| classification | **MERGED** |
| open/closed/merged PR | no PR has ever used this branch as a head, open, closed or merged |
| unique commits vs `dev` | 0 (behind by 275) |
| unique commits vs `main` | 0 (behind by 85) |
| **commits reaching neither line** | **0** |
| contained in `dev` / `main` | yes / yes |
| release-tag containment | v0.1.11, v0.1.12, v0.1.13, v0.1.14, v0.1.15, v0.1.16, v0.1.17 |
| superseding PR/issue/SHA | none recorded -- nothing replaced this branch's work |
| to preserve | nothing -- no object on this ref is absent from `dev` and `main` |
| protection / ruleset | no branch protection, and the repository has no rulesets configured |
| **recommendation** | **safe_to_delete_after_578** |

| reference scan | source | found |
|---|---|---|
| GitHub-wide issues | `repo:MongLong0214/agent-operator-score "fix/a-fixture-backed-agent-is-not-a-runtime"` | [#572](https://github.com/MongLong0214/agent-operator-score/issues/572) (open) |
| GitHub-wide pull requests | `repo:MongLong0214/agent-operator-score "fix/a-fixture-backed-agent-is-not-a-runtime"` | [#612](https://github.com/MongLong0214/agent-operator-score/issues/612) (open), [#592](https://github.com/MongLong0214/agent-operator-score/issues/592) (closed) |
| repository tree | `git grep -n --fixed-strings fix/a-fixture-backed-agent-is-not-a-runtime HEAD -- ':!docs/STALE_BRANCH_AUDIT.md' ':!fixtures/stale-branches/'` (digest `sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`) | none found |

The tip commit e75d232 is an ancestor of both origin/dev and origin/main; git rev-list returns 0 commits unique to the branch against either, and git tag --contains places the commit in v0.1.11 through v0.1.17. The branch never carried a commit of its own -- it points at the merge commit of PR #511 (the chore/back-merge-0.1.10 chain) and never advanced from it. The receipted GitHub-wide search and tree scan find no reference to it outside this audit, issue #572's own candidate list, and the previous audit's PR. Deleting it, once #578 and #588 have cleared and a fresh live observation still shows it at this commit with no PR open, removes a name and no content.

**Could not establish: why this branch was created, and what change its name ('a fixture-backed agent is not a runtime') was meant to carry**

- Searched: The receipted sweep in live_observation.reference_sweep (GitHub-wide issue and PR search) plus a receipted `git grep` over the whole tree and `git log --all --grep` over the full history. Every hit is this audit's own PR (#612), issue #572's candidate list, or the previous audit PR (#592). The branch itself carries no commit of its own.
- Bearing on deletion: `none`
- Why it does not bear: Intent is a question about the past; data loss is a question about the present, and the present is fully established here. The tip is an ancestor of both origin/dev and origin/main, `git rev-list origin/dev..` and `git rev-list origin/main..` both return 0, and the commit is contained in seven release tags. There is no object on this ref that deleting the ref would remove from the repository, whatever it was created for.

### `task/issue-556-strict-confinement`

| field | value |
|---|---|
| current SHA | `b731f527c487a49a1585d8420a196dec8c1327ec` |
| last update | 2026-09-03T08:53:39+09:00 (0 days before this snapshot) |
| owner (last committer) | MongLong0214 <weplay0628@gmail.com> |
| classification | **ACTIVE** |
| open/closed/merged PR | open PR [#609](https://github.com/MongLong0214/agent-operator-score/pull/609) -> `dev`, head `b731f527c487a49a1585d8420a196dec8c1327ec` |
| unique commits vs `dev` | 43 (behind by 19) |
| unique commits vs `main` | 214 (behind by 0) |
| **commits reaching neither line** | **43** |
| contained in `dev` / `main` | no / no |
| release-tag containment | in no release tag |
| superseding PR/issue/SHA | none recorded -- nothing replaced this branch's work |
| to preserve | 43 commits implementing #556 STRICT workspace confinement and the official issuance gate, reachable from no other ref; confinement adapters and gate wiring across lib/core.mjs, lib/profile.mjs, lib/store.mjs, lib/result-schema.mjs, lib/scorer-v1.mjs, lib/redact.mjs, lib/ecd-contract.mjs, lib/session.mjs; tests/product/confinement.test.mjs, confinement-real-lane.test.mjs and official-issuance.test.mjs, plus the mutation ledger tests/mutation/measured.json; schemas/aos-result.v2.schema.json additions and the rendered confinement support matrix |
| protection / ruleset | no branch protection, and the repository has no rulesets configured |
| **recommendation** | **must_be_preserved** |

| reference scan | source | found |
|---|---|---|
| GitHub-wide issues | `repo:MongLong0214/agent-operator-score "task/issue-556-strict-confinement"` | none found |
| GitHub-wide pull requests | `repo:MongLong0214/agent-operator-score "task/issue-556-strict-confinement"` | [#612](https://github.com/MongLong0214/agent-operator-score/issues/612) (open) |
| repository tree | `git grep -n --fixed-strings task/issue-556-strict-confinement HEAD -- ':!docs/STALE_BRANCH_AUDIT.md' ':!fixtures/stale-branches/'` (digest `sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`) | none found |

Head of open PR #609 ('feat(confinement): STRICT workspace confinement and official issuance gate (#556)') targeting dev, under active review. It carries 43 commits that reach neither dev nor main and is in no release tag; the work exists on no other ref. Deleting the head branch of an open PR is on this issue's own prohibited-actions list, and the deletion gate re-checks the live PR state at the moment of deletion rather than trusting this record.

Nothing about this branch was left unestablished: its containment, PR state, tag membership, protection and references were all read directly, with receipts.

### `task/issue-561-model-identity`

| field | value |
|---|---|
| current SHA | `78ed2b4c0a4ee882ef48d98d274103c98d3ce920` |
| last update | 2026-09-03T09:31:56+09:00 (0 days before this snapshot) |
| owner (last committer) | MongLong0214 <weplay0628@gmail.com> |
| classification | **ACTIVE** |
| open/closed/merged PR | open PR [#607](https://github.com/MongLong0214/agent-operator-score/pull/607) -> `dev`, head `78ed2b4c0a4ee882ef48d98d274103c98d3ce920` |
| unique commits vs `dev` | 21 (behind by 16) |
| unique commits vs `main` | 195 (behind by 0) |
| **commits reaching neither line** | **21** |
| contained in `dev` / `main` | no / no |
| release-tag containment | in no release tag |
| superseding PR/issue/SHA | none recorded -- nothing replaced this branch's work |
| to preserve | 21 commits implementing #561 model and runtime identity binding, reachable from no other ref; lib/model-identity.mjs, the profile digest binding and the cycle comparability wiring; schemas/aos-model-provenance.v1.json, fixtures/model-identity/runtime-canary.json, scripts/capture-model-canary.mjs; tests/product/model-identity.test.mjs and model-canary.test.mjs |
| protection / ruleset | no branch protection, and the repository has no rulesets configured |
| **recommendation** | **must_be_preserved** |

| reference scan | source | found |
|---|---|---|
| GitHub-wide issues | `repo:MongLong0214/agent-operator-score "task/issue-561-model-identity"` | none found |
| GitHub-wide pull requests | `repo:MongLong0214/agent-operator-score "task/issue-561-model-identity"` | [#612](https://github.com/MongLong0214/agent-operator-score/issues/612) (open) |
| repository tree | `git grep -n --fixed-strings task/issue-561-model-identity HEAD -- ':!docs/STALE_BRANCH_AUDIT.md' ':!fixtures/stale-branches/'` (digest `sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`) | none found |

Head of open PR #607 ('feat(model-identity): bind exact model and runtime identity to the profile and cycle comparability (#561)') targeting dev, under active review. It carries 21 commits that reach neither dev nor main and is in no release tag; the work exists on no other ref. Deleting the head branch of an open PR is on this issue's own prohibited-actions list, and the deletion gate re-checks the live PR state at the moment of deletion rather than trusting this record.

Nothing about this branch was left unestablished: its containment, PR state, tag membership, protection and references were all read directly, with receipts.

### `tmp/read-claude-artifact`

| field | value |
|---|---|
| current SHA | `2d6392f578dd2667d5f1f6ba5073a2c4311430eb` |
| last update | 2026-08-29T11:33:54+09:00 (4 days before this snapshot) |
| owner (last committer) | MongLong0214 <97578200+MongLong0214@users.noreply.github.com> |
| classification | **MERGED** |
| open/closed/merged PR | no PR has ever used this branch as a head, open, closed or merged |
| unique commits vs `dev` | 0 (behind by 223) |
| unique commits vs `main` | 0 (behind by 33) |
| **commits reaching neither line** | **0** |
| contained in `dev` / `main` | yes / yes |
| release-tag containment | v0.1.16, v0.1.17 |
| superseding PR/issue/SHA | none recorded -- nothing replaced this branch's work |
| to preserve | nothing -- no object on this ref is absent from `dev` and `main` |
| protection / ruleset | no branch protection, and the repository has no rulesets configured |
| **recommendation** | **safe_to_delete_after_578** |

| reference scan | source | found |
|---|---|---|
| GitHub-wide issues | `repo:MongLong0214/agent-operator-score "tmp/read-claude-artifact"` | [#572](https://github.com/MongLong0214/agent-operator-score/issues/572) (open) |
| GitHub-wide pull requests | `repo:MongLong0214/agent-operator-score "tmp/read-claude-artifact"` | [#612](https://github.com/MongLong0214/agent-operator-score/issues/612) (open), [#592](https://github.com/MongLong0214/agent-operator-score/issues/592) (closed) |
| repository tree | `git grep -n --fixed-strings tmp/read-claude-artifact HEAD -- ':!docs/STALE_BRANCH_AUDIT.md' ':!fixtures/stale-branches/'` (digest `sha256:59f86f184d430e9e25aedaf52682bb9c82b57e06bf6b33784475b9b76f55f6d6`) | HEAD:tests/product/branch-cleanup-invariants.test.mjs |

The tip commit 2d6392f is fully contained in both origin/dev and origin/main (0 commits unique against either) and in release tags v0.1.16 and v0.1.17; it is the merge commit of PR #538, the chore/back-merge-0.1.15 chain, and the branch never advanced past it. It is a tmp/* branch, which repository policy caps at seven days or task end; it is past that. The receipted searches find no reference outside this audit, issue #572 and the previous audit's PR.

**Could not establish: what the branch was used to read, and whether anything was ever committed to it and later discarded**

- Searched: The receipted GitHub-wide sweep, a receipted `git grep` over the tree, and `git log --all --grep='claude artifact'` over the full history: nothing names it outside this audit, #572 and #592. A remote branch has no reflog readable from a clone, so a commit pushed and then force-replaced before this audit would leave no trace any command here can reach.
- Bearing on deletion: `none`
- Why it does not bear: The question is about objects that are not on the ref now. The ref as it stands is an ancestor of both origin/dev and origin/main with 0 unique commits against either, so deleting it removes no reachable object. An object already unreachable from this ref is not preserved by keeping the ref either, which is precisely why #572 routes evidence into committed fixtures and issue records rather than leaving it on a branch.

## Classification vocabulary, and what each state has to carry

Each state is a different claim with a different obligation. They are not interchangeable labels
over one predicate, and `scripts/branch-audit.mjs` enforces the differences.

| classification | what it claims | required record | may become deletable |
|---|---|---|---|
| `MERGED` | every commit is reachable from `dev` and `main` | zero commits reaching neither line; nothing named to preserve | yes |
| `SUPERSEDED` | the work was redone elsewhere, *not* merged verbatim | a superseding PR or issue, the SHA the replacement landed at, a note saying how it covers this branch, and one accounted-for commit id for every commit reaching neither line | yes |
| `UNIQUE_WORK` | commits or files exist on no other ref | what is unique, plus a plan: canonical issue, replacement branch base, `cherry-pick` or `reimplement`, and a required new PR with CI | no |
| `EVIDENCE_ONLY` | the branch is holding evidence | what evidence, plus a destination (issue, comment, doc, fixture or commit), its locator, and whether the migration has happened | no |
| `ACTIVE` | an open PR or an active owner | the open PR | no |
| `UNKNOWN_HOLD` | something bearing on the decision could not be established | at least one `unestablished` entry marked `blocks_deletion` | no |

`SUPERSEDED` is deliberately not a synonym for `MERGED`. Its premise is that the original commits
were reimplemented rather than merged, so demanding containment of it would delete the route the
issue describes. What replaces containment is the replacement record above.

A branch reaches deletion-eligibility only by satisfying all of these at once: a deletable
classification with its record complete; content demonstrably elsewhere; audited at the exact commit
the snapshot observed; no open PR; no protection; an empty `preserve` list; and nothing in
`unestablished` that bears on the decision. Any finding anywhere in the audit empties the whole
eligible set rather than only the entry that produced it.

And eligibility is still only necessary. The deletion itself additionally requires a live
observation showing the ref at that commit with no pull request open on it *now*.

## What could not be established

Both fully-merged branches carry a named unestablished fact, and both are argued rather than
dismissed. In each case the shape is the same: what could not be established is a question about the
past (why the branch was made, what was once on it), while the question deletion turns on is about
the present (is any reachable object here absent from `dev` and `main`) -- and the present is
established, at zero commits reaching neither line.

Neither branch is recommended for deletion *because* nothing could be found against it. Each is
recommended because `git merge-base --is-ancestor`, `git rev-list` and `git tag --contains`
positively establish that its content lives on both integration lines and in released tags. That is
the distinction this issue exists to hold: absence of evidence is not the evidence.

Two things remain unestablishable from inside the repository, and are recorded as such rather than
resolved:

- **The historical state at an earlier `generated_at`.** GitHub keeps no queryable history of
  branch refs, so no command can reconstruct what `git ls-remote` would have returned yesterday.
  Every fact here is bound to *this* collection instant; earlier snapshots are superseded, not
  re-verified.
- **A commit force-replaced on a remote branch before this audit.** A remote branch has no reflog
  readable from a clone. This is recorded on `tmp/read-claude-artifact`, the branch it could apply
  to, with the argument for why it does not bear on deletion.

## Pre-deletion invariant baseline

Recorded before anything is deleted, because an invariant nobody wrote down beforehand cannot be
checked afterwards. Protection and rulesets are stored as the complete objects the API returned, not
a projection: three booleans out of `main`'s 12 protection fields cannot report that a fourth
changed, and two rulesets of equal length are not the same two rulesets. The comparison is over
canonicalized content.

- `main`: `d2c68036ebf9f9fd7287258fd3cec252133ef846`
- `dev`: `38c32f751f7e242ec20e891e9e6478ffc66145de`
- protection: the complete objects for both refs (12 fields each), compared by content digest
- rulesets: 0 configured, compared by content rather than count
- `delete_branch_on_merge`: true, default branch `dev`

### The stable plugin/install source that must not change

| file | digest |
|---|---|
| `.claude-plugin/marketplace.json` | `sha256:fbe00f610b6acf50d03baf59d474ded48aaa0badb0f3f8d1546b71adb2539713` |
| `.claude-plugin/plugin.json` | `sha256:4e37598b3a12d1122b2dd2b8b091994faa04ca19c53e84108b98a6242e8fc64d` |

Plus the package identity (`agent-operator-score`, its `bin` map and its published `files` list), compared by content digest.

### Release tags that must not move

Two object ids per tag. `ref_sha` is what `refs/tags/<name>` points at -- for an annotated tag
that is the tag object itself, carrying the annotation and any signature. `commit_sha` is what it
peels to. Recording only the commit would let a tag be replaced by a *different* tag object over the
same commit, and nothing would notice.

| tag | ref object | commit |
|---|---|---|
| `archive/pre-v0.1.0-governance` | `332c6ab016a9a77a9c2625b03e5a6ecd2b6c817f` | `36b823f22217e9d8be011318e295231c62a3f813` |
| `v0.1.0` | `0c482e24d2ad2c35955ffd7dafe9e4b66980890a` | `fd972ad7c1ddc8b8e2546a78303ce2c3c7fe9aa3` |
| `v0.1.1` | `1ae539d02ed89134b496cb227a6a5b764172c442` | `efe351c991797a8cde88c23b8e8933d9a90db11d` |
| `v0.1.10` | `c6dca1ca26683cdd53e6eeedbf1f813da4444bbf` | `98353d24fdd6b932c717bd8b9a0971c22986f7b7` |
| `v0.1.11` | `f9dd920c091aca85765680dc5b346ef088ac4029` | `4566b33143155b91981d07308bd113ad8fad9b35` |
| `v0.1.12` | `19eebfea5a6b9eae1ad8da296fba156dbc6de904` | `c371ac93d49a592925b24de5013bc9b3b303dd7d` |
| `v0.1.13` | `d1a5602d049928de0bc356d1609f38665067ab3d` | `1d2ba6ba821dddd2eb7c567df1e9e3b5138ed5ea` |
| `v0.1.14` | `6ef289a2213d5f2110ed9809c9e1093013351898` | `d89a4b22a0e8de14fff316edcae18c3e6caadf9a` |
| `v0.1.15` | `32705b97f71367a4b2dceeb47990eed091210e57` | `426c23d0f62fa2666135f978db0f5802ace7c8cc` |
| `v0.1.16` | `ccdad531f3c02459a40306ec95e9a062cd215b12` | `120ce7c96feb961ee7c4599c2946f059b8d9b7c6` |
| `v0.1.17` | `4bdc072b9cb7f60d1b2ce87c575450100c6169ac` | `d2c68036ebf9f9fd7287258fd3cec252133ef846` |
| `v0.1.2` | `0cd9f8aba4f7ad9bb01144b15b6c78102e03b577` | `43bae4bf460939a743c837b8e0a05d8f9e044026` |
| `v0.1.3` | `8b33ae3cb13bb20ad0fa60e2b6e1fc5c51fad470` | `dc7f6563ec0d6e951fe984fa026eea8c5efc3aed` |
| `v0.1.4` | `1ec11902ae3edaaf63560c4e9b5804296b430de4` | `ae648b7dca5574c6af938dc44b6802f1bf732929` |
| `v0.1.5` | `268945956e99d24d9cf796eed2fb8dc62226042b` | `bbfae658e87ac2de7c6326739704a877fb118301` |
| `v0.1.6` | `425fa1a8b24a87e83c588fb805f5a9e529cb7676` | `aebcbd8b7105da88ae71d0e5a80be59b99e8cc53` |
| `v0.1.7` | `7349872a98c83e577d8193184aa6f16cb3a97011` | `8e84fbcb42f79d86263aab42a1291ecf09ddba7f` |
| `v0.1.8` | `64f3ad0ccf46008e40a2a446a8df2f8de43131b4` | `30d30485f4ade54238cba5aa1a8bc85452df7d39` |
| `v0.1.9` | `ac7fc44cafee09cc9765254ca6248efd1ddfc508` | `3493dfb9c5ee79d8a3201f8bcec2c697aa5e7ca0` |

### Open PR heads that must survive

| PR | head branch | head SHA | base |
|---|---|---|---|
| [#607](https://github.com/MongLong0214/agent-operator-score/pull/607) | `task/issue-561-model-identity` | `78ed2b4c0a4ee882ef48d98d274103c98d3ce920` | dev |
| [#609](https://github.com/MongLong0214/agent-operator-score/pull/609) | `task/issue-556-strict-confinement` | `b731f527c487a49a1585d8420a196dec8c1327ec` | dev |
| [#612](https://github.com/MongLong0214/agent-operator-score/pull/612) | `task/issue-572-branch-audit` | `1146e104978448e01b65ae0a274054bc4287b619` | dev |

## Repository branch policy

The branch policy this issue asks to be written down. Descriptive of the repository's current settings where a setting exists, prescriptive where none does.

- feature/, task/ and fix/ branches are deleted once their PR merges. delete_branch_on_merge is enabled, so this happens automatically; the two branches in this audit that were not removed are the two that never had a PR.
- tmp/* branches live at most seven days or until their task ends, whichever comes first. No setting enforces this; it is checked by re-running this audit.
- release/ and hotfix/ branches are deleted after the release ships and the back-merge into dev lands.
- main and dev are protected: no deletion, no force push, enforced for admins. No repository rulesets are configured.
- A branch is not an evidence archive. Anything worth keeping is moved into a commit, a committed fixture, a document or an issue record before the branch it lived on is deleted -- which is why this issue's Phase B is blocked on #578 and #588 rather than running now.

## What Phase B must do, once #578 and #588 have cleared

1. **Collect a fresh observation.** `node scripts/collect-branch-state.mjs <repo> observation.json`.
   This snapshot is a starting point for re-verification, never ground truth -- see the turnover
   table above.
2. **Re-audit against it.** Merge status against the then-current `dev` and `main`, tag
   containment, protection, the reference sweep. Confirm the evidence bundle preserves what the
   `preserve` column names for anything not `MERGED`.
3. **Delete only what the fresh audit finds eligible, at the exact commit it judged.** As of this
   snapshot that is
   `fix/a-fixture-backed-agent-is-not-a-runtime` (`e75d23258fb904c12cc6b8373a2ecd7d9d2b90e1`) and
   `tmp/read-claude-artifact` (`2d6392f578dd2667d5f1f6ba5073a2c4311430eb`), and nothing else. If a fresh audit finds nothing
   eligible -- which auto-delete makes ordinary -- that is a legitimate completion, not a failure.
4. **Write `fixtures/stale-branches/deletion-log.json`** in the shape
   `phase_b_contract.required_shape` records: `COMPLETED`, `completed_at`, each deleted branch
   with the commit the audit judged (or an empty list with a `no_op_reason`), `blockers_cleared`,
   the digest of the observation the deletion was authorized against, and `post_delete_state` read
   back live -- `main`, `dev`, the tags with both object ids, the complete protection objects, the
   rulesets, the install source and the open PR heads.
5. **Run the gate.** `deletionAuthorizationFindings({audit, log, live, completion})` must return no
   findings. It refuses without a live observation; it refuses a log whose cited observation digest
   does not match the one it was given; it refuses an observation collected after the deletion or
   more than 900s before it; it refuses a branch whose live head is not the commit
   being deleted; and it refuses any branch with a pull request open on it live, whatever this
   document says. Whether #578 and #588 cleared is read from
   `fixtures/execution-plan/github-state.json` -- the deletion log's own account of them is
   cross-checked against that, not believed.
