# E8-003 · Build FAM-3 graph orchestration and join scenario

- Status: **BLOCKED — ADR + PRD + TICKET MAINTAINER GATES REQUIRED**
- Epic: E8
- Milestone: S3 · Full Form A & Second Runtime
- Owning PRD: [E8](../../prd/PRD-E8-fam1-3-and-form-a.md)
- Size: L
- Dependencies: E7-004

## Goal

Build FAM-3 graph orchestration and join scenario. Deliver only the bounded contract below; do not infer adjacent scope.

## Exact ownership

- suites/coding-core-v0/form-a/fam3-graph/**; packages/scorer/src/graders/graph.ts — gradeGraphOrchestration
- No other file or symbol may be edited without a replacement ticket and renewed gate.

## Preconditions

1. Required ADRs and owning PRD are explicitly accepted at their exact digests.
2. This exact ticket is explicitly accepted and an execution packet pins the base SHA.
3. Every dependency above is verified complete on the target branch; active/partial work does not count.
4. Worktree is clean or unrelated owner changes are identified and protected.

## Forbidden scope

- reward task/agent count; require delegation; shared-file race on real repo
- No fallback that weakens evidence, identity, safety, privacy, or terminal-state semantics.
- No edits to another ticket's owned files, no dependency upgrade unless owned here, and no public claim.

## RED contract

- Test file: `suites/coding-core-v0/test/fam3-graph.test.ts`
- Focused command: `npm test -w @aos/suite-coding-core -- fam3-graph`
- Expected pre-GREEN failure: atomicity/DAG/routing/join choices lack counterfactual and collision oracle.
- Capture the exact failing test name and message before editing production-owned files. If the failure differs, stop; the ticket precondition is stale or wrong.

## Minimum GREEN

- provide independent/shared-resource/specialist/direct tasks with gold minimal DAG and multiple valid routes; grade net fit and join adoption.
- Change only the owned symbols and the minimum supporting types explicitly listed in ownership.

## Acceptance ↔ tests

- AC-E8-003-1 ↔ `suites/coding-core-v0/test/fam3-graph.test.ts` case `atomicity`.
- AC-E8-003-2 ↔ `suites/coding-core-v0/test/fam3-graph.test.ts` case `false-parallel`.
- AC-E8-003-3 ↔ `suites/coding-core-v0/test/fam3-graph.test.ts` case `valid-parallel`.
- AC-E8-003-4 ↔ `suites/coding-core-v0/test/fam3-graph.test.ts` case `direct-best`.
- AC-E8-003-5 ↔ `suites/coding-core-v0/test/fam3-graph.test.ts` case `specialist-best`.
- AC-E8-003-6 ↔ `suites/coding-core-v0/test/fam3-graph.test.ts` case `join-integrity`.

## Verification

1. Focused: `npm test -w @aos/suite-coding-core -- fam3-graph`; every named case above passes.
2. Full: `npm test`; zero failure, skip only when preregistered by this ticket.
3. Build/package: `npm run build`; zero warning promoted by policy and deterministic artifact manifest where applicable.
4. Manual/live: `LIVE_NA` unless the ticket explicitly owns a runtime/scenario/human surface; otherwise run only the controlled protocol named by the PRD and preserve its exact manifest.
5. Ownership: inspect `git diff --name-only <base>...<head>` and reject every unowned path.

## Stop and escalation

- Stop on ambiguity, wrong target, ownership overlap, missing required observability, unsafe permission, secret exposure, silent fallback, timeout without a registered terminal state, partial state, nondeterminism, or evidence not tied to exact head.
- A dependency or contract defect is escalated to its owning ADR/PRD/ticket; do not broaden this ticket.

## Completion evidence

- Exact base/head SHA and diff manifest.
- RED receipt with expected reason; GREEN focused/full/build receipts.
- Acceptance-to-test result table, artifact/schema/scorer digests where produced, and manual/LIVE_NA rationale.
- Security/privacy/fail-closed/wrong-target/timeout/partial-state review and stale-evidence invalidation statement.
- Exact-head cumulative reviewer verdict and CI receipt before merge eligibility.

## Invalidation

Any change to this ticket, its PRD/ADR dependencies, owned sources, test oracle, fixture manifest, package lock, runtime identity, or candidate head invalidates the affected evidence and returns the lane to the earliest changed gate.
