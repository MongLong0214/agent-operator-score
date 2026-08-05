# E10-002 · Implement metric event artifact evidence drill-down

- Status: **BLOCKED — ADR + PRD + TICKET CEO GATES REQUIRED**
- Epic: E10
- Milestone: S3 · Full Form A & Second Runtime
- Owning PRD: [E10](../../prd/PRD-E10-report-and-one-lever.md)
- Size: M
- Dependencies: E10-001

## Goal

Implement metric event artifact evidence drill-down. Deliver only the bounded contract below; do not infer adjacent scope.

## Exact ownership

- packages/reporter/src/evidence-resolver.ts — resolveEvidenceChain; packages/reporter/src/path-policy.ts — assertContainedEvidencePath
- No other file or symbol may be edited without a replacement ticket and renewed gate.

## Preconditions

1. Required ADRs and owning PRD are explicitly accepted at their exact digests.
2. This exact ticket is explicitly accepted and an execution packet pins the base SHA.
3. Every dependency above is verified complete on the target branch; active/partial work does not count.
4. Worktree is clean or unrelated owner changes are identified and protected.

## Forbidden scope

- broken/stale/traversing link as warning; raw secret excerpt; external fetch
- No fallback that weakens evidence, identity, safety, privacy, or terminal-state semantics.
- No edits to another ticket's owned files, no dependency upgrade unless owned here, and no public claim.

## RED contract

- Test file: `packages/reporter/test/evidence-resolver.test.ts`
- Focused command: `npm test -w @aos/reporter -- evidence-resolver`
- Expected pre-GREEN failure: report can cite missing or wrong-digest artifacts.
- Capture the exact failing test name and message before editing production-owned files. If the failure differs, stop; the ticket precondition is stale or wrong.

## Minimum GREEN

- resolve contained paths and exact metric→opportunity→event→artifact digests, bound/redact excerpts, fail issuance on mismatch.
- Change only the owned symbols and the minimum supporting types explicitly listed in ownership.

## Acceptance ↔ tests

- AC-E10-002-1 ↔ `packages/reporter/test/evidence-resolver.test.ts` case `valid-chain`.
- AC-E10-002-2 ↔ `packages/reporter/test/evidence-resolver.test.ts` case `missing-event`.
- AC-E10-002-3 ↔ `packages/reporter/test/evidence-resolver.test.ts` case `stale-digest`.
- AC-E10-002-4 ↔ `packages/reporter/test/evidence-resolver.test.ts` case `traversal`.
- AC-E10-002-5 ↔ `packages/reporter/test/evidence-resolver.test.ts` case `wrong-run`.
- AC-E10-002-6 ↔ `packages/reporter/test/evidence-resolver.test.ts` case `secret-canary`.

## Verification

1. Focused: `npm test -w @aos/reporter -- evidence-resolver`; every named case above passes.
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
