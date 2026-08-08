# E0B-001 · Define adapter capability schema and complete event matrix

- Status: **BLOCKED — ADR + PRD + TICKET MAINTAINER GATES REQUIRED**
- Epic: E0-B
- Milestone: S0 · Name & Contracts
- Owning PRD: [E0-B](../../prd/PRD-E0B-adapter-observability-contract.md)
- Size: L
- Dependencies: None

## Goal

Define adapter capability schema and complete event matrix. Deliver only the bounded contract below; do not infer adjacent scope.

## Exact ownership

- specs/adapter-capabilities.v0.json; packages/schema/src/capability.ts — CapabilityStatus,CapabilityRow,validateCapabilityMatrix
- Coordinated census amendment, owner-authorised 2026-08-08 under the precedent E0A-001 set: tests/planning-contract.test.mjs; tests/planning/workspace-skeleton.test.mjs — none
- No other file or symbol may be edited without a replacement ticket and renewed gate.

## Preconditions

1. Required ADRs and owning PRD are explicitly accepted at their exact digests.
2. This exact ticket is explicitly accepted and an execution packet pins the base SHA.
3. Every dependency above is verified complete on the target branch; active/partial work does not count.
4. Worktree is clean or unrelated owner changes are identified and protected.

## Forbidden scope

- native adapters; silent inference; missing event rows
- No fallback that weakens evidence, identity, safety, privacy, or terminal-state semantics.
- No edits to another ticket's owned files, no dependency upgrade unless owned here, and no public claim.

## RED contract

- Test file: `packages/schema/test/capability.test.ts`
- Focused command: `npm test -w @aos/schema -- capability`
- Expected pre-GREEN failure: incomplete and source-less capability matrices are accepted.
- Capture the exact failing test name and message before editing production-owned files. If the failure differs, stop; the ticket precondition is stale or wrong.

## Minimum GREEN

- encode every §9.2 event group, status enum, source, locator, derivation proof, missing effect, redaction, runtime constraint.
- Change only the owned symbols and the minimum supporting types explicitly listed in ownership.

## Acceptance ↔ tests

- AC-E0B-001-1 ↔ `packages/schema/test/capability.test.ts` case `complete-matrix`.
- AC-E0B-001-2 ↔ `packages/schema/test/capability.test.ts` case `missing-row`.
- AC-E0B-001-3 ↔ `packages/schema/test/capability.test.ts` case `missing-source`.
- AC-E0B-001-4 ↔ `packages/schema/test/capability.test.ts` case `invalid-derived`.
- AC-E0B-001-5 ↔ `packages/schema/test/capability.test.ts` case `invalid-status`.

## Verification

1. Focused: `npm test -w @aos/schema -- capability`; every named case above passes.
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
