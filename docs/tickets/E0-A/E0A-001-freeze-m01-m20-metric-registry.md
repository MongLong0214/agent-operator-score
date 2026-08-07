# E0A-001 · Freeze M01–M20 metric registry

- Status: **BLOCKED — ADR + PRD + TICKET MAINTAINER GATES REQUIRED**
- Epic: E0-A
- Milestone: S0 · Name & Contracts
- Owning PRD: [E0-A](../../prd/PRD-E0A-metric-and-score-issuance-contract.md)
- Size: M
- Dependencies: D0-004

## Goal

Freeze M01–M20 metric registry. Deliver only the bounded contract below; do not infer adjacent scope.

## Exact ownership

- specs/metrics.v0.json; packages/schema/src/metric-registry.ts — MetricDefinition,validateMetricRegistry
- Coordinated census amendment, owner-authorised 2026-08-08 because this is the repository's first product code and the census admitted none: scripts/validate-planning.mjs; tests/planning-contract.test.mjs; tests/planning/workspace-skeleton.test.mjs; packages/schema/package.json — ticketOwnedPaths,ticketOwnedCodeFiles
- No other file or symbol may be edited without a replacement ticket and renewed gate.

## Preconditions

1. Required ADRs and owning PRD are explicitly accepted at their exact digests.
2. This exact ticket is explicitly accepted and an execution packet pins the base SHA.
3. Every dependency above is verified complete on the target branch; active/partial work does not count.
4. Worktree is clean or unrelated owner changes are identified and protected.

## Forbidden scope

- M21; scoring; learned weights; dead fields
- No fallback that weakens evidence, identity, safety, privacy, or terminal-state semantics.
- No edits to another ticket's owned files, no dependency upgrade unless owned here, and no public claim.

## RED contract

- Test file: `packages/schema/test/metric-registry.test.ts`
- Focused command: `npm test -w @aos/schema -- metric-registry`
- Expected pre-GREEN failure: no executable registry rejects additions, gaps, duplicates, or missing consumer routes.
- Capture the exact failing test name and message before editing production-owned files. If the failure differs, stop; the ticket precondition is stale or wrong.

## Minimum GREEN

- encode the exact 20 Metric Scoring Contract v1 records with factor, question, observation type, eligible opportunity, numerator, denominator, partial-credit rule, per-opportunity formula, aggregation, minimum opportunities, evidence precedence, confidence, `NOT_OBSERVED`/`INVALID`, normalization, cap/floor, grader output, canonical vectors, version, gaming guard, treatment, and consumer routes.
- encode M03 only as the frozen precision/recall/harmonic-mean contract, including all-zero and missed-required-ask edges; no grader-discretion field is permitted.
- encode M10 from its frozen eligible route table and M20 from its frozen frontier contract. Derive, rather than accept, M10 `selected_regret`/`maximum_regret` and M20 `distance_to_frontier`/`maximum_distance`; reject unknown IDs, inconsistent coordinates, and caller-supplied derived fields as `INVALID`.
- Change only the owned symbols and the minimum supporting types explicitly listed in ownership.

## Acceptance ↔ tests

- AC-E0A-001-1 ↔ `packages/schema/test/metric-registry.test.ts` case `exact-20`.
- AC-E0A-001-2 ↔ `packages/schema/test/metric-registry.test.ts` case `reject-M21`.
- AC-E0A-001-3 ↔ `packages/schema/test/metric-registry.test.ts` case `reject-gap`.
- AC-E0A-001-4 ↔ `packages/schema/test/metric-registry.test.ts` case `reject-duplicate`.
- AC-E0A-001-5 ↔ `packages/schema/test/metric-registry.test.ts` case `reject-dead-route`.
- AC-E0A-001-6 ↔ `packages/schema/test/metric-registry.test.ts` case `complete-contract-v1-fields`.
- AC-E0A-001-7 ↔ `packages/schema/test/metric-registry.test.ts` case `m03-precision-recall-f1-vectors`.
- AC-E0A-001-8 ↔ `packages/schema/test/metric-registry.test.ts` case `canonical-pass-partial-fail-no-vectors`.
- AC-E0A-001-9 ↔ `packages/schema/test/metric-registry.test.ts` case `m10-route-table-derived-regret`.
- AC-E0A-001-10 ↔ `packages/schema/test/metric-registry.test.ts` case `m20-frontier-derived-distance`.
- AC-E0A-001-11 ↔ `packages/schema/test/metric-registry.test.ts` case `reject-caller-supplied-derived-m10-m20-values`.

## Verification

1. Focused: `npm test -w @aos/schema -- metric-registry`; every named case above passes.
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
