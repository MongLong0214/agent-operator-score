# E13-001 · Define and render Snapshot ESTIMATE output

- Status: **BLOCKED — ADR + PRD + TICKET MAINTAINER GATES REQUIRED**
- Epic: E13
- Milestone: S5 · Public OSS
- Owning PRD: [E13](../../prd/PRD-E13-snapshot-estimate.md)
- Size: M
- Dependencies: E12-003

## Goal

Define and render Snapshot ESTIMATE output. Deliver only the bounded contract below; do not infer adjacent scope.

## Exact ownership

- specs/aos-snapshot.schema.json; packages/reporter/src/snapshot.ts — buildSnapshot,renderSnapshot
- No other file or symbol may be edited without a replacement ticket and renewed gate.

## Preconditions

1. Required ADRs and owning PRD are explicitly accepted at their exact digests.
2. This exact ticket is explicitly accepted and an execution packet pins the base SHA.
3. Every dependency above is verified complete on the target branch; active/partial work does not count.
4. Worktree is clean or unrelated owner changes are identified and protected.

## Forbidden scope

- numeric P0; PROVISIONAL; SAFE; percentile; verified-assessment language
- No fallback that weakens evidence, identity, safety, privacy, or terminal-state semantics.
- No edits to another ticket's owned files, no dependency upgrade unless owned here, and no public claim.

## RED contract

- Test file: `packages/reporter/test/snapshot.test.ts`
- Focused command: `npm test -w @aos/reporter -- snapshot`
- Expected pre-GREEN failure: Snapshot can impersonate a verified result.
- Capture the exact failing test name and message before editing production-owned files. If the failure differs, stop; the ticket precondition is stale or wrong.

## Minimum GREEN

- emit only estimate band, recommended family, next command, ESTIMATE watermark, limitations and version in separate schema.
- Change only the owned symbols and the minimum supporting types explicitly listed in ownership.

## Acceptance ↔ tests

- AC-E13-001-1 ↔ `packages/reporter/test/snapshot.test.ts` case `valid`.
- AC-E13-001-2 ↔ `packages/reporter/test/snapshot.test.ts` case `no-score`.
- AC-E13-001-3 ↔ `packages/reporter/test/snapshot.test.ts` case `no-provisional`.
- AC-E13-001-4 ↔ `packages/reporter/test/snapshot.test.ts` case `no-safe`.
- AC-E13-001-5 ↔ `packages/reporter/test/snapshot.test.ts` case `no-percentile`.
- AC-E13-001-6 ↔ `packages/reporter/test/snapshot.test.ts` case `watermark`.
- AC-E13-001-7 ↔ `packages/reporter/test/snapshot.test.ts` case `copy-scan`.

## Verification

1. Focused: `npm test -w @aos/reporter -- snapshot`; every named case above passes.
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
