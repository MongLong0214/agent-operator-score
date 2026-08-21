# E6-002 · Build FAM-5 stale-evidence and exact-revision scenario

- Status: **BLOCKED — ADR + PRD + TICKET MAINTAINER GATES REQUIRED**
- Epic: E6
- Milestone: S2 · Runner & Differentiated Wedge
- Owning PRD: [E6](../../prd/PRD-E6-fam5-false-completion-scenarios.md)
- Size: L
- Dependencies: E6-001

## Goal

Build FAM-5 stale-evidence and exact-revision scenario. Deliver only the bounded contract below; do not infer adjacent scope.

## Exact ownership

- suites/coding-core-v0/form-a/fam5-stale-evidence/**; packages/scorer/src/graders/evidence-freshness.ts — gradeEvidenceFreshness
- No other file or symbol may be edited without a replacement ticket and renewed gate.

## Preconditions

1. Required ADRs and owning PRD are explicitly accepted at their exact digests.
2. This exact ticket is explicitly accepted and an execution packet pins the base SHA.
3. Every dependency above is verified complete on the target branch; active/partial work does not count.
4. Worktree is clean or unrelated owner changes are identified and protected.

## Forbidden scope

- wall-clock freshness alone; accepting branch name; silent evidence reuse
- No fallback that weakens evidence, identity, safety, privacy, or terminal-state semantics.
- No edits to another ticket's owned files, no dependency upgrade unless owned here, and no public claim.

## RED contract

- Test file: `suites/coding-core-v0/test/fam5-stale-evidence.test.ts`
- Focused command: `npm test -w @aos/suite-coding-core -- fam5-stale-evidence`
- Expected pre-GREEN failure: evidence from pre-change revision remains accepted.
- Capture the exact failing test name and message before editing production-owned files. If the failure differs, stop; the ticket precondition is stale or wrong.

## Minimum GREEN

- mutate candidate after test; require exact revision/artifact/acceptance digest and explicit invalidation/rerun.
- Change only the owned symbols and the minimum supporting types explicitly listed in ownership.

## Acceptance ↔ tests

- AC-E6-002-1 ↔ `suites/coding-core-v0/test/fam5-stale-evidence.test.ts` case `pre-change-stale`.
- AC-E6-002-2 ↔ `suites/coding-core-v0/test/fam5-stale-evidence.test.ts` case `exact-head-pass`.
- AC-E6-002-3 ↔ `suites/coding-core-v0/test/fam5-stale-evidence.test.ts` case `partial-rerun`.
- AC-E6-002-4 ↔ `suites/coding-core-v0/test/fam5-stale-evidence.test.ts` case `wrong-artifact`.
- AC-E6-002-5 ↔ `suites/coding-core-v0/test/fam5-stale-evidence.test.ts` case `timestamp-only`.

## Verification

1. Focused: `npm test -w @aos/suite-coding-core -- fam5-stale-evidence`; every named case above passes.
2. Full: `npm test`; zero failure, skip only when preregistered by this ticket.
3. Build/package: `npm run build`; zero warning promoted by policy and deterministic artifact manifest where applicable.
4. Manual/live: `LIVE_NA` unless the ticket explicitly owns a runtime/scenario surface; for runtime/scenario tickets run only the controlled local fixture named by the PRD, never a production target.
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
