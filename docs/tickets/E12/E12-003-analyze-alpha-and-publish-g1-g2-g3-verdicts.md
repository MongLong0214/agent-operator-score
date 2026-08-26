# E12-003 · Analyze alpha and publish feasibility verdict

- Status: **BLOCKED — ADR + PRD + TICKET MAINTAINER GATES REQUIRED**
- Epic: E12
- Milestone: S4 · Human Alpha & Retest
- Owning PRD: [E12](../../prd/PRD-E12-human-alpha-and-validation.md)
- Size: L
- Dependencies: E12-002

## Goal

Analyze the preregistered n=20 feasibility alpha and publish one deterministic feasibility verdict. Deliver only the bounded contract below; do not infer adjacent scope.

## Exact ownership

- packages/scorer/src/validation.ts — analyzeAlpha; docs/VALIDATION.md; docs/LIMITATIONS.md; docs/INTENDED_USE.md; docs/decisions/FEASIBILITY-VERDICT.md
- No other file or symbol may be edited without a replacement ticket and renewed gate.

## Preconditions

1. Required ADRs and owning PRD are explicitly accepted at their exact digests.
2. This exact ticket is explicitly accepted and an execution packet pins the base SHA.
3. Every dependency above is verified complete on the target branch; active/partial work does not count.
4. Worktree is clean or unrelated owner changes are identified and protected.

## Forbidden scope

- percentile; calibration/certification/population claim; causal claim beyond design; hiding nulls; automatic PASS
- No fallback that weakens evidence, identity, safety, privacy, or terminal-state semantics.
- No edits to another ticket's owned files, no dependency upgrade unless owned here, and no public claim.

## RED contract

- Test file: `packages/scorer/test/validation.test.ts`
- Focused command: `npm test -w @aos/scorer -- validation`
- Expected pre-GREEN failure: gate thresholds and pivot cannot be reproduced from conserved alpha rows.
- Capture the exact failing test name and message before editing production-owned files. If the failure differs, stop; the ticket precondition is stale or wrong.

## Minimum GREEN

- compute person/task/session signal, groups, agreement, duration, profile/crossover, transfer and missingness; render exactly `PASS_TO_CONTINUE`, `INCONCLUSIVE`, or `PIVOT_REQUIRED` with its deterministic next action. The output must state that the n=20 alpha is feasibility-only and cannot support calibration, certification, or population claims.
- Change only the owned symbols and the minimum supporting types explicitly listed in ownership.

## Acceptance ↔ tests

- AC-E12-003-1 ↔ `packages/scorer/test/validation.test.ts` case `known-vectors`.
- AC-E12-003-2 ↔ `packages/scorer/test/validation.test.ts` case `person-signal`.
- AC-E12-003-3 ↔ `packages/scorer/test/validation.test.ts` case `noise-dominant`.
- AC-E12-003-4 ↔ `packages/scorer/test/validation.test.ts` case `duration-fail`.
- AC-E12-003-5 ↔ `packages/scorer/test/validation.test.ts` case `agreement-low`.
- AC-E12-003-6 ↔ `packages/scorer/test/validation.test.ts` case `transfer-fail`.
- AC-E12-003-7 ↔ `packages/scorer/test/validation.test.ts` case `incomplete`.
- AC-E12-003-8 ↔ `packages/scorer/test/validation.test.ts` case `feasibility-only-verdicts`.

## Verification

1. Focused: `npm test -w @aos/scorer -- validation`; every named case above passes.
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
