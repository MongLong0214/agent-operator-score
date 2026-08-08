# E0D-001 · Define prescription input formulas and missing rules

- Status: **BLOCKED — ADR + PRD + TICKET MAINTAINER GATES REQUIRED**
- Epic: E0-D
- Milestone: S0 · Name & Contracts
- Owning PRD: [E0-D](../../prd/PRD-E0D-deterministic-prescription-input-contract.md)
- Size: L
- Dependencies: None

## Goal

Define prescription input formulas and missing rules. Deliver only the bounded contract below; do not infer adjacent scope.

## Exact ownership

- specs/prescription-inputs.v0.json; packages/schema/src/prescription-input.ts — PrescriptionInputContract,validatePrescriptionInputContract
- No other file or symbol may be edited without a replacement ticket and renewed gate.

## Preconditions

1. Required ADRs and owning PRD are explicitly accepted at their exact digests.
2. This exact ticket is explicitly accepted and an execution packet pins the base SHA.
3. Every dependency above is verified complete on the target branch; active/partial work does not count.
4. Worktree is clean or unrelated owner changes are identified and protected.

## Forbidden scope

- learned model; prose-only values; implicit defaults
- No fallback that weakens evidence, identity, safety, privacy, or terminal-state semantics.
- No edits to another ticket's owned files, no dependency upgrade unless owned here, and no public claim.

## RED contract

- Test file: `packages/schema/test/prescription-input.test.ts`
- Focused command: `npm test -w @aos/schema -- prescription-input`
- Expected pre-GREEN failure: confidence/gap/cost/permission/uplift fields lack total formulas and missing rules.
- Capture the exact failing test name and message before editing production-owned files. If the failure differs, stop; the ticket precondition is stale or wrong.

## Minimum GREEN

- encode source events, formula, range, missing rule, tie-break, fixture and version for every required input.
- Change only the owned symbols and the minimum supporting types explicitly listed in ownership.

## Acceptance ↔ tests

- AC-E0D-001-1 ↔ `packages/schema/test/prescription-input.test.ts` case `one-case-per-input`.
- AC-E0D-001-2 ↔ `packages/schema/test/prescription-input.test.ts` case `missing-formula`.
- AC-E0D-001-3 ↔ `packages/schema/test/prescription-input.test.ts` case `range`.
- AC-E0D-001-4 ↔ `packages/schema/test/prescription-input.test.ts` case `unknown-source`.
- AC-E0D-001-5 ↔ `packages/schema/test/prescription-input.test.ts` case `version`.

## Verification

1. Focused: `npm test -w @aos/schema -- prescription-input`; every named case above passes.
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
