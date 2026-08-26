# E7-004 · Close differentiated wedge and G0 demo candidate

- Status: **BLOCKED — ADR + PRD + TICKET MAINTAINER GATES REQUIRED**
- Epic: E7
- Milestone: S2 · Runner & Differentiated Wedge
- Owning PRD: [E7](../../prd/PRD-E7-fam6-recovery-safety-efficiency-and-g0.md)
- Size: M
- Dependencies: E7-001,E7-002,E7-003

## Goal

Close differentiated wedge and G0 demo candidate. Deliver only the bounded contract below; do not infer adjacent scope.

## Exact ownership

- conformance/demos/**; examples/operator-gap/**; examples/false-completion/**; scripts/build-demo.mjs; docs/G0-DEMO.md
- No other file or symbol may be edited without a replacement ticket and renewed gate.

## Preconditions

1. Required ADRs and owning PRD are explicitly accepted at their exact digests.
2. This exact ticket is explicitly accepted and an execution packet pins the base SHA.
3. Every dependency above is verified complete on the target branch; active/partial work does not count.
4. Worktree is clean or unrelated owner changes are identified and protected.

## Forbidden scope

- public release; operator rank; private source; non-deterministic recording
- No fallback that weakens evidence, identity, safety, privacy, or terminal-state semantics.
- No edits to another ticket's owned files, no dependency upgrade unless owned here, and no public claim.

## RED contract

- Test file: `conformance/demos/demo.test.ts`
- Focused command: `npm test -- 'conformance/demos/*.test.ts'`
- Expected pre-GREEN failure: no exact artifact binds FAM-4/5/6 behavior to scorer truth.
- Capture the exact failing test name and message before editing production-owned files. If the failure differs, stop; the ticket precondition is stale or wrong.

## Minimum GREEN

- build privacy-safe deterministic operator-gap, false-completion, stale-evidence, duplicate-retry, unsafe and scorer-repro artifacts with manifest.
- Change only the owned symbols and the minimum supporting types explicitly listed in ownership.

## Acceptance ↔ tests

- AC-E7-004-1 ↔ `conformance/demos/demo.test.ts` case `each-demo`.
- AC-E7-004-2 ↔ `conformance/demos/demo.test.ts` case `no-private-data`.
- AC-E7-004-3 ↔ `conformance/demos/demo.test.ts` case `byte-stable`.
- AC-E7-004-4 ↔ `conformance/demos/demo.test.ts` case `claim-scan`.
- AC-E7-004-5 ↔ `conformance/demos/demo.test.ts` case `stale-manifest`.

## Verification

1. Focused: `npm test -- 'conformance/demos/*.test.ts'`; every named case above passes.
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
