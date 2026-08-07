# D0-005 · Two-tier evidence binding and head-preserving CI dispatch

- Status: **BLOCKED — ADR + PRD + TICKET MAINTAINER GATES REQUIRED**
- Epic: D0
- Milestone: S0 · Name & Contracts
- Owning PRD: [D0G](../../prd/PRD-D0G-governance-simplification.md)
- Size: L
- Dependencies: D0-004

## Goal

Per the binding CEO Governance Simplification decision, implement two-tier evidence binding — a reusable tree-bound layer and a commit-SHA-bound layer — and ship the head-preserving CI retrigger required to exercise the commit-SHA-bound layer, in one ticket. Neither half is separable: a retrigger with no resolver acceptance path is inert, and commit-SHA-bound evidence with no dispatch mechanism cannot be refreshed without discarding the live PR head. Deliver only the bounded contract below; do not infer adjacent scope.

## Exact ownership

- `.github/workflows/ci.yml` — add a `workflow_dispatch` trigger only; no change to the existing `push`/`pull_request` triggers, the `planning-contract` job, its Node 20/22/24 matrix, or its steps. This file is currently owned by no ticket; this ticket establishes that ownership for the trigger it adds.
- `scripts/resolve-execution-state.mjs` — exactly: the two-tier evidence-binding read/write paths (reusable layer keyed on candidate tree OID, base tree OID, toolchain/runtime identity, and external input digests; commit-SHA-bound layer keyed on exact commit SHA); the tree-identical-empty-commit non-invalidation path for the reusable layer; the rejection of blanket tree-only evidence; and the `candidate_ci` dispatched-run acceptance path (the `required_event` extension, workflow-blob equality check against live `dev`, actor-eligibility check, GitHub Actions app check-source restriction, and the exact-once completed/success binding for `planning-contract (20)`, `(22)`, and `(24)`). Every other resolver behavior already merged through PR #150 (D0-004 lineage) remains D0-004-owned and must not be touched.
- `specs/execution-state.schema.v1.json` — only the fields needed to represent the two-tier binding tuple and dispatched-run provenance. No unrelated schema field may be added, removed, or renamed.
- `tests/execution-state.test.mjs` — only the two-tier-binding and dispatch-acceptance regression cases added by this ticket. Every case already merged through PR #150 remains D0-004-owned and must not be edited, renamed, or deleted.
- No other file or symbol may be edited without a replacement ticket and renewed gate.

## Preconditions

1. Required ADRs and owning PRD (PRD-D0G) are explicitly accepted at their exact digests.
2. This exact ticket is explicitly accepted and an execution packet pins the base SHA.
3. PR #150 is merged into `dev` and post-merge verified first. `scripts/resolve-execution-state.mjs`, `specs/execution-state.schema.v1.json`, and `tests/execution-state.test.mjs` are D0-004-owned and are currently under live CEO exact-head review in that open PR; this ticket's base SHA must postdate that merge, and no work here may begin against PR #150's unmerged head.
4. Worktree is clean or unrelated owner changes are identified and protected.

## Forbidden scope

- Any change to PR #150's head, branch, or worktree.
- Any product code beyond the four paths named in Exact ownership.
- Weakening any existing fail-closed behavior in `scripts/resolve-execution-state.mjs`, including the review/authorization dispatch checks, ownership-overlap detection, digest-staleness detection, or partial-payload rejection already established by PR #150.
- Treating an outage, missing check, ambiguous mapping, or partial result as a pass.
- Landing the `workflow_dispatch` trigger without the resolver's dispatched-run acceptance path, or the acceptance path without the trigger; the PRD binds these as one ticket, one candidate head.

## RED contract

- Test file: `tests/execution-state.test.mjs`
- Focused command: `npm test -- tests/execution-state.test.mjs`
- Expected pre-GREEN failure: `.github/workflows/ci.yml` has no `workflow_dispatch` trigger, `candidate_ci.required_event` is pinned to `"pull_request"` only (`scripts/resolve-execution-state.mjs` line ~340), and the workflow-runs query is hardcoded to `&event=pull_request` (line ~2338, verify both against the live file at ticket start since PR #150 may shift them). A fixture representing an eligible-maintainer-dispatched run with `head_sha` equal to the live PR head is therefore currently rejected or unavailable rather than accepted, and no reusable/commit-SHA two-tier split exists to test against.
- Capture the exact failing case names and messages before editing any owned production file. If the two-tier split or the dispatch rejection does not fail for the exact reasons above, stop; the ticket precondition is stale or wrong.

## Minimum GREEN

- Implement the reusable evidence layer keyed strictly on the tuple (candidate tree OID, base tree OID, toolchain/runtime identity, external input digests), covering RED/GREEN results, focused/full/build lane results, source review, and artifact results.
- Implement the commit-SHA-bound layer keyed strictly on the exact commit SHA, covering GitHub formal review `commit_id`, CI and check-run evidence, PR head/base and ancestry, workflow provenance, CEO authorization, and merge/post-merge evidence.
- Prove a tree-identical empty commit re-runs only the commit-SHA-bound layer; the reusable layer must not be invalidated by that commit alone. Reject any fixture that supplies tree-only evidence as a stand-in for commit-SHA-bound facts.
- Add a `workflow_dispatch:` trigger to `.github/workflows/ci.yml` with no other change to that file.
- Extend the `candidate_ci` policy and its run-selection path so a `workflow_dispatch` run is accepted alongside — not instead of — the existing `pull_request` run, gated on all of:
  1. the dispatched run's `head_sha` equals the live PR head.
  2. the executing workflow blob is byte-identical to the `ci.yml` blob on live `dev`.
  3. the dispatching actor holds eligible maintainer/admin permission.
  4. only GitHub Actions app (`github-actions`, id 15368) check-runs are honored as evidence.
  5. `planning-contract (20)`, `(22)`, and `(24)` each appear exactly once on the latest attempt and are `completed`/`success`.
- Each fail-closed vector — duplicate check/workflow mapping, wrong ref, wrong blob, wrong actor, wrong head, and outage — has its own named regression test proving it yields failure or unavailable, never a pass.
- Change only the owned symbols and files above.

## Acceptance ↔ tests

- AC-D0-005-1 ↔ `tests/execution-state.test.mjs` case `reusable-layer-keyed-on-tree-tuple`: the reusable layer is read/written strictly by (candidate tree OID, base tree OID, toolchain/runtime identity, external input digests).
- AC-D0-005-2 ↔ `tests/execution-state.test.mjs` case `commit-bound-layer-keyed-on-sha`: the commit-SHA-bound layer is read/written strictly by exact commit SHA and covers formal review `commit_id`, CI/check-run evidence, PR head/base/ancestry, workflow provenance, CEO authorization, and merge/post-merge evidence.
- AC-D0-005-3 ↔ `tests/execution-state.test.mjs` case `tree-identical-empty-commit-preserves-reusable-layer`: a tree-identical empty-commit fixture re-runs only the commit-SHA-bound layer; reusable-layer evidence is unchanged.
- AC-D0-005-4 ↔ `tests/execution-state.test.mjs` case `blanket-tree-only-evidence-rejected`: a fixture asserting tree-only evidence in place of commit-SHA-bound facts is rejected.
- AC-D0-005-5 ↔ `tests/execution-state.test.mjs` case `workflow-dispatch-trigger-present-existing-triggers-unchanged`: `.github/workflows/ci.yml` declares `workflow_dispatch` and its `push`/`pull_request` triggers and job body are byte-identical to before.
- AC-D0-005-6 ↔ `tests/execution-state.test.mjs` case `dispatched-run-accepted-on-full-match`: a dispatched-run fixture satisfying all five gate conditions is accepted as valid candidate-CI evidence.
- AC-D0-005-7 ↔ `tests/execution-state.test.mjs` case `dispatched-run-wrong-head-fails-closed`: a dispatched run whose `head_sha` does not equal the live PR head fails closed.
- AC-D0-005-8 ↔ `tests/execution-state.test.mjs` case `dispatched-run-wrong-ref-fails-closed`: a dispatched run triggered from a non-trusted ref fails closed.
- AC-D0-005-9 ↔ `tests/execution-state.test.mjs` case `dispatched-run-wrong-blob-fails-closed`: a dispatched run whose executing workflow blob differs from live `dev`'s `ci.yml` blob fails closed.
- AC-D0-005-10 ↔ `tests/execution-state.test.mjs` case `dispatched-run-wrong-actor-fails-closed`: a dispatched run triggered by an actor without maintainer/admin permission fails closed.
- AC-D0-005-11 ↔ `tests/execution-state.test.mjs` case `dispatched-run-duplicate-mapping-fails-closed`: two candidate check/workflow mappings for the same required check on the same head fail closed rather than picking one silently.
- AC-D0-005-12 ↔ `tests/execution-state.test.mjs` case `dispatched-run-non-actions-check-source-fails-closed`: a check-run created by an app other than GitHub Actions is ignored as evidence.
- AC-D0-005-13 ↔ `tests/execution-state.test.mjs` case `dispatched-run-missing-or-duplicate-planning-contract-check-fails-closed`: any of `planning-contract (20)`/`(22)`/`(24)` missing, duplicated, or not `completed`/`success` on the latest attempt fails closed.
- AC-D0-005-14 ↔ `tests/execution-state.test.mjs` case `dispatched-run-outage-yields-unavailable-not-pass`: a transport/API outage during dispatched-run resolution yields an explicit unavailable result, never a pass.

## Verification

1. RED: run `npm test -- tests/execution-state.test.mjs` after writing the new cases and before every GREEN-owned production edit; capture the named two-tier-split and dispatch-rejection failures.
2. Focused: `npm test -- tests/execution-state.test.mjs`; every case above passes and every case already merged through PR #150 still passes unmodified.
3. Full: `npm test`; zero failure and no unregistered skip.
4. Build/package: `npm run build`; zero warning promoted by policy; the emitted `ci.yml` carries the `workflow_dispatch` trigger with no drift elsewhere.
5. Manual/live: required, not `LIVE_NA` — this ticket's purpose is a real CI dispatch mechanism. After merge eligibility, manually trigger one `workflow_dispatch` run on the exact candidate head and confirm the resolver reports it as valid candidate-CI evidence under all five gate conditions; capture run id, head_sha, dispatching actor, and workflow-blob digest in completion evidence.
6. Ownership: inspect `git diff --name-only <base>...<head>` and reject every unowned path.

## Stop and escalation

- Stop on ambiguous authority, missing ownership, malformed workflow definition, wrong target, unsafe path/ref handling, timeout without a terminal state, partial state, or any fixture/live result that would treat an outage as a pass.
- Stop if PR #150 is not yet merged and post-merge verified; do not begin owned edits against its unmerged head under any circumstance.
- A dependency or contract defect is escalated to its owning ADR/PRD/ticket; do not broaden this ticket.

## Completion evidence

- Exact base/head SHA and diff manifest.
- RED receipts for the two-tier split and each dispatch fail-closed vector; canonical focused/full/build receipts.
- Acceptance-to-test result table for AC-D0-005-1 through AC-D0-005-14.
- Live dispatch trial receipt: run id, head_sha, actor, workflow-blob digest, and the five-condition pass evidence.
- Security/privacy/fail-closed/wrong-target/timeout/partial-state review and stale-evidence invalidation statement.
- Exact-head cumulative reviewer verdict and CI receipt before merge eligibility.

## Invalidation

Any change to PR #150's merged resolver baseline, `.github/workflows/ci.yml`, `specs/execution-state.schema.v1.json`, the two-tier evidence-binding contract, the dispatch fail-closed conditions, runtime identity, or candidate head invalidates the affected RED/GREEN, focused, full, build, review, and CI evidence and returns this lane to the earliest changed gate.
