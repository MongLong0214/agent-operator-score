# Stale remote branch audit (#572, Phase A -- read-only)

> **This is a snapshot, not a deletion list. Do not act on this file.** Phase B (blocked on #578
> and #588) must re-collect every fact in it from scratch -- `git ls-remote`, merge status, `gh pr
> list`, tag containment and protection -- rather than trust any SHA, count or PR number written
> here. The previous version of this fixture is the proof: it recorded seven heads, three of which
> (`task/issue-570-action-pins`, `task/issue-572-work`, `task/issue-588-mark-done`) had been merged
> and auto-deleted before this snapshot was taken, while three that did not exist then
> (`task/issue-556-strict-confinement`, `task/issue-560-operator-events`,
> `task/issue-561-model-identity`) had appeared.

- **Generated:** 2026-09-02T23:16:46Z
- **Repository:** `MongLong0214/agent-operator-score`
- **`dev` at snapshot:** `2e2e0afb0effbe2d88a1eee0ddbbcb9300c70a49`
- **`main` at snapshot:** `d2c68036ebf9f9fd7287258fd3cec252133ef846`
- **Machine-readable source of truth:** [`fixtures/stale-branches/audit.json`](../fixtures/stale-branches/audit.json)
- **Deletion log (empty; Phase B has not run):** [`fixtures/stale-branches/deletion-log.json`](../fixtures/stale-branches/deletion-log.json)
- **Checked by:** `npm run verify:branch-audit`, `npm run verify:branch-cleanup-invariants`, `npm run verify:no-open-pr-head-deletion`

This document is rendered from the fixture. Where the two disagree the fixture wins, and
`tests/product/stale-branch-audit.test.mjs` fails when a branch recorded in the fixture is missing
from the table below.

## Phase A is read-only, and Phase B has not run

Phase A is inventory, classification and a preservation plan. Nothing here authorizes deletion.
No ref was deleted, renamed or force-pushed to produce this document, and no ref was created or
deleted for audit purposes. The one branch this work adds to `origin` is the branch it is submitted
from (`task/issue-572-branch-audit`) -- the ordinary artifact of opening a pull request, recorded in
the fixture under `heads_created_after_this_snapshot` because its SHA is the SHA of the commit
carrying this file and so cannot appear in a snapshot taken before that commit existed.

**The deletion log is empty and says `NOT_YET`.** Phase B is blocked on **#578** (final release/E2E
evidence preserved) and **#588** (the close-evidence confirmation bound to that work). The log exists
now, empty and explicit, rather than being absent: "no branch has been deleted" and "there is no
record either way" are different claims, and only the first one can be checked.

## Snapshot

`git ls-remote --heads origin`, cross-checked independently against
`gh api repos/MongLong0214/agent-operator-score/branches --paginate`. Both returned the same 7 heads.

| branch | head SHA | classification | in dev / main | unique vs dev / main | release tags | open PR | recommendation |
|---|---|---|---|---|---|---|---|
| `fix/a-fixture-backed-agent-is-not-a-runtime` | `e75d23258fb904c12cc6b8373a2ecd7d9d2b90e1` | MERGED | yes / yes | 0 / 0 | v0.1.11, v0.1.12, v0.1.13, v0.1.14, v0.1.15, v0.1.16, v0.1.17 | none | **safe_to_delete_after_578** |
| `task/issue-556-strict-confinement` | `893289f90e6eb4322f54ca979e72016d4e1cb81a` | ACTIVE | no / no | 37 / 208 | none | [#609](https://github.com/MongLong0214/agent-operator-score/pull/609) | **must_be_preserved** |
| `task/issue-560-operator-events` | `48bbf579294f67727448bfe192a63152555dd66c` | ACTIVE | no / no | 14 / 188 | none | [#611](https://github.com/MongLong0214/agent-operator-score/pull/611) | **must_be_preserved** |
| `task/issue-561-model-identity` | `a2d7d591b608c3080352ee02a8fb6ba2e369740d` | ACTIVE | no / no | 17 / 188 | none | [#607](https://github.com/MongLong0214/agent-operator-score/pull/607) | **must_be_preserved** |
| `tmp/read-claude-artifact` | `2d6392f578dd2667d5f1f6ba5073a2c4311430eb` | MERGED | yes / yes | 0 / 0 | v0.1.16, v0.1.17 | none | **safe_to_delete_after_578** |

`main` (`d2c68036ebf9f9fd7287258fd3cec252133ef846`) and `dev` (`2e2e0afb0effbe2d88a1eee0ddbbcb9300c70a49`) are excluded by
definition and are listed in the fixture's snapshot so a reader can see they were excluded rather
than missed.

## What happened to the branches the previous snapshot recorded

The previous version of this fixture (PR #592, merged 2026-09-02) recorded seven heads. Three of
them no longer exist. None was deleted by this audit; each was merged and removed by the
repository's `delete_branch_on_merge` setting.

| branch | SHA the previous snapshot recorded | PR that consumed it | merge commit | note |
|---|---|---|---|---|
| `task/issue-570-action-pins` | `34ad44ccedb8d13a698ab3aa8b82237aec908f5b` | [#590](https://github.com/MongLong0214/agent-operator-score/pull/590) MERGED 2026-09-02T07:10:00Z | `8e87da05e2233d00a5a65ba008a00dfafc2d1d97` | Merged into dev and removed by the repository's delete_branch_on_merge setting, not by this audit. Its content is on dev. |
| `task/issue-572-work` | `1afd3524f3fb4a4b5e884bd0d30b0ee3216a2d71` | [#592](https://github.com/MongLong0214/agent-operator-score/pull/592) MERGED 2026-09-02T02:47:36Z | `ea1fe9ec6e7efe360da5ab7ceaa316a7cbfa65d9` | The previous version of this very audit. Merged into dev and auto-deleted; its content is the file this one supersedes, and remains readable at that merge commit. |
| `task/issue-588-mark-done` | `034fcac5fcbd50e64ceb7cf8e8a7d21e57e7f08a` | [#591](https://github.com/MongLong0214/agent-operator-score/pull/591) MERGED 2026-09-02T05:10:28Z | `50c4ddb9643ec170e469f26f47f99a7df4a24802` | The branch the previous snapshot could not initially classify. It was merged into dev and auto-deleted; the work the previous snapshot worried about losing is on dev. |

This is the concrete reason the warning at the top of this file is not boilerplate. A Phase A audit
of a repository under active batch development is stale by the time it is read: three of seven heads
turned over in under a day, and `dev` moved from `499bb11b004024fc46b9e97300ad8909d86a5073` to
`2e2e0afb0effbe2d88a1eee0ddbbcb9300c70a49` in the same window.

## Per-branch audit

### `fix/a-fixture-backed-agent-is-not-a-runtime`

| field | value |
|---|---|
| current SHA | `e75d23258fb904c12cc6b8373a2ecd7d9d2b90e1` |
| last update | 2026-08-28T20:37:31+09:00 (5 days before this snapshot) |
| owner (last committer) | MongLong0214 <97578200+MongLong0214@users.noreply.github.com> |
| classification | **MERGED** |
| open/closed/merged PR | no PR has ever used this branch as a head, open, closed or merged |
| unique commits vs `dev` | 0 (behind by 259) |
| unique commits vs `main` | 0 (behind by 85) |
| contained in `dev` / `main` | yes / yes |
| release-tag containment | v0.1.11, v0.1.12, v0.1.13, v0.1.14, v0.1.15, v0.1.16, v0.1.17 |
| superseding PR/issue/SHA | none recorded -- nothing replaced this branch's work, see below |
| to preserve | nothing -- no object on this ref is absent from `dev` or `main` |
| protection / ruleset | no branch protection, no ruleset (the repository has none configured) |
| **recommendation** | **safe_to_delete_after_578** |

| reference scan | found |
|---|---|
| workflows | none found |
| skills / commands / scripts | none found |
| schemas / contracts | none found |
| docs | docs/STALE_BRANCH_AUDIT.md -- this audit's own document, naming the branch as a candidate |
| issues | #572 -- named in issue #572's own 'Current candidates' list |
| pull requests | #592 -- the previous #572 Phase A audit PR, which named the branch in its body; a self-reference from the audit describing itself, not evidence of use |

The tip commit e75d232 is an ancestor of both origin/dev and origin/main; git rev-list returns 0 commits unique to the branch against either, and git tag --contains places the commit in v0.1.11 through v0.1.17. The branch never carried a commit of its own -- it points at the merge commit of PR #511 (the chore/back-merge-0.1.10 chain) and never advanced from it. No PR has ever used it as a head branch, and no workflow, skill, command, script, schema, contract or document references it outside this audit. Deleting it after #578 and #588 have preserved the release evidence removes a name, not any content.

**Could not establish: why this branch was created, and what change its name ('a fixture-backed agent is not a runtime') was meant to carry**

- Searched: git log --all --grep over the full history, gh search issues, and a gh issue/pr list over every issue and PR in the repository: no issue title, PR title, PR body or commit message anywhere states this intent, and the branch itself carries no commit of its own
- Bearing on deletion: `none`
- Why it does not bear: intent is a question about the past; data loss is a question about the present, and the present is fully established here. The tip is an ancestor of both origin/dev and origin/main, `git rev-list origin/dev..` and `git rev-list origin/main..` both return 0, and the commit is contained in seven release tags. There is no object on this ref that deleting the ref would remove from the repository, whatever it was created for.

### `task/issue-556-strict-confinement`

| field | value |
|---|---|
| current SHA | `893289f90e6eb4322f54ca979e72016d4e1cb81a` |
| last update | 2026-09-03T07:04:44+09:00 (0 days before this snapshot) |
| owner (last committer) | MongLong0214 <weplay0628@gmail.com> |
| classification | **ACTIVE** |
| open/closed/merged PR | open PR [#609](https://github.com/MongLong0214/agent-operator-score/pull/609) -> `dev`, head `893289f90e6eb4322f54ca979e72016d4e1cb81a` |
| unique commits vs `dev` | 37 (behind by 3) |
| unique commits vs `main` | 208 (behind by 0) |
| contained in `dev` / `main` | no / no |
| release-tag containment | in no release tag |
| superseding PR/issue/SHA | none recorded -- nothing replaced this branch's work, see below |
| to preserve | 37 commits implementing #556 STRICT workspace confinement and the official issuance gate, reachable from no other ref; lib/confinement adapters and gate wiring across lib/core.mjs, lib/profile.mjs, lib/store.mjs, lib/result-schema.mjs, lib/scorer-v1.mjs, lib/redact.mjs, lib/ecd-contract.mjs, lib/session.mjs; tests/product/confinement.test.mjs, confinement-real-lane.test.mjs and official-issuance.test.mjs (2665 new test lines) plus the mutation ledger tests/mutation/measured.json; schemas/aos-result.v2.schema.json additions and the docs/confinement Phase B support matrix |
| protection / ruleset | no branch protection, no ruleset (the repository has none configured) |
| **recommendation** | **must_be_preserved** |

| reference scan | found |
|---|---|
| workflows | none found |
| skills / commands / scripts | none found |
| schemas / contracts | none found |
| docs | none found |
| issues | #556 -- the issue this branch implements |
| pull requests | #609 -- open PR whose head this branch is |

Head of open PR #609 ('feat(confinement): STRICT workspace confinement and official issuance gate (#556)') targeting dev, under active review. It carries 37 commits that reach neither dev nor main and is in no release tag; the work exists nowhere else. Deleting the head branch of an open PR is on this issue's own prohibited-actions list.

Nothing about this branch was left unestablished: its containment, PR state, tag membership, protection and references were all read directly.

### `task/issue-560-operator-events`

| field | value |
|---|---|
| current SHA | `48bbf579294f67727448bfe192a63152555dd66c` |
| last update | 2026-09-03T08:12:43+09:00 (0 days before this snapshot) |
| owner (last committer) | MongLong0214 <weplay0628@gmail.com> |
| classification | **ACTIVE** |
| open/closed/merged PR | open PR [#611](https://github.com/MongLong0214/agent-operator-score/pull/611) -> `dev`, head `48bbf579294f67727448bfe192a63152555dd66c` |
| unique commits vs `dev` | 14 (behind by 0) |
| unique commits vs `main` | 188 (behind by 0) |
| contained in `dev` / `main` | no / no |
| release-tag containment | in no release tag |
| superseding PR/issue/SHA | none recorded -- nothing replaced this branch's work, see below |
| to preserve | 14 commits implementing #560 operator events and the D1-D3 construct binding, reachable from no other ref; lib/operator-events.mjs and lib/operator-plan.mjs (1039 new lines), plus the store and CLI ingest path; schemas/aos-operator-event.v2.schema.json; tests/product/operator-event-authority.test.mjs, operator-event-projection.test.mjs, operator-channel-authority.test.mjs, no-agent-artifact-process-credit.test.mjs, initial-before-advice.test.mjs |
| protection / ruleset | no branch protection, no ruleset (the repository has none configured) |
| **recommendation** | **must_be_preserved** |

| reference scan | found |
|---|---|
| workflows | none found |
| skills / commands / scripts | none found |
| schemas / contracts | none found |
| docs | none found |
| issues | #560 -- the issue this branch implements |
| pull requests | #611 -- open PR whose head this branch is |

Head of open PR #611 ('feat(operator-events): rebind D1-D3 to actual operator events and construct opportunities (#560)') targeting dev, under active review. It carries 14 commits that reach neither dev nor main and is in no release tag.

Nothing about this branch was left unestablished: its containment, PR state, tag membership, protection and references were all read directly.

### `task/issue-561-model-identity`

| field | value |
|---|---|
| current SHA | `a2d7d591b608c3080352ee02a8fb6ba2e369740d` |
| last update | 2026-09-03T08:13:58+09:00 (0 days before this snapshot) |
| owner (last committer) | MongLong0214 <weplay0628@gmail.com> |
| classification | **ACTIVE** |
| open/closed/merged PR | open PR [#607](https://github.com/MongLong0214/agent-operator-score/pull/607) -> `dev`, head `a2d7d591b608c3080352ee02a8fb6ba2e369740d` |
| unique commits vs `dev` | 17 (behind by 3) |
| unique commits vs `main` | 188 (behind by 0) |
| contained in `dev` / `main` | no / no |
| release-tag containment | in no release tag |
| superseding PR/issue/SHA | none recorded -- nothing replaced this branch's work, see below |
| to preserve | 17 commits implementing #561 model and runtime identity binding, reachable from no other ref; lib/model-identity.mjs (1064 new lines), the profile digest binding and the cycle comparability wiring; schemas/aos-model-provenance.v1.json, fixtures/model-identity/runtime-canary.json, scripts/capture-model-canary.mjs; tests/product/model-identity.test.mjs and model-canary.test.mjs (1877 new test lines) |
| protection / ruleset | no branch protection, no ruleset (the repository has none configured) |
| **recommendation** | **must_be_preserved** |

| reference scan | found |
|---|---|
| workflows | none found |
| skills / commands / scripts | none found |
| schemas / contracts | none found |
| docs | none found |
| issues | #561 -- the issue this branch implements |
| pull requests | #607 -- open PR whose head this branch is |

Head of open PR #607 ('feat(model-identity): bind exact model and runtime identity to the profile and cycle comparability (#561)') targeting dev, under active review. It carries 17 commits that reach neither dev nor main and is in no release tag; fixtures/model-identity/runtime-canary.json exists on no other ref.

Nothing about this branch was left unestablished: its containment, PR state, tag membership, protection and references were all read directly.

### `tmp/read-claude-artifact`

| field | value |
|---|---|
| current SHA | `2d6392f578dd2667d5f1f6ba5073a2c4311430eb` |
| last update | 2026-08-29T11:33:54+09:00 (4 days before this snapshot) |
| owner (last committer) | MongLong0214 <97578200+MongLong0214@users.noreply.github.com> |
| classification | **MERGED** |
| open/closed/merged PR | no PR has ever used this branch as a head, open, closed or merged |
| unique commits vs `dev` | 0 (behind by 207) |
| unique commits vs `main` | 0 (behind by 33) |
| contained in `dev` / `main` | yes / yes |
| release-tag containment | v0.1.16, v0.1.17 |
| superseding PR/issue/SHA | none recorded -- nothing replaced this branch's work, see below |
| to preserve | nothing -- no object on this ref is absent from `dev` or `main` |
| protection / ruleset | no branch protection, no ruleset (the repository has none configured) |
| **recommendation** | **safe_to_delete_after_578** |

| reference scan | found |
|---|---|
| workflows | none found |
| skills / commands / scripts | none found |
| schemas / contracts | none found |
| docs | docs/STALE_BRANCH_AUDIT.md -- this audit's own document, naming the branch as a candidate |
| issues | #572 -- named in issue #572's own 'Current candidates' list |
| pull requests | #592 -- the previous #572 Phase A audit PR, which named the branch in its body; a self-reference, not evidence of use |

The tip commit 2d6392f is fully contained in both origin/dev and origin/main (0 commits unique against either) and in release tags v0.1.16 and v0.1.17; it is the merge commit of PR #538, the chore/back-merge-0.1.15 chain, and the branch never advanced past it. It is a tmp/* branch, which repository policy caps at seven days or task end; it is past that. No PR ever used it as a head and nothing in the repository references it outside this audit.

**Could not establish: what the branch was used to read, and whether anything was ever committed to it and later discarded**

- Searched: git log --all --grep='claude artifact', gh search issues, and the full PR list: nothing names it; the reflog for a branch on origin is not readable from a clone, so a commit pushed and then force-replaced before this audit would leave no trace this audit can see
- Bearing on deletion: `none`
- Why it does not bear: the question is about objects that are not on the ref now. The ref as it stands is an ancestor of both origin/dev and origin/main with 0 unique commits against either, so deleting it removes no reachable object. A hypothetical object already unreachable from this ref is not preserved by keeping the ref either, which is precisely why #572 routes evidence into committed fixtures and issue records rather than leaving it on a branch.

## Classification vocabulary and what each one permits

| classification | meaning | permits deletion after #578/#588 |
|---|---|---|
| `MERGED` | every commit on the branch is reachable from `dev` and `main` | yes, if no PR is open on it and it is unprotected |
| `SUPERSEDED` | the work was redone elsewhere, and the superseding PR/issue/SHA is recorded | yes, on the same conditions, and only with that record present |
| `UNIQUE_WORK` | commits or files exist on no other ref | no -- rebuild on latest `dev` as a new task branch first |
| `EVIDENCE_ONLY` | the branch is being used to hold evidence | no -- move the evidence into a commit, fixture, doc or issue first |
| `ACTIVE` | an open PR or an active owner | no -- deleting an open PR's head destroys its diff |
| `UNKNOWN_HOLD` | something bearing on the decision could not be established | no |

`lib/branch-audit.mjs` enforces this table rather than leaving it as prose. A branch reaches
deletion-eligibility only by satisfying all of these at once:

- classified `MERGED` or `SUPERSEDED`, and recommended `safe_to_delete_after_578`
- contained in both `dev` and `main`, with zero commits either line lacks
- audited at the exact commit the `ls-remote` snapshot observed -- a name is not a ref, and a
  branch that advanced past the snapshot has not been audited at the commit that would be deleted
- no open PR, and no branch protection
- an empty `preserve` list: the audit's own answer to "what would be lost" has to be "nothing"
- nothing in `unestablished` that bears on the decision

Any finding anywhere in the audit -- an unrecognized classification, a missing field, an empty
reason, an unestablished fact with no argument attached -- empties the whole eligible set rather
than only the entry that produced it.

## What could not be established

Both fully-merged branches carry a named unestablished fact, and both are argued rather than
dismissed. In each case the argument is the same shape: the thing that could not be established is a
question about the past (why the branch was made, what was once on it), while the question deletion
turns on is about the present (is any reachable object here absent from `dev` and `main`) -- and the
present is fully established for both, at zero unique commits against either line.

Neither branch is recommended for deletion *because* nothing could be found against it. Each is
recommended because `git merge-base --is-ancestor` and `git rev-list` positively establish that its
content already lives on both integration lines and in released tags. That is the distinction this
issue exists to hold: absence of evidence is not the evidence.

## Pre-deletion invariant baseline

Recorded now, before anything is deleted, because an invariant nobody wrote down beforehand cannot
be checked afterwards. `npm run verify:branch-cleanup-invariants` checks this baseline against the
snapshot today, and checks the post-deletion state against it once Phase B fills the log in.

- `main`: `d2c68036ebf9f9fd7287258fd3cec252133ef846` -- protection: no deletion, no force push, enforced for admins
- `dev`: `2e2e0afb0effbe2d88a1eee0ddbbcb9300c70a49` -- protection: no deletion, no force push, enforced for admins
- repository rulesets: none configured
- `delete_branch_on_merge`: true, default branch `dev`
- none of the 5 non-`main`/`dev` heads has any branch protection of its own

### Release tags that must not move

Two object ids per tag. `ref_sha` is what `refs/tags/<name>` points at -- for an annotated tag that
is the tag object itself, carrying the annotation and any signature. `commit_sha` is what it peels
to. Recording only the commit would let a tag be replaced by a *different* tag object over the same
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

### Open PR heads that must survive

| PR | head branch | head SHA | base |
|---|---|---|---|
| [#612](https://github.com/MongLong0214/agent-operator-score/pull/612) | `task/issue-572-branch-audit` | `1de779c66bd5f211c0b4262e571beafada058950` | dev |
| [#611](https://github.com/MongLong0214/agent-operator-score/pull/611) | `task/issue-560-operator-events` | `48bbf579294f67727448bfe192a63152555dd66c` | dev |
| [#609](https://github.com/MongLong0214/agent-operator-score/pull/609) | `task/issue-556-strict-confinement` | `893289f90e6eb4322f54ca979e72016d4e1cb81a` | dev |
| [#607](https://github.com/MongLong0214/agent-operator-score/pull/607) | `task/issue-561-model-identity` | `a2d7d591b608c3080352ee02a8fb6ba2e369740d` | dev |

## Repository branch policy

The branch policy this issue asks to be written down. It is descriptive of the repository's current settings where it can be (delete_branch_on_merge is on), and prescriptive where no setting enforces it.

- feature/, task/ and fix/ branches are deleted once their PR merges. delete_branch_on_merge is enabled, so this happens automatically; the two branches in this audit that were not removed are the two that never had a PR.
- tmp/* branches live at most seven days or until their task ends, whichever comes first. No setting enforces this; it is checked by re-running this audit.
- release/ and hotfix/ branches are deleted after the release ships and the back-merge into dev lands.
- main and dev are protected: no deletion, no force push, enforced for admins. No repository rulesets are configured.
- A branch is not an evidence archive. Anything worth keeping is moved into a commit, a committed fixture, a document or an issue record before the branch it lived on is deleted -- which is the whole reason this audit's Phase B is blocked on #578 and #588 rather than running now.

## What Phase B must do, once #578 and #588 pass

1. **Re-collect every fact in this document from scratch.** `git ls-remote`, `gh pr list`, merge
   status against the then-current `dev` and `main`, tag containment, protection. This snapshot is a
   starting point for re-verification, never ground truth -- see the turnover table above.
2. Confirm the final evidence bundle preserves what the `preserve` column names for anything that is
   still not `MERGED`.
3. Delete only what a fresh audit marks deletion-eligible, **at the exact commit the fresh audit
   judged**. As of this snapshot that is
   `fix/a-fixture-backed-agent-is-not-a-runtime` (`e75d23258fb904c12cc6b8373a2ecd7d9d2b90e1`) and
   `tmp/read-claude-artifact` (`2d6392f578dd2667d5f1f6ba5073a2c4311430eb`), and nothing else.
4. Fill in `fixtures/stale-branches/deletion-log.json`:
   - `status: "COMPLETED"`
   - each deleted branch with the exact SHA the audit judged it at
   - `blockers_cleared` naming both #578 and #588 with what cleared each
   - `post_delete_state` read back from the live repository: `main_sha`, `dev_sha`, `tags` (both
     `ref_sha` and `commit_sha`), `protection`, `rulesets` and `open_pr_heads`

   `npm run verify:branch-cleanup-invariants` refuses a `COMPLETED` log that omits any of those, or
   one whose post-delete state shows `main`, `dev`, a tag, a protection setting or an open PR head
   having moved. `npm run verify:no-open-pr-head-deletion` refuses a log naming a branch this audit
   never covered, one an open PR still points at, or one deleted at a commit the audit did not
   judge. A correctly filled-in log passes both -- that positive case is itself a test, because a
   verifier Phase B cannot satisfy is a verifier Phase B deletes.
