# Stale remote branch audit (#572, Phase A -- read-only)

> **This is a snapshot, not a deletion list. Do not act on this file.** Phase B (blocked on #578 and
> #588) collects its own observations -- one immediately before the deletion and one immediately
> after -- and decides against those. `liveEligibility` refuses outright without a freshly collected
> observation. The invariants are compared between the two fresh observations, never against
> this file: the repository goes on moving, and a Phase B measured against a Phase A snapshot would
> report ordinary progress as damage. Four heads have turned over across the versions of this
> document, one of them while a snapshot was being taken.

- **Generated:** 2026-09-03T08:18:25Z
- **Repository:** `MongLong0214/agent-operator-score`
- **Observation digest:** `sha256:1faf38ac1894e39c4d8a8c417e275f013d0baf848ff3e35c3a8829db3202fdf2` (recursive over the whole record)
- **`dev` at snapshot:** `93179cf53757e0755efc1936c7d96c0779feedf1`
- **`main` at snapshot:** `d2c68036ebf9f9fd7287258fd3cec252133ef846`
- **Machine-readable source of truth:** [`fixtures/stale-branches/audit.json`](../fixtures/stale-branches/audit.json)
- **Checked by:** `npm run verify:branch-audit`, `npm run verify:branch-cleanup-invariants`, `npm run verify:no-open-pr-head-deletion`

This document is rendered from the fixture. Where the two disagree the fixture wins, and
`tests/product/stale-branch-audit.test.mjs` parses the summary table below and fails when it does
not hold exactly one row per audited branch, at the recorded SHA.

## Where these facts came from

Every external fact was collected by `scripts/collect-branch-state.mjs`, which records the command
line, exit code, byte count and a SHA-256 of the raw stdout beside each answer. **129 receipts** in
total: 9 repository-wide, listed below, and 120 per-branch derivations.

That includes the graph facts, not only the queries around them. When a branch record below says it
is contained in `dev`, the `git merge-base --is-ancestor` that decides it is a receipt; so are the
`git rev-list --count` in each direction and for commits reaching neither line, the `git rev-list`
for the ids of those commits, the one `git merge-base --is-ancestor` per tag reported by
`git ls-remote --tags origin`, the `git grep` over the tree, and the all-state paginated
`gh api repos/<owner>/<repo>/pulls?state=all&head=<owner>:<branch>` behind
"no pull request ever used this branch as a head". A receipt for a neighbouring query is not
evidence for a derivation nobody ran, and `derivationFindings` fails when a record asserts a number
the collector did not produce.

Every list endpoint is paginated to the end, and each GitHub-wide search compares what it retrieved
against the count the API reported. That matters in one direction specifically: an unpaginated read
turns a pull request on the second page into an absent pull request, and the deletion gate reads
absence as "no PR open on this branch".

The head list is taken over two independent transports -- `git ls-remote --heads origin` and the
REST branch list -- and any disagreement between them is a finding. One transport read twice would
prove nothing.

| command | exit | bytes | digest |
|---|---|---|---|
| `git ls-remote --heads origin` | 0 | 448 | `sha256:44ea16f8fa6445709b91cbc9bfcac8aca5b0b0d9a9d4d27f9c3cc47979ec4e0e` |
| `gh api --paginate --slurp repos/MongLong0214/agent-operator-score/branches?per_page=100` | 0 | 3909 | `sha256:969de92eb78e2025c193b6ff41c5e849970a7d9c803bf45f8a62dfe2678778b0` |
| `gh api --paginate --slurp repos/MongLong0214/agent-operator-score/pulls?state=open&per_page=100` | 0 | 84093 | `sha256:c255c475163989d1f8e5c4836a74d896a965cc4b17b03062258b3ded6a188dbe` |
| `git ls-remote --tags origin` | 0 | 2323 | `sha256:e4110333eb2096c906041412784a350fe30b478de0af6caf9f24d61a5b2012db` |
| `gh api repos/MongLong0214/agent-operator-score/branches/main/protection` | 0 | 1845 | `sha256:a61f822cb0c04a82978c62885dcf4f79608597db586540bd95de31ed00573aba` |
| `gh api repos/MongLong0214/agent-operator-score/branches/dev/protection` | 0 | 1839 | `sha256:23df58f6a5b41ffe54474d6561826e50b771c36dca772c62c4031869f67648a0` |
| `gh api --paginate --slurp repos/MongLong0214/agent-operator-score/rulesets?per_page=100` | 0 | 4 | `sha256:cf1cbb66a638b4860a516671fb74850e6ccf787fe6c4c8d29e9c04efe880bd05` |
| `gh api repos/MongLong0214/agent-operator-score` | 0 | 6760 | `sha256:8d88253deecf6da07c5385b6bdedd6c3de75aafe75acc32f123dbc85a625d681` |
| `git fetch -q origin 93179cf53757e0755efc1936c7d96c0779feedf1 e75d23258fb904c12cc6b8373a2ecd7d9d2b90e1 d2c68036ebf9f9fd7287258fd3cec252133ef846 f81b17a378d9cbdef111e2cfbe76ccf4b88232ec cbf23fbff7313c587d8638e926ddc707ceee4545 2d6392f578dd2667d5f1f6ba5073a2c4311430eb 36b823f22217e9d8be011318e295231c62a3f813 fd972ad7c1ddc8b8e2546a78303ce2c3c7fe9aa3 efe351c991797a8cde88c23b8e8933d9a90db11d 98353d24fdd6b932c717bd8b9a0971c22986f7b7 4566b33143155b91981d07308bd113ad8fad9b35 c371ac93d49a592925b24de5013bc9b3b303dd7d 1d2ba6ba821dddd2eb7c567df1e9e3b5138ed5ea d89a4b22a0e8de14fff316edcae18c3e6caadf9a 426c23d0f62fa2666135f978db0f5802ace7c8cc 120ce7c96feb961ee7c4599c2946f059b8d9b7c6 43bae4bf460939a743c837b8e0a05d8f9e044026 dc7f6563ec0d6e951fe984fa026eea8c5efc3aed ae648b7dca5574c6af938dc44b6802f1bf732929 bbfae658e87ac2de7c6326739704a877fb118301 aebcbd8b7105da88ae71d0e5a80be59b99e8cc53 8e84fbcb42f79d86263aab42a1291ecf09ddba7f 30d30485f4ade54238cba5aa1a8bc85452df7d39 3493dfb9c5ee79d8a3201f8bcec2c697aa5e7ca0` | 0 | 0 | `sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

What the receipts cannot do is prove the observation came from GitHub rather than a text editor: an
offline checker has no way to authenticate a transcript. Two things narrow that. The digest is
recursive over the whole record, so no nested value can change under the same identity. And Phase B
rests on an observation collected immediately beforehand, never on this file. What is
left outside the boundary is the trustworthiness of the machine that runs it, which is stated here
rather than hidden.

## Phase A is read-only, and Phase B has not run

Phase A is inventory, classification and a preservation plan. Nothing here authorizes deletion. No
ref was deleted, renamed or force-pushed to produce this document, and none was created or deleted
for audit purposes. The one branch this work adds to `origin` is the branch it is submitted from
(`task/issue-572-branch-audit`), recorded under `heads_created_after_this_snapshot` because its SHA is the
SHA of the commit carrying this file. That exception is earned rather than declared, and it is for
that branch alone: coverage excuses an entry only when the audit names it as the branch it was
submitted from, the observation shows an open pull request with it as a head, the entry is classified
`ACTIVE`, the pull request number it claims is the one that is actually open, it records no head SHA
-- which the branch carrying this audit cannot have -- and it says why it sits outside the snapshot.
A name merely written into the list does not become accounted for.

**No deletion log is emitted by this PR.** The canonical execution plan reserves the
`branch-deletion-log` output for the blocked `final-deletion` phase. Whether that phase may start is
decided by `fixtures/execution-plan/github-state.json`, not by anything the deletion log says about
itself.

## Snapshot

| branch | head SHA | classification | in dev / main | commits reaching neither | release tags | open PR | recommendation |
|---|---|---|---|---|---|---|---|
| `fix/a-fixture-backed-agent-is-not-a-runtime` | `e75d23258fb904c12cc6b8373a2ecd7d9d2b90e1` | MERGED | yes / yes | 0 | v0.1.11, v0.1.12, v0.1.13, v0.1.14, v0.1.15, v0.1.16, v0.1.17 | none | **safe_to_delete_after_578** |
| `task/issue-558-routing-oracle` | `f81b17a378d9cbdef111e2cfbe76ccf4b88232ec` | ACTIVE | no / no | 18 | none | [#614](https://github.com/MongLong0214/agent-operator-score/pull/614) | **must_be_preserved** |
| `tmp/read-claude-artifact` | `2d6392f578dd2667d5f1f6ba5073a2c4311430eb` | MERGED | yes / yes | 0 | v0.1.16, v0.1.17 | none | **safe_to_delete_after_578** |

`main` (`d2c68036ebf9f9fd7287258fd3cec252133ef846`) and `dev` (`93179cf53757e0755efc1936c7d96c0779feedf1`) are excluded
by definition and are listed in the fixture's snapshot so a reader can see they were excluded rather
than missed.

## What happened to the branches earlier snapshots recorded

None was deleted by this audit; each was merged and removed by `delete_branch_on_merge`.

| branch | SHA the earlier snapshot recorded | PR that consumed it | merge commit | note |
|---|---|---|---|---|
| `task/issue-570-action-pins` | `34ad44ccedb8d13a698ab3aa8b82237aec908f5b` | [#590](https://github.com/MongLong0214/agent-operator-score/pull/590) 2026-09-02T07:10:00Z | `8e87da05e2233d00a5a65ba008a00dfafc2d1d97` | Merged into dev and removed by delete_branch_on_merge, not by this audit. |
| `task/issue-572-work` | `1afd3524f3fb4a4b5e884bd0d30b0ee3216a2d71` | [#592](https://github.com/MongLong0214/agent-operator-score/pull/592) 2026-09-02T02:47:36Z | `ea1fe9ec6e7efe360da5ab7ceaa316a7cbfa65d9` | The first version of this audit. |
| `task/issue-588-mark-done` | `034fcac5fcbd50e64ceb7cf8e8a7d21e57e7f08a` | [#591](https://github.com/MongLong0214/agent-operator-score/pull/591) 2026-09-02T05:10:28Z | `50c4ddb9643ec170e469f26f47f99a7df4a24802` | Merged into dev and auto-deleted. |
| `task/issue-560-operator-events` | `5a697b290f2b6c320c79852f9be8e892b5fe28a5` | [#611](https://github.com/MongLong0214/agent-operator-score/pull/611) 2026-09-03T00:35:57Z | `38c32f751f7e242ec20e891e9e6478ffc66145de` | Audited as ACTIVE two snapshots ago and gone from this one: PR #611 merged while the previous observation was being collected. |
| `task/issue-556-strict-confinement` | `c5706859457a9388b3e28c4685057d5edcd29302` | [#609](https://github.com/MongLong0214/agent-operator-score/pull/609) 2026-09-03T08:11:16Z | `93179cf53757e0755efc1936c7d96c0779feedf1` | Audited as ACTIVE in the previous snapshot and gone from this one: PR #609 merged and the head was auto-deleted. It advanced to `a00d0b588de0b37b5cb15d87c4782e2404d0baec` before merging, which is why the SHA recorded above is not the SHA that merged. |

## Per-branch audit

### `fix/a-fixture-backed-agent-is-not-a-runtime`

| field | value | derived by |
|---|---|---|
| current SHA | `e75d23258fb904c12cc6b8373a2ecd7d9d2b90e1` | `git ls-remote --heads origin`, cross-checked against the REST branch list |
| last update | 2026-08-28T20:37:31+09:00 (5 days before this snapshot) | `git-log-fix/a-fixture-backed-agent-is-not-a-runtime` |
| owner (last committer) | MongLong0214 <97578200+MongLong0214@users.noreply.github.com> | `git-log-fix/a-fixture-backed-agent-is-not-a-runtime` |
| classification | **MERGED** | — |
| PR history (all states) | no pull request has ever used this branch as a head | `pr-history-fix/a-fixture-backed-agent-is-not-a-runtime` |
| contained in `dev` / `main` | yes / yes | `is-ancestor-dev-fix/a-fixture-backed-agent-is-not-a-runtime`, `is-ancestor-main-fix/a-fixture-backed-agent-is-not-a-runtime` |
| unique commits vs `dev` / `main` | 0 / 0 | `rev-list-dev-fix/a-fixture-backed-agent-is-not-a-runtime`, `rev-list-main-fix/a-fixture-backed-agent-is-not-a-runtime` |
| **commits reaching neither line** | **0** | `rev-list-neither-fix/a-fixture-backed-agent-is-not-a-runtime` |
| release-tag containment | v0.1.11, v0.1.12, v0.1.13, v0.1.14, v0.1.15, v0.1.16, v0.1.17 | `tag-contains-archive/pre-v0.1.0-governance-fix/a-fixture-backed-agent-is-not-a-runtime` |
| superseding PR/issue/SHA | none recorded | — |
| to preserve | nothing -- no object on this ref is absent from `dev` and `main` | — |
| protection / ruleset | no branch protection, and the repository has no rulesets configured | `rest-branches` |
| **recommendation** | **safe_to_delete_after_578** | — |

| reference scan | result |
|---|---|
| GitHub-wide issues (`repo:MongLong0214/agent-operator-score "fix/a-fixture-backed-agent-is-not-a-runtime"`) | [#572](https://github.com/MongLong0214/agent-operator-score/issues/572) (open) |
| GitHub-wide pull requests | [#592](https://github.com/MongLong0214/agent-operator-score/issues/592) (closed) |
| sweep completeness | complete -- all 2 result(s) the API reported were retrieved |
| repository tree (`git-grep-fix/a-fixture-backed-agent-is-not-a-runtime`) | none found |

Receipted derivations: `git merge-base --is-ancestor` places the tip on both dev and main, `git rev-list --count` returns 0 commits reaching neither line, one `git merge-base --is-ancestor` per tag places it in seven release tags, and the all-state PR history is empty -- no pull request ever used it as a head. The branch never carried a commit of its own: it points at the merge commit of PR #511 and never advanced. The complete GitHub-wide sweep and the tree scan find no reference outside this audit, issue #572's candidate list and the previous audit's PR. Deleting it, once #578 and #588 have cleared and a fresh observation still shows it at this commit with no PR open, removes a name and no content.

**Could not establish: why this branch was created, and what change its name ('a fixture-backed agent is not a runtime') was meant to carry**

- Searched: The receipted GitHub-wide sweep in live_observation.reference_sweep (complete: every result the API reported was retrieved) and a receipted `git grep` over the whole tree. Every hit is this audit's own PR, issue #572's candidate list, or the previous audit PR. The receipted all-state PR history for this branch is empty: no pull request has ever used it as a head.
- Bearing on deletion: `none`
- Why it does not bear: Intent is a question about the past; data loss is a question about the present, and the present is established by receipted commands. The tip is an ancestor of both dev and main by `git merge-base --is-ancestor`, `git rev-list --count <tip> --not <dev> <main>` returns 0, and the commit is contained in seven release tags. There is no object on this ref that deleting the ref would remove, whatever it was created for.

### `task/issue-558-routing-oracle`

| field | value | derived by |
|---|---|---|
| current SHA | `f81b17a378d9cbdef111e2cfbe76ccf4b88232ec` | `git ls-remote --heads origin`, cross-checked against the REST branch list |
| last update | 2026-09-03T14:40:26+09:00 (0 days before this snapshot) | `git-log-task/issue-558-routing-oracle` |
| owner (last committer) | MongLong0214 <weplay0628@gmail.com> | `git-log-task/issue-558-routing-oracle` |
| classification | **ACTIVE** | — |
| PR history (all states) | #614 OPEN | `pr-history-task/issue-558-routing-oracle` |
| contained in `dev` / `main` | no / no | `is-ancestor-dev-task/issue-558-routing-oracle`, `is-ancestor-main-task/issue-558-routing-oracle` |
| unique commits vs `dev` / `main` | 18 / 210 | `rev-list-dev-task/issue-558-routing-oracle`, `rev-list-main-task/issue-558-routing-oracle` |
| **commits reaching neither line** | **18** | `rev-list-neither-task/issue-558-routing-oracle` |
| release-tag containment | in no release tag | `tag-contains-archive/pre-v0.1.0-governance-task/issue-558-routing-oracle` |
| superseding PR/issue/SHA | none recorded | — |
| to preserve | 18 commits implementing #558 the #558 routing oracle, reachable from no other ref; its library, schema and fixture surface, reachable from no other ref; its product tests and mutation guards | — |
| protection / ruleset | no branch protection, and the repository has no rulesets configured | `rest-branches` |
| **recommendation** | **must_be_preserved** | — |

| reference scan | result |
|---|---|
| GitHub-wide issues (`repo:MongLong0214/agent-operator-score "task/issue-558-routing-oracle"`) | none found |
| GitHub-wide pull requests | none found |
| sweep completeness | complete -- all 0 result(s) the API reported were retrieved |
| repository tree (`git-grep-task/issue-558-routing-oracle`) | none found |

Head of open PR #614 targeting dev, under active review. Receipted derivations show 18 commits reaching neither dev nor main and no release tag containing it; the work exists on no other ref. Deleting the head branch of an open PR is on this issue's own prohibited-actions list, and the deletion gate re-checks the live PR state against a freshly collected observation rather than trusting this record.

Nothing about this branch was left unestablished: containment, PR history, tag membership, protection and references were each derived by a receipted command.

### `tmp/read-claude-artifact`

| field | value | derived by |
|---|---|---|
| current SHA | `2d6392f578dd2667d5f1f6ba5073a2c4311430eb` | `git ls-remote --heads origin`, cross-checked against the REST branch list |
| last update | 2026-08-29T11:33:54+09:00 (5 days before this snapshot) | `git-log-tmp/read-claude-artifact` |
| owner (last committer) | MongLong0214 <97578200+MongLong0214@users.noreply.github.com> | `git-log-tmp/read-claude-artifact` |
| classification | **MERGED** | — |
| PR history (all states) | no pull request has ever used this branch as a head | `pr-history-tmp/read-claude-artifact` |
| contained in `dev` / `main` | yes / yes | `is-ancestor-dev-tmp/read-claude-artifact`, `is-ancestor-main-tmp/read-claude-artifact` |
| unique commits vs `dev` / `main` | 0 / 0 | `rev-list-dev-tmp/read-claude-artifact`, `rev-list-main-tmp/read-claude-artifact` |
| **commits reaching neither line** | **0** | `rev-list-neither-tmp/read-claude-artifact` |
| release-tag containment | v0.1.16, v0.1.17 | `tag-contains-archive/pre-v0.1.0-governance-tmp/read-claude-artifact` |
| superseding PR/issue/SHA | none recorded | — |
| to preserve | nothing -- no object on this ref is absent from `dev` and `main` | — |
| protection / ruleset | no branch protection, and the repository has no rulesets configured | `rest-branches` |
| **recommendation** | **safe_to_delete_after_578** | — |

| reference scan | result |
|---|---|
| GitHub-wide issues (`repo:MongLong0214/agent-operator-score "tmp/read-claude-artifact"`) | [#572](https://github.com/MongLong0214/agent-operator-score/issues/572) (open) |
| GitHub-wide pull requests | [#592](https://github.com/MongLong0214/agent-operator-score/issues/592) (closed) |
| sweep completeness | complete -- all 2 result(s) the API reported were retrieved |
| repository tree (`git-grep-tmp/read-claude-artifact`) | none found |

Receipted derivations place the tip on both dev and main with 0 commits reaching neither line, and in release tags v0.1.16 and v0.1.17. It is the merge commit of PR #538 and the branch never advanced past it. It is a tmp/* branch, which repository policy caps at seven days or task end; it is past that. The all-state PR history is empty and the complete reference sweep finds nothing outside this audit.

**Could not establish: what the branch was used to read, and whether anything was ever committed to it and later discarded**

- Searched: The receipted complete GitHub-wide sweep, a receipted `git grep` over the tree, and the receipted all-state PR history: nothing names it outside this audit, #572 and the previous audit's PR, and no pull request ever used it as a head. A remote branch has no reflog readable from a clone, so a commit pushed and force-replaced before this audit would leave no trace any command here can reach.
- Bearing on deletion: `none`
- Why it does not bear: The question is about objects that are not on the ref now. The ref as it stands is an ancestor of both dev and main with 0 commits reaching neither, so deleting it removes no reachable object. An object already unreachable from this ref is not preserved by keeping the ref either, which is why #572 routes evidence into committed fixtures and issue records rather than leaving it on a branch.

## Classification vocabulary, and what each state has to carry

| classification | what it claims | required record | may become deletable |
|---|---|---|---|
| `MERGED` | every commit is reachable from `dev` and `main` | zero commits reaching neither line; nothing named to preserve | yes |
| `SUPERSEDED` | the work was redone elsewhere, *not* merged verbatim | a superseding PR or issue, the SHA the replacement landed at, a note saying how it covers this branch, and one accounted-for commit id per commit reaching neither line | yes |
| `UNIQUE_WORK` | commits or files exist on no other ref | what is unique, plus a plan: canonical issue, replacement branch base, `cherry-pick` or `reimplement`, and a required new PR with CI | no |
| `EVIDENCE_ONLY` | the branch is holding evidence | what evidence, plus a destination (issue, comment, doc, fixture or commit), its locator, and whether the migration has happened | no |
| `ACTIVE` | an open PR or an active owner | the open PR | no |
| `UNKNOWN_HOLD` | something bearing on the decision could not be established | at least one `unestablished` entry marked `blocks_deletion` | no |

`SUPERSEDED` is deliberately not a synonym for `MERGED`: its premise is that the original commits
were reimplemented rather than merged, so demanding containment of it would delete the route the
issue describes.

A branch reaches deletion-eligibility only by satisfying all of these at once: a deletable
classification with its record complete; content demonstrably elsewhere; audited at the exact commit
the snapshot observed, with every asserted number matching a receipted derivation; no open PR; no
protection; an empty `preserve` list; and nothing in `unestablished` that bears on the decision. Any
finding anywhere empties the whole eligible set.

And eligibility is still only necessary. The deletion additionally requires a freshly collected
observation showing the ref at that commit with no pull request open on it now.

## What could not be established

Both fully-merged branches carry a named unestablished fact, argued rather than dismissed. In each
case the shape is the same: what could not be established is a question about the past, while the
question deletion turns on is about the present -- and the present is established by receipted
commands, at zero commits reaching neither line.

Neither branch is recommended for deletion *because* nothing could be found against it. Each is
recommended because `git merge-base --is-ancestor` -- against `dev`, against `main`, and once per
tag reported by `git ls-remote --tags origin` -- together with `git rev-list`
positively establish that its content lives on both integration lines and in released tags. Absence
of evidence is not the evidence.

Two things remain unestablishable from inside the repository:

- **The historical state at an earlier `generated_at`.** GitHub keeps no queryable history of branch
  refs. Every fact here is bound to this collection instant; earlier snapshots are superseded, not
  re-verified.
- **A commit force-replaced on a remote branch before this audit.** A remote branch has no reflog
  readable from a clone. Recorded on `tmp/read-claude-artifact`, the branch it could apply to.

## Historical baseline (context, not the deletion comparison)

Recorded so a later reader can see how far the repository has moved. What must not change *across a
deletion* is compared between the two observations that bracket it, not against this.

- `main`: `d2c68036ebf9f9fd7287258fd3cec252133ef846`, `dev`: `93179cf53757e0755efc1936c7d96c0779feedf1`
- protection: the complete objects for both refs (12 fields each)
- rulesets: 0 configured
- `delete_branch_on_merge`: true, default branch `dev`

### The stable plugin/install source

| file | digest |
|---|---|
| `.claude-plugin/marketplace.json` | `sha256:fbe00f610b6acf50d03baf59d474ded48aaa0badb0f3f8d1546b71adb2539713` |
| `.claude-plugin/plugin.json` | `sha256:4e37598b3a12d1122b2dd2b8b091994faa04ca19c53e84108b98a6242e8fc64d` |

Plus the package identity (`agent-operator-score`, its `bin` map and its published `files` list).

### Release tags

Two object ids per tag. `ref_sha` is what `refs/tags/<name>` points at -- for an annotated tag the
tag object itself, carrying the annotation and any signature. `commit_sha` is what it peels to.
Recording only the commit would let a tag be replaced by a *different* tag object over the same
commit, and nothing would notice.

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

### Open PR heads

| PR | head branch | head SHA | base |
|---|---|---|---|
| [#612](https://github.com/MongLong0214/agent-operator-score/pull/612) | `task/issue-572-branch-audit` | `cbf23fbff7313c587d8638e926ddc707ceee4545` | dev |
| [#614](https://github.com/MongLong0214/agent-operator-score/pull/614) | `task/issue-558-routing-oracle` | `f81b17a378d9cbdef111e2cfbe76ccf4b88232ec` | dev |

## Repository branch policy

The branch policy this issue asks to be written down. Descriptive of the repository's current settings where a setting exists, prescriptive where none does.

- feature/, task/ and fix/ branches are deleted once their PR merges. delete_branch_on_merge is enabled, so this happens automatically; the branches in this audit that were not removed are the ones that never had a PR.
- tmp/* branches live at most seven days or until their task ends, whichever comes first. No setting enforces this; it is checked by re-running this audit.
- release/ and hotfix/ branches are deleted after the release ships and the back-merge into dev lands.
- main and dev are protected: no deletion, no force push, enforced for admins. No repository rulesets are configured.
- A branch is not an evidence archive. Anything worth keeping is moved into a commit, a committed fixture, a document or an issue record before the branch it lived on is deleted -- which is why this issue's Phase B is blocked on #578 and #588 rather than running now.

## What Phase B must do, once #578 and #588 have cleared

**Phase A ships no executor.** Performing a deletion, witnessing it and recording completion is
Phase B's work; what this PR provides is the evidence and the verifiers Phase B has to satisfy. The
sequence below is what Phase B does, and every step of it is checkable by something in this
repository today.

**The gate is `deletionAuthorizationFindings({audit, log, pre, post, completion})`**, and running it
is the step that cannot be skipped. It composes every check below and is the only caller that hands
each of them the evidence it is supposed to compare against — the two observations, recomputed and
matched against the digests the record cites. Running the parts individually and reading four empty
results as authorization is how a record citing two fabricated digests, stamped forty days after the
observation it calls "immediately beforehand", once drew no finding at all: each part was asked a
question it had not been given the evidence to answer.

1. **Read the canonical prerequisite snapshot** for the repository being operated on --
   `prerequisiteFindings` -- and stop if #578 or #588 is not closed with close evidence. Before
   anything else: a check that runs after the act is a report, and the act is not reversible.
2. **Collect an observation** with `node scripts/collect-branch-state.mjs`, and re-run the audit
   against it: coverage, derivations, classification, unestablished facts, and the observation's own
   shape. `liveEligibility` does all of that and refuses outright without an observation.
3. **Take only what is still true.** A branch is eligible only if the fresh observation shows it at
   the exact commit the audit judged, with no pull request open on it according to *either* source
   that would know -- the open-PR list and the branch's own collected history -- and with the
   observation reporting it unprotected. As of this snapshot the audit's eligible set is
   `fix/a-fixture-backed-agent-is-not-a-runtime` (`e75d23258fb904c12cc6b8373a2ecd7d9d2b90e1`) and
   `tmp/read-claude-artifact` (`2d6392f578dd2667d5f1f6ba5073a2c4311430eb`); what survives the narrowing is decided then, not now.
   Nothing surviving it is a legitimate completion, not a failure -- auto-delete makes that ordinary.
4. **Delete exactly that list**, and nothing else.
5. **Collect a second observation**, whether or not the deletion succeeded -- one that failed halfway
   has still changed the repository, and what it changed is the same question.
6. **Compare the two observations** -- `boundaryInvariantFindings` -- `main`, `dev`, tag ref and commit identity, the complete
   protection objects, the rulesets, the install source, the repository settings, and every open pull
   request head. The set of heads that vanished between them must equal exactly the set being
   claimed: a deletion that took one extra ref with it, and a claim of a deletion that did not
   happen, are both findings.
7. **Write `fixtures/stale-branches/deletion-log.json`** citing both observation digests, and check
   the whole thing with `deletionAuthorizationFindings({audit, log, pre, post, completion})`. The log
   carries no state of its own: the state lives in the two observations, and the log names them —
   which is why the check is handed those observations rather than the log's account of them.
   `deletionLogFindings(log, {completion, pre, post})` is the part of it that recomputes both digests
   and applies the 900-second window; called without the observations it reports that it could not
   check the citation, because a check that was not run is not a check that passed.
