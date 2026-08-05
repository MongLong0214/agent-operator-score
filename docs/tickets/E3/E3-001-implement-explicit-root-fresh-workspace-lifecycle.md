# E3-001 · Implement explicit-root fresh workspace lifecycle

- Status: **BLOCKED — ADR + PRD + TICKET CEO GATES REQUIRED**
- Epic: E3
- Milestone: S2 · Runner & Differentiated Wedge
- Owning PRD: [E3](../../prd/PRD-E3-isolated-controlled-runner.md)
- Size: L
- Dependencies: E2-005

## Goal

Implement explicit-root fresh workspace lifecycle. Deliver only the bounded contract below; do not infer adjacent scope.

## Exact ownership

- packages/runner/src/workspace.ts — createRunWorkspace,verifyWorkspace,sealWorkspace; packages/runner/test/workspace.test.ts
- No other file or symbol may be edited without a replacement ticket and renewed gate.

## Preconditions

1. Required ADRs and owning PRD are explicitly accepted at their exact digests.
2. This exact ticket is explicitly accepted and an execution packet pins the base SHA.
3. Every dependency above is verified complete on the target branch; active/partial work does not count.
4. Worktree is clean or unrelated owner changes are identified and protected.

## Forbidden scope

- implicit cwd; cleanup outside run root; reused workspace; source mutation
- No fallback that weakens evidence, identity, safety, privacy, or terminal-state semantics.
- No edits to another ticket's owned files, no dependency upgrade unless owned here, and no public claim.

## RED contract

- Test file: `packages/runner/test/workspace.test.ts`
- Focused command: `npm test -w @aos/runner -- workspace`
- Expected pre-GREEN failure: dirty/wrong-root/symlink/cross-run residue is not contained.
- Capture the exact failing test name and message before editing production-owned files. If the failure differs, stop; the ticket precondition is stale or wrong.

## Minimum GREEN

- create unique run root, verify base/environment digest, materialize allowed source, block symlink escape, seal initial/final manifests.
- Change only the owned symbols and the minimum supporting types explicitly listed in ownership.

## Acceptance ↔ tests

- AC-E3-001-1 ↔ `packages/runner/test/workspace.test.ts` case `fresh`.
- AC-E3-001-2 ↔ `packages/runner/test/workspace.test.ts` case `dirty-base`.
- AC-E3-001-3 ↔ `packages/runner/test/workspace.test.ts` case `wrong-root`.
- AC-E3-001-4 ↔ `packages/runner/test/workspace.test.ts` case `symlink-escape`.
- AC-E3-001-5 ↔ `packages/runner/test/workspace.test.ts` case `source-mutation`.
- AC-E3-001-6 ↔ `packages/runner/test/workspace.test.ts` case `residue`.

## Verification

1. Focused: `npm test -w @aos/runner -- workspace`; every named case above passes.
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
