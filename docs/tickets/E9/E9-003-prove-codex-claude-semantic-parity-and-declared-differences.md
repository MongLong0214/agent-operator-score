# E9-003 · Prove Codex Claude semantic parity and declared differences

- Status: **BLOCKED — ADR + PRD + TICKET CEO GATES REQUIRED**
- Epic: E9
- Milestone: S3 · Full Form A & Second Runtime
- Owning PRD: [E9](../../prd/PRD-E9-claude-code-adapter-and-parity.md)
- Size: L
- Dependencies: E9-002,E4-004

## Goal

Prove Codex Claude semantic parity and declared differences. Deliver only the bounded contract below; do not infer adjacent scope.

## Exact ownership

- conformance/adapters/parity/**; packages/schema/src/semantic-parity.ts — compareSemanticTrace
- No other file or symbol may be edited without a replacement ticket and renewed gate.

## Preconditions

1. Required ADRs and owning PRD are explicitly accepted at their exact digests.
2. This exact ticket is explicitly accepted and an execution packet pins the base SHA.
3. Every dependency above is verified complete on the target branch; active/partial work does not count.
4. Worktree is clean or unrelated owner changes are identified and protected.

## Forbidden scope

- forcing byte identity on meaningful profile differences; erasing unavailable state
- No fallback that weakens evidence, identity, safety, privacy, or terminal-state semantics.
- No edits to another ticket's owned files, no dependency upgrade unless owned here, and no public claim.

## RED contract

- Test file: `conformance/adapters/parity/parity.test.ts`
- Focused command: `npm run verify:adapter-parity`
- Expected pre-GREEN failure: equivalent native inputs are not proven to yield equivalent normalized semantics.
- Capture the exact failing test name and message before editing production-owned files. If the failure differs, stop; the ticket precondition is stale or wrong.

## Minimum GREEN

- canonicalize shared semantic event projections, compare required fields, and separately assert allowed identity/capability differences.
- Change only the owned symbols and the minimum supporting types explicitly listed in ownership.

## Acceptance ↔ tests

- AC-E9-003-1 ↔ `conformance/adapters/parity/parity.test.ts` case `lifecycle`.
- AC-E9-003-2 ↔ `conformance/adapters/parity/parity.test.ts` case `tool-error`.
- AC-E9-003-3 ↔ `conformance/adapters/parity/parity.test.ts` case `approval`.
- AC-E9-003-4 ↔ `conformance/adapters/parity/parity.test.ts` case `evidence`.
- AC-E9-003-5 ↔ `conformance/adapters/parity/parity.test.ts` case `intervention`.
- AC-E9-003-6 ↔ `conformance/adapters/parity/parity.test.ts` case `unavailable-difference`.
- AC-E9-003-7 ↔ `conformance/adapters/parity/parity.test.ts` case `profile-difference`.

## Verification

1. Focused: `npm run verify:adapter-parity`; every named case above passes.
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
