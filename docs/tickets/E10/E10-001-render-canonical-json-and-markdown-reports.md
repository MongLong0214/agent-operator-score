# E10-001 · Render canonical JSON and Markdown reports

- Status: **BLOCKED — ADR + PRD + TICKET MAINTAINER GATES REQUIRED**
- Epic: E10
- Milestone: S3 · Full Form A & Second Runtime
- Owning PRD: [E10](../../prd/PRD-E10-report-and-one-lever.md)
- Size: L
- Dependencies: E9-003,E8-004

## Goal

Render canonical JSON and Markdown reports. Deliver only the bounded contract below; do not infer adjacent scope.

## Exact ownership

- packages/reporter/src/report.ts — renderJsonReport,renderMarkdownReport; packages/reporter/test/golden/**
- No other file or symbol may be edited without a replacement ticket and renewed gate.

## Preconditions

1. Required ADRs and owning PRD are explicitly accepted at their exact digests.
2. This exact ticket is explicitly accepted and an execution packet pins the base SHA.
3. Every dependency above is verified complete on the target branch; active/partial work does not count.
4. Worktree is clean or unrelated owner changes are identified and protected.

## Forbidden scope

- score recomputation; web UI; percentile/rank; unsupported copy
- No fallback that weakens evidence, identity, safety, privacy, or terminal-state semantics.
- No edits to another ticket's owned files, no dependency upgrade unless owned here, and no public claim.

## RED contract

- Test file: `packages/reporter/test/report.test.ts`
- Focused command: `npm test -w @aos/reporter -- report`
- Expected pre-GREEN failure: canonical result has no stable honest user projection.
- Capture the exact failing test name and message before editing production-owned files. If the failure differs, stop; the ticket precondition is stale or wrong.

## Minimum GREEN

- render required score/status/time/coverage/safety/profile/comparison/factors/constraint/lever/versions/takeover/limitations fields from result only.
- Change only the owned symbols and the minimum supporting types explicitly listed in ownership.

## Acceptance ↔ tests

- AC-E10-001-1 ↔ `packages/reporter/test/report.test.ts` case `issuable`.
- AC-E10-001-2 ↔ `packages/reporter/test/report.test.ts` case `S1-warning`.
- AC-E10-001-3 ↔ `packages/reporter/test/report.test.ts` case `insufficient`.
- AC-E10-001-4 ↔ `packages/reporter/test/report.test.ts` case `unsafe`.
- AC-E10-001-5 ↔ `packages/reporter/test/report.test.ts` case `invalid`.
- AC-E10-001-6 ↔ `packages/reporter/test/report.test.ts` case `profile-unmatched`.
- AC-E10-001-7 ↔ `packages/reporter/test/report.test.ts` case `stable-bytes`.

## Verification

1. Focused: `npm test -w @aos/reporter -- report`; every named case above passes.
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
