# E14-002 · Build public documentation demo and contributor conformance surface

- Status: **BLOCKED — ADR + PRD + TICKET CEO GATES REQUIRED**
- Epic: E14
- Milestone: S5 · Public OSS
- Owning PRD: [E14](../../prd/PRD-E14-public-oss-and-g4.md)
- Size: L
- Dependencies: E14-001

## Goal

Build public documentation demo and contributor conformance surface. Deliver only the bounded contract below; do not infer adjacent scope.

## Exact ownership

- README.md; CONTRIBUTING.md; docs/VALIDATION.md; docs/LIMITATIONS.md; docs/INTENDED_USE.md; examples/**; conformance/**; .github/**
- No other file or symbol may be edited without a replacement ticket and renewed gate.

## Preconditions

1. Required ADRs and owning PRD are explicitly accepted at their exact digests.
2. This exact ticket is explicitly accepted and an execution packet pins the base SHA.
3. Every dependency above is verified complete on the target branch; active/partial work does not count.
4. Worktree is clean or unrelated owner changes are identified and protected.

## Forbidden scope

- new product behavior; hidden task answer; generated attribution; unsupported claim
- No fallback that weakens evidence, identity, safety, privacy, or terminal-state semantics.
- No edits to another ticket's owned files, no dependency upgrade unless owned here, and no public claim.

## RED contract

- Test file: `tests/publication/public-surface.test.mjs`
- Focused command: `npm test -- tests/publication/public-surface.test.mjs`
- Expected pre-GREEN failure: public entry points can omit limits, provenance or reproducible commands.
- Capture the exact failing test name and message before editing production-owned files. If the failure differs, stop; the ticket precondition is stale or wrong.

## Minimum GREEN

- provide one-command demo, schema/scorer/fixture verification, adapter/scenario contribution routes, claim scans, provenance and zero-telemetry statement.
- Change only the owned symbols and the minimum supporting types explicitly listed in ownership.

## Acceptance ↔ tests

- AC-E14-002-1 ↔ `tests/publication/public-surface.test.mjs` case `commands`.
- AC-E14-002-2 ↔ `tests/publication/public-surface.test.mjs` case `links`.
- AC-E14-002-3 ↔ `tests/publication/public-surface.test.mjs` case `no-claims`.
- AC-E14-002-4 ↔ `tests/publication/public-surface.test.mjs` case `no-secrets`.
- AC-E14-002-5 ↔ `tests/publication/public-surface.test.mjs` case `no-answers`.
- AC-E14-002-6 ↔ `tests/publication/public-surface.test.mjs` case `no-attribution`.
- AC-E14-002-7 ↔ `tests/publication/public-surface.test.mjs` case `telemetry-off`.

## Verification

1. Focused: `npm test -- tests/publication/public-surface.test.mjs`; every named case above passes.
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
