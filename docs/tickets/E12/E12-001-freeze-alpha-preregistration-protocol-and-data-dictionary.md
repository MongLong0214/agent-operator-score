# E12-001 · Freeze alpha preregistration protocol and data dictionary

- Status: **BLOCKED — ADR + PRD + TICKET MAINTAINER GATES REQUIRED**
- Epic: E12
- Milestone: S4 · Human Alpha & Retest
- Owning PRD: [E12](../../prd/PRD-E12-human-alpha-and-validation.md)
- Size: L
- Dependencies: E11-003

## Goal

Freeze alpha preregistration protocol and data dictionary. Deliver only the bounded contract below; do not infer adjacent scope.

## Exact ownership

- docs/validation/ALPHA-PREREGISTRATION.md; specs/alpha-row.schema.json; docs/validation/ANALYSIS-PLAN.md
- No other file or symbol may be edited without a replacement ticket and renewed gate.

## Preconditions

1. Required ADRs and owning PRD are explicitly accepted at their exact digests.
2. This exact ticket is explicitly accepted and an execution packet pins the base SHA.
3. Every dependency above is verified complete on the target branch; active/partial work does not count.
4. Worktree is clean or unrelated owner changes are identified and protected.

## Forbidden scope

- collecting participants before freeze; calibration/certification/population claims; percentile; post-hoc primary subset; PII beyond protocol
- No fallback that weakens evidence, identity, safety, privacy, or terminal-state semantics.
- No edits to another ticket's owned files, no dependency upgrade unless owned here, and no public claim.

## RED contract

- Test file: `tests/validation/alpha-protocol.test.mjs`
- Focused command: `npm test -- tests/validation/alpha-protocol.test.mjs`
- Expected pre-GREEN failure: population/forms/hypotheses/exclusions/missingness/analysis/stops are not immutable.
- Capture the exact failing test name and message before editing production-owned files. If the failure differs, stop; the ticket precondition is stale or wrong.

## Minimum GREEN

- preregister an n=20 feasibility protocol, counterbalance, 48–96 reference runs, blind review, consent/privacy, all-row analysis, and the only allowed verdicts `PASS_TO_CONTINUE`, `INCONCLUSIVE`, and `PIVOT_REQUIRED` with their deterministic stop/pivot criteria. The protocol must prohibit calibration, certification, and population-performance claims.
- Change only the owned symbols and the minimum supporting types explicitly listed in ownership.

## Acceptance ↔ tests

- AC-E12-001-1 ↔ `tests/validation/alpha-protocol.test.mjs` case `schema`.
- AC-E12-001-2 ↔ `tests/validation/alpha-protocol.test.mjs` case `sample-balance`.
- AC-E12-001-3 ↔ `tests/validation/alpha-protocol.test.mjs` case `hypotheses`.
- AC-E12-001-4 ↔ `tests/validation/alpha-protocol.test.mjs` case `missingness`.
- AC-E12-001-5 ↔ `tests/validation/alpha-protocol.test.mjs` case `blind-review`.
- AC-E12-001-6 ↔ `tests/validation/alpha-protocol.test.mjs` case `stop-rules`.
- AC-E12-001-7 ↔ `tests/validation/alpha-protocol.test.mjs` case `no-percentile`.
- AC-E12-001-8 ↔ `tests/validation/alpha-protocol.test.mjs` case `feasibility-only-verdicts`.

## Verification

1. Focused: `npm test -- tests/validation/alpha-protocol.test.mjs`; every named case above passes.
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
