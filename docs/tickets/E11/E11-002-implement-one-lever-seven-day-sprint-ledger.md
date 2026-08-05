# E11-002 · Implement one-lever seven-day sprint ledger

- Status: **BLOCKED — ADR + PRD + TICKET CEO GATES REQUIRED**
- Epic: E11
- Milestone: S4 · Human Alpha & Retest
- Owning PRD: [E11](../../prd/PRD-E11-form-b-and-retest-modes.md)
- Size: M
- Dependencies: E11-001

## Goal

Implement one-lever seven-day sprint ledger. Deliver only the bounded contract below; do not infer adjacent scope.

## Exact ownership

- packages/runner/src/sprint-ledger.ts — SprintLedger; specs/sprint-ledger.schema.json
- No other file or symbol may be edited without a replacement ticket and renewed gate.

## Preconditions

1. Required ADRs and owning PRD are explicitly accepted at their exact digests.
2. This exact ticket is explicitly accepted and an execution packet pins the base SHA.
3. Every dependency above is verified complete on the target branch; active/partial work does not count.
4. Worktree is clean or unrelated owner changes are identified and protected.

## Forbidden scope

- two treatments; mutable baseline; central upload; inferred adherence
- No fallback that weakens evidence, identity, safety, privacy, or terminal-state semantics.
- No edits to another ticket's owned files, no dependency upgrade unless owned here, and no public claim.

## RED contract

- Test file: `packages/runner/test/sprint-ledger.test.ts`
- Focused command: `npm test -w @aos/runner -- sprint-ledger`
- Expected pre-GREEN failure: treatment/adherence/deviation/cost and baseline changes cannot be distinguished.
- Capture the exact failing test name and message before editing production-owned files. If the failure differs, stop; the ticket precondition is stale or wrong.

## Minimum GREEN

- record exactly one treatment, immutable baseline/result/profile, local adherence/deviation/cost events and explicit close state.
- Change only the owned symbols and the minimum supporting types explicitly listed in ownership.

## Acceptance ↔ tests

- AC-E11-002-1 ↔ `packages/runner/test/sprint-ledger.test.ts` case `one-treatment`.
- AC-E11-002-2 ↔ `packages/runner/test/sprint-ledger.test.ts` case `two-treatment`.
- AC-E11-002-3 ↔ `packages/runner/test/sprint-ledger.test.ts` case `baseline-mutation`.
- AC-E11-002-4 ↔ `packages/runner/test/sprint-ledger.test.ts` case `deviation`.
- AC-E11-002-5 ↔ `packages/runner/test/sprint-ledger.test.ts` case `local-only`.
- AC-E11-002-6 ↔ `packages/runner/test/sprint-ledger.test.ts` case `close-state`.

## Verification

1. Focused: `npm test -w @aos/runner -- sprint-ledger`; every named case above passes.
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
