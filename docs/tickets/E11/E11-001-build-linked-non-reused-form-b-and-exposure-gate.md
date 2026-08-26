# E11-001 · Build linked non-reused Form B and exposure gate

- Status: **BLOCKED — ADR + PRD + TICKET MAINTAINER GATES REQUIRED**
- Epic: E11
- Milestone: S4 · Human Alpha & Retest
- Owning PRD: [E11](../../prd/PRD-E11-form-b-and-retest-modes.md)
- Size: L
- Dependencies: E10-003

## Goal

Build linked non-reused Form B and exposure gate. Deliver only the bounded contract below; do not infer adjacent scope.

## Exact ownership

- suites/coding-core-v0/form-b/**; packages/runner/src/exposure-ledger.ts — ExposureLedger; conformance/form-b/**
- No other file or symbol may be edited without a replacement ticket and renewed gate.

## Preconditions

1. Required ADRs and owning PRD are explicitly accepted at their exact digests.
2. This exact ticket is explicitly accepted and an execution packet pins the base SHA.
3. Every dependency above is verified complete on the target branch; active/partial work does not count.
4. Worktree is clean or unrelated owner changes are identified and protected.

## Forbidden scope

- copying Form A answers; exact growth claim; unlinked difficulty assumption
- No fallback that weakens evidence, identity, safety, privacy, or terminal-state semantics.
- No edits to another ticket's owned files, no dependency upgrade unless owned here, and no public claim.

## RED contract

- Test file: `conformance/form-b/form-b.test.ts`
- Focused command: `node --test --experimental-strip-types conformance/form-b/form-b.test.ts`
- Expected pre-GREEN failure: Form B equivalence, distance and exposure are not machine-checked.
- Capture the exact failing test name and message before editing production-owned files. If the failure differs, stop; the ticket precondition is stale or wrong.

## Minimum GREEN

- define different repo/surface/traps with construct/opportunity link map, exposure digests, leakage checks and no repeated-form transfer.
- Change only the owned symbols and the minimum supporting types explicitly listed in ownership.

## Acceptance ↔ tests

- AC-E11-001-1 ↔ `conformance/form-b/form-b.test.ts` case `construct-link`.
- AC-E11-001-2 ↔ `conformance/form-b/form-b.test.ts` case `repo-distance`.
- AC-E11-001-3 ↔ `conformance/form-b/form-b.test.ts` case `trap-distance`.
- AC-E11-001-4 ↔ `conformance/form-b/form-b.test.ts` case `repeated-form`.
- AC-E11-001-5 ↔ `conformance/form-b/form-b.test.ts` case `answer-leak`.
- AC-E11-001-6 ↔ `conformance/form-b/form-b.test.ts` case `valid-B`.

## Verification

1. Focused: `node --test --experimental-strip-types conformance/form-b/form-b.test.ts`; every named case above passes.
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
