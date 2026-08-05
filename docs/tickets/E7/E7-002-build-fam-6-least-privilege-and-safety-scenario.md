# E7-002 · Build FAM-6 least-privilege and safety scenario

- Status: **BLOCKED — ADR + PRD + TICKET CEO GATES REQUIRED**
- Epic: E7
- Milestone: S2 · Runner & Differentiated Wedge
- Owning PRD: [E7](../../prd/PRD-E7-fam6-recovery-safety-efficiency-and-g0.md)
- Size: L
- Dependencies: E7-001

## Goal

Build FAM-6 least-privilege and safety scenario. Deliver only the bounded contract below; do not infer adjacent scope.

## Exact ownership

- suites/coding-core-v0/form-a/fam6-safety/**; packages/scorer/src/graders/safety.ts — gradeSafeAutonomy
- No other file or symbol may be edited without a replacement ticket and renewed gate.

## Preconditions

1. Required ADRs and owning PRD are explicitly accepted at their exact digests.
2. This exact ticket is explicitly accepted and an execution packet pins the base SHA.
3. Every dependency above is verified complete on the target branch; active/partial work does not count.
4. Worktree is clean or unrelated owner changes are identified and protected.

## Forbidden scope

- real secrets/actions; all-permissions-off gaming; quality offset
- No fallback that weakens evidence, identity, safety, privacy, or terminal-state semantics.
- No edits to another ticket's owned files, no dependency upgrade unless owned here, and no public claim.

## RED contract

- Test file: `suites/coding-core-v0/test/fam6-safety.test.ts`
- Focused command: `npm test -w @aos/suite-coding-core -- fam6-safety`
- Expected pre-GREEN failure: unsafe approval/secret/destructive target may be treated as ordinary process loss.
- Capture the exact failing test name and message before editing production-owned files. If the failure differs, stop; the ticket precondition is stale or wrong.

## Minimum GREEN

- simulate permission/secret/external/destructive traps; grade S0–S3, approval boundary, least privilege and task completion fit.
- Change only the owned symbols and the minimum supporting types explicitly listed in ownership.

## Acceptance ↔ tests

- AC-E7-002-1 ↔ `suites/coding-core-v0/test/fam6-safety.test.ts` case `S0`.
- AC-E7-002-2 ↔ `suites/coding-core-v0/test/fam6-safety.test.ts` case `S1`.
- AC-E7-002-3 ↔ `suites/coding-core-v0/test/fam6-safety.test.ts` case `S2`.
- AC-E7-002-4 ↔ `suites/coding-core-v0/test/fam6-safety.test.ts` case `S3`.
- AC-E7-002-5 ↔ `suites/coding-core-v0/test/fam6-safety.test.ts` case `over-restrict`.
- AC-E7-002-6 ↔ `suites/coding-core-v0/test/fam6-safety.test.ts` case `over-privilege`.
- AC-E7-002-7 ↔ `suites/coding-core-v0/test/fam6-safety.test.ts` case `wrong-target`.

## Verification

1. Focused: `npm test -w @aos/suite-coding-core -- fam6-safety`; every named case above passes.
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
