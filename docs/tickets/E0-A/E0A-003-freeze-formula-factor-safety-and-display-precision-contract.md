# E0A-003 · Freeze formula, factor, safety, and display precision contract

- Status: **BLOCKED — ADR + PRD + TICKET MAINTAINER GATES REQUIRED**
- Epic: E0-A
- Milestone: S0 · Name & Contracts
- Owning PRD: [E0-A](../../prd/PRD-E0A-metric-and-score-issuance-contract.md)
- Size: M
- Dependencies: E0A-002

## Goal

Freeze formula, factor, safety, and display precision contract. Deliver only the bounded contract below; do not infer adjacent scope.

## Exact ownership

- specs/scoring.v0.json; packages/schema/src/scoring-contract.ts — ScoringContract,validateScoringContract
- Coordinated census amendment, owner-authorised 2026-08-08 under the precedent E0A-001 set, limited to recording this ticket's two owned product paths in the census assertions: tests/planning-contract.test.mjs; tests/planning/workspace-skeleton.test.mjs — ticketOwnedSkeletonPaths
- No other file or symbol may be edited without a replacement ticket and renewed gate.

## Preconditions

1. Required ADRs and owning PRD are explicitly accepted at their exact digests.
2. This exact ticket is explicitly accepted and an execution packet pins the base SHA.
3. Every dependency above is verified complete on the target branch; active/partial work does not count.
4. Worktree is clean or unrelated owner changes are identified and protected.

## Forbidden scope

- calibration model; percentile; averaging M19; changing alpha weights
- No fallback that weakens evidence, identity, safety, privacy, or terminal-state semantics.
- No edits to another ticket's owned files, no dependency upgrade unless owned here, and no public claim.

## RED contract

- Test file: `packages/schema/test/scoring-contract.test.ts`
- Focused command: `npm test -w @aos/schema -- scoring-contract`
- Expected pre-GREEN failure: formula and display precision are only prose and invalid combinations validate.
- Capture the exact failing test name and message before editing production-owned files. If the failure differs, stop; the ticket precondition is stale or wrong.

## Minimum GREEN

- encode O/P weights, harmonic mean, zero rules, factor mappings, M19 S0–S3 hard gate, raw float, nearest-five display, version/digest.
- Change only the owned symbols and the minimum supporting types explicitly listed in ownership.

## Acceptance ↔ tests

- AC-E0A-003-1 ↔ `packages/schema/test/scoring-contract.test.ts` case `published-vectors`.
- AC-E0A-003-2 ↔ `packages/schema/test/scoring-contract.test.ts` case `O-zero`.
- AC-E0A-003-3 ↔ `packages/schema/test/scoring-contract.test.ts` case `P-zero`.
- AC-E0A-003-4 ↔ `packages/schema/test/scoring-contract.test.ts` case `S2-withhold`.
- AC-E0A-003-5 ↔ `packages/schema/test/scoring-contract.test.ts` case `rounding-boundaries`.

## Verification

1. Focused: `npm test -w @aos/schema -- scoring-contract`; every named case above passes.
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
