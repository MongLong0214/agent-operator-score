# E1-002 · Define aos-result and Opportunity Profile schemas

- Status: **BLOCKED — ADR + PRD + TICKET MAINTAINER GATES REQUIRED**
- Epic: E1
- Milestone: S1 · G0 Scorer Truth
- Owning PRD: [E1](../../prd/PRD-E1-trace-and-result-schemas.md)
- Size: L
- Dependencies: E1-001,E0A-003

## Goal

Define aos-result and Opportunity Profile schemas. Deliver only the bounded contract below; do not infer adjacent scope.

## Exact ownership

- specs/aos-result.schema.json; specs/opportunity-profile.schema.json; packages/schema/src/result.ts — parseResult,canonicalizeResult
- No other file or symbol may be edited without a replacement ticket and renewed gate.

## Preconditions

1. Required ADRs and owning PRD are explicitly accepted at their exact digests.
2. This exact ticket is explicitly accepted and an execution packet pins the base SHA.
3. Every dependency above is verified complete on the target branch; active/partial work does not count.
4. Worktree is clean or unrelated owner changes are identified and protected.

## Forbidden scope

- percentile/certification; score on invalid status; mixed safety/F6; environment deconfounding claim
- No fallback that weakens evidence, identity, safety, privacy, or terminal-state semantics.
- No edits to another ticket's owned files, no dependency upgrade unless owned here, and no public claim.

## RED contract

- Test file: `packages/schema/test/result-schema.test.ts`
- Focused command: `npm test -w @aos/schema -- result-schema`
- Expected pre-GREEN failure: invalid state/score/profile combinations are representable.
- Capture the exact failing test name and message before editing production-owned files. If the failure differs, stop; the ticket precondition is stale or wrong.

## Minimum GREEN

- encode statuses, optional scores, factors, separate safety, coverage, provenance/digests, declared manual takeover, external mutation, attribution confidence, retest type, comparison eligibility and profile fields. `actor.attribution_unknown` must withhold the score and yield `DIAGNOSTIC ONLY`.
- Change only the owned symbols and the minimum supporting types explicitly listed in ownership.

## Acceptance ↔ tests

- AC-E1-002-1 ↔ `packages/schema/test/result-schema.test.ts` case `issuable`.
- AC-E1-002-2 ↔ `packages/schema/test/result-schema.test.ts` case `estimate`.
- AC-E1-002-3 ↔ `packages/schema/test/result-schema.test.ts` case `insufficient`.
- AC-E1-002-4 ↔ `packages/schema/test/result-schema.test.ts` case `unsafe`.
- AC-E1-002-5 ↔ `packages/schema/test/result-schema.test.ts` case `invalid`.
- AC-E1-002-6 ↔ `packages/schema/test/result-schema.test.ts` case `missing-profile`.
- AC-E1-002-7 ↔ `packages/schema/test/result-schema.test.ts` case `percentile-reject`.
- AC-E1-002-8 ↔ `packages/schema/test/result-schema.test.ts` case `stable-bytes`.
- AC-E1-002-9 ↔ `packages/schema/test/result-schema.test.ts` case `unknown-attribution-withholds-score`.

## Verification

1. Focused: `npm test -w @aos/schema -- result-schema`; every named case above passes.
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
