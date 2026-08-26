# E12-002 · Execute reference and 20-person alpha with immutable provenance

- Status: **BLOCKED — ADR + PRD + TICKET MAINTAINER GATES REQUIRED**
- Epic: E12
- Milestone: S4 · Human Alpha & Retest
- Owning PRD: [E12](../../prd/PRD-E12-human-alpha-and-validation.md)
- Size: L
- Dependencies: E12-001

## Goal

Execute reference and 20-person alpha with immutable provenance. Deliver only the bounded contract below; do not infer adjacent scope.

## Exact ownership

- alpha/runs/**; alpha/manifests/**; packages/runner/src/alpha-orchestrator.ts — runAlphaProtocol
- No other file or symbol may be edited without a replacement ticket and renewed gate.

## Preconditions

1. Required ADRs and owning PRD are explicitly accepted at their exact digests.
2. This exact ticket is explicitly accepted and an execution packet pins the base SHA.
3. Every dependency above is verified complete on the target branch; active/partial work does not count.
4. Worktree is clean or unrelated owner changes are identified and protected.

## Forbidden scope

- starting without consent/gate; calibration/certification/population claim; editing raw rows; excluding failures silently; cloud upload
- No fallback that weakens evidence, identity, safety, privacy, or terminal-state semantics.
- No edits to another ticket's owned files, no dependency upgrade unless owned here, and no public claim.

## RED contract

- Test file: `packages/runner/test/alpha-orchestrator.test.ts`
- Focused command: `npm test -w @aos/runner -- alpha-orchestrator`
- Expected pre-GREEN failure: protocol cannot prove every run/profile/form/deviation row is retained and blinded.
- Capture the exact failing test name and message before editing production-owned files. If the failure differs, stop; the ticket precondition is stale or wrong.

## Minimum GREEN

- execute only the preregistered n=20 feasibility protocol after gate, append signed manifests, conserve invalid/missing rows, blind adjudication packets, verify form/profile balance, and preserve evidence sufficient only for the three E12 feasibility verdicts.
- Change only the owned symbols and the minimum supporting types explicitly listed in ownership.

## Acceptance ↔ tests

- AC-E12-002-1 ↔ `packages/runner/test/alpha-orchestrator.test.ts` case `dry-run`.
- AC-E12-002-2 ↔ `packages/runner/test/alpha-orchestrator.test.ts` case `consent-block`.
- AC-E12-002-3 ↔ `packages/runner/test/alpha-orchestrator.test.ts` case `immutable-row`.
- AC-E12-002-4 ↔ `packages/runner/test/alpha-orchestrator.test.ts` case `missingness`.
- AC-E12-002-5 ↔ `packages/runner/test/alpha-orchestrator.test.ts` case `counterbalance`.
- AC-E12-002-6 ↔ `packages/runner/test/alpha-orchestrator.test.ts` case `blinding`.
- AC-E12-002-7 ↔ `packages/runner/test/alpha-orchestrator.test.ts` case `deviation`.
- AC-E12-002-8 ↔ `packages/runner/test/alpha-orchestrator.test.ts` case `feasibility-claim-block`.

## Verification

1. Focused: `npm test -w @aos/runner -- alpha-orchestrator`; every named case above passes.
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
