# E14-003 · Obtain independent reproduction and close G4 publication gate

- Status: **BLOCKED — ADR + PRD + TICKET MAINTAINER GATES REQUIRED**
- Epic: E14
- Milestone: S5 · Public OSS
- Owning PRD: [E14](../../prd/PRD-E14-public-oss-and-g4.md)
- Size: L
- Dependencies: E14-002,E12-003

## Goal

Obtain independent reproduction and close G4 publication gate. Deliver only the bounded contract below; do not infer adjacent scope.

## Exact ownership

- conformance/external/**; docs/decisions/G4-VERDICT.md; scripts/verify-release.mjs
- No other file or symbol may be edited without a replacement ticket and renewed gate.

## Preconditions

1. Required ADRs and owning PRD are explicitly accepted at their exact digests.
2. This exact ticket is explicitly accepted and an execution packet pins the base SHA.
3. Every dependency above is verified complete on the target branch; active/partial work does not count.
4. Worktree is clean or unrelated owner changes are identified and protected.

## Forbidden scope

- self-attested external result; repo/npm publish without separate authorization; stale artifact
- No fallback that weakens evidence, identity, safety, privacy, or terminal-state semantics.
- No edits to another ticket's owned files, no dependency upgrade unless owned here, and no public claim.

## RED contract

- Test file: `conformance/external/external-reproduction.test.ts`
- Focused command: `npm run verify:release`
- Expected pre-GREEN failure: no independent environment has reproduced exact public fixture bytes.
- Capture the exact failing test name and message before editing production-owned files. If the failure differs, stop; the ticket precondition is stale or wrong.

## Minimum GREEN

- accept signed environment/toolchain manifest and output digests from an independent run, compare exact bytes, run all G0–G4 blockers and emit PASS/FAIL.
- Change only the owned symbols and the minimum supporting types explicitly listed in ownership.

## Acceptance ↔ tests

- AC-E14-003-1 ↔ `conformance/external/external-reproduction.test.ts` case `independent-manifest`.
- AC-E14-003-2 ↔ `conformance/external/external-reproduction.test.ts` case `exact-bytes`.
- AC-E14-003-3 ↔ `conformance/external/external-reproduction.test.ts` case `wrong-digest`.
- AC-E14-003-4 ↔ `conformance/external/external-reproduction.test.ts` case `stale-head`.
- AC-E14-003-5 ↔ `conformance/external/external-reproduction.test.ts` case `unresolved-gate`.
- AC-E14-003-6 ↔ `conformance/external/external-reproduction.test.ts` case `full-pass`.

## Verification

1. Focused: `npm run verify:release`; every named case above passes.
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
