# E0D-003 · Implement deterministic one-lever selector contract

- Status: **BLOCKED — ADR + PRD + TICKET MAINTAINER GATES REQUIRED**
- Epic: E0-D
- Milestone: S0 · Name & Contracts
- Owning PRD: [E0-D](../../prd/PRD-E0D-deterministic-prescription-input-contract.md)
- Size: M
- Dependencies: E0D-001,E0D-002

## Goal

Implement deterministic one-lever selector contract. Deliver only the bounded contract below; do not infer adjacent scope.

## Exact ownership

- packages/scorer/src/diagnosis/select-lever.ts — selectPrimaryConstraint; fixtures/prescription/*.json
- No other file or symbol may be edited without a replacement ticket and renewed gate.

## Preconditions

1. Required ADRs and owning PRD are explicitly accepted at their exact digests.
2. This exact ticket is explicitly accepted and an execution packet pins the base SHA.
3. Every dependency above is verified complete on the target branch; active/partial work does not count.
4. Worktree is clean or unrelated owner changes are identified and protected.

## Forbidden scope

- LLM advice; >1 lever; candidate confidence <0.70 or opportunities <2
- No fallback that weakens evidence, identity, safety, privacy, or terminal-state semantics.
- No edits to another ticket's owned files, no dependency upgrade unless owned here, and no public claim.

## RED contract

- Test file: `packages/scorer/test/select-lever.test.ts`
- Focused command: `npm test -w @aos/scorer -- select-lever`
- Expected pre-GREEN failure: ties and insufficient evidence return arbitrary or multiple recommendations.
- Capture the exact failing test name and message before editing production-owned files. If the failure differs, stop; the ticket precondition is stale or wrong.

## Minimum GREEN

- apply safety-first, eligibility filter, normalized gap, three-point tie band, factor priority, metric minimum, cost/permission tie-break, and manual review.
- Change only the owned symbols and the minimum supporting types explicitly listed in ownership.

## Acceptance ↔ tests

- AC-E0D-003-1 ↔ `packages/scorer/test/select-lever.test.ts` case `S2`.
- AC-E0D-003-2 ↔ `packages/scorer/test/select-lever.test.ts` case `factor-priority`.
- AC-E0D-003-3 ↔ `packages/scorer/test/select-lever.test.ts` case `three-point-tie`.
- AC-E0D-003-4 ↔ `packages/scorer/test/select-lever.test.ts` case `lower-cost`.
- AC-E0D-003-5 ↔ `packages/scorer/test/select-lever.test.ts` case `lower-permission`.
- AC-E0D-003-6 ↔ `packages/scorer/test/select-lever.test.ts` case `insufficient`.
- AC-E0D-003-7 ↔ `packages/scorer/test/select-lever.test.ts` case `manual-review`.

## Verification

1. Focused: `npm test -w @aos/scorer -- select-lever`; every named case above passes.
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
