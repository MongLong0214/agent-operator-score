# E0C-002 · Implement deterministic pack budget and eligibility simulator

- Status: **BLOCKED — ADR + PRD + TICKET CEO GATES REQUIRED**
- Epic: E0-C
- Milestone: S0 · Name & Contracts
- Owning PRD: [E0-C](../../prd/PRD-E0C-pack-time-and-eligibility-simulation.md)
- Size: L
- Dependencies: E0C-001

## Goal

Implement deterministic pack budget and eligibility simulator. Deliver only the bounded contract below; do not infer adjacent scope.

## Exact ownership

- packages/scorer/src/simulation/pack-budget.ts — simulatePackBudget; packages/scorer/src/simulation/opportunity-audit.ts — auditOpportunities
- No other file or symbol may be edited without a replacement ticket and renewed gate.

## Preconditions

1. Required ADRs and owning PRD are explicitly accepted at their exact digests.
2. This exact ticket is explicitly accepted and an execution packet pins the base SHA.
3. Every dependency above is verified complete on the target branch; active/partial work does not count.
4. Worktree is clean or unrelated owner changes are identified and protected.

## Forbidden scope

- scenario code; fabricated timing; stochastic output without seed
- No fallback that weakens evidence, identity, safety, privacy, or terminal-state semantics.
- No edits to another ticket's owned files, no dependency upgrade unless owned here, and no public claim.

## RED contract

- Test file: `packages/scorer/test/pack-budget.test.ts`
- Focused command: `npm test -w @aos/scorer -- pack-budget`
- Expected pre-GREEN failure: no executable simultaneous timing/eligibility verdict exists.
- Capture the exact failing test name and message before editing production-owned files. If the failure differs, stop; the ticket precondition is stale or wrong.

## Minimum GREEN

- compute seeded duration distribution, median/p90, eligibility, factor minima, required core, coverage and prescription path; emit raw rows and manifest digest.
- Change only the owned symbols and the minimum supporting types explicitly listed in ownership.

## Acceptance ↔ tests

- AC-E0C-002-1 ↔ `packages/scorer/test/pack-budget.test.ts` case `valid-pack`.
- AC-E0C-002-2 ↔ `packages/scorer/test/pack-budget.test.ts` case `slow-pack`.
- AC-E0C-002-3 ↔ `packages/scorer/test/pack-budget.test.ts` case `under-observed`.
- AC-E0C-002-4 ↔ `packages/scorer/test/pack-budget.test.ts` case `double-count`.
- AC-E0C-002-5 ↔ `packages/scorer/test/pack-budget.test.ts` case `no-prescription`.

## Verification

1. Focused: `npm test -w @aos/scorer -- pack-budget`; every named case above passes.
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
