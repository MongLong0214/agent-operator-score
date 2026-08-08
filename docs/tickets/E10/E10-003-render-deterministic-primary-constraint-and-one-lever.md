# E10-003 · Render deterministic primary constraint and one lever

- Status: **BLOCKED — ADR + PRD + TICKET MAINTAINER GATES REQUIRED**
- Epic: E10
- Milestone: S3 · Full Form A & Second Runtime
- Owning PRD: [E10](../../prd/PRD-E10-report-and-one-lever.md)
- Size: M
- Dependencies: E10-001,E10-002

## Goal

Render deterministic primary constraint and one lever. Deliver only the bounded contract below; do not infer adjacent scope.

## Exact ownership

- packages/reporter/src/diagnosis.ts — renderDiagnosis; packages/reporter/test/diagnosis.golden.json
- No other file or symbol may be edited without a replacement ticket and renewed gate.

## Preconditions

1. Required ADRs and owning PRD are explicitly accepted at their exact digests.
2. This exact ticket is explicitly accepted and an execution packet pins the base SHA.
3. Every dependency above is verified complete on the target branch; active/partial work does not count.
4. Worktree is clean or unrelated owner changes are identified and protected.

## Forbidden scope

- generating advice; multiple levers; hiding decision trace; ordinary advice for unsafe
- No fallback that weakens evidence, identity, safety, privacy, or terminal-state semantics.
- No edits to another ticket's owned files, no dependency upgrade unless owned here, and no public claim.

## RED contract

- Test file: `packages/reporter/test/diagnosis.test.ts`
- Focused command: `npm test -w @aos/reporter -- diagnosis`
- Expected pre-GREEN failure: selector output is not rendered with evidence/cost/application/retest contract.
- Capture the exact failing test name and message before editing production-owned files. If the failure differs, stop; the ticket precondition is stale or wrong.

## Minimum GREEN

- render registered constraint evidence, one treatment, expected cost/permission/uplift classes, application steps, Form B criteria or manual review.
- Change only the owned symbols and the minimum supporting types explicitly listed in ownership.

## Acceptance ↔ tests

- AC-E10-003-1 ↔ `packages/reporter/test/diagnosis.test.ts` case `ordinary`.
- AC-E10-003-2 ↔ `packages/reporter/test/diagnosis.test.ts` case `safety-remediation`.
- AC-E10-003-3 ↔ `packages/reporter/test/diagnosis.test.ts` case `manual-review`.
- AC-E10-003-4 ↔ `packages/reporter/test/diagnosis.test.ts` case `evidence-missing`.
- AC-E10-003-5 ↔ `packages/reporter/test/diagnosis.test.ts` case `prohibited-copy`.

## Verification

1. Focused: `npm test -w @aos/reporter -- diagnosis`; every named case above passes.
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
