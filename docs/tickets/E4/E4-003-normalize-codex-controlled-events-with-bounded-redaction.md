# E4-003 · Normalize Codex controlled events with bounded redaction

- Status: **BLOCKED — ADR + PRD + TICKET MAINTAINER GATES REQUIRED**
- Epic: E4
- Milestone: S2 · Runner & Differentiated Wedge
- Owning PRD: [E4](../../prd/PRD-E4-codex-adapter.md)
- Size: L
- Dependencies: E4-002

## Goal

Normalize Codex controlled events with bounded redaction. Deliver only the bounded contract below; do not infer adjacent scope.

## Exact ownership

- adapters/codex/src/normalize.ts — normalizeCodexEvent; adapters/codex/src/redact.ts — redactCodexPayload; adapters/codex/src/wrapper.ts — runCodexControlled
- No other file or symbol may be edited without a replacement ticket and renewed gate.

## Preconditions

1. Required ADRs and owning PRD are explicitly accepted at their exact digests.
2. This exact ticket is explicitly accepted and an execution packet pins the base SHA.
3. Every dependency above is verified complete on the target branch; active/partial work does not count.
4. Worktree is clean or unrelated owner changes are identified and protected.

## Forbidden scope

- chain-of-thought; raw secrets; unbounded logs; guessed clarification/approval
- No fallback that weakens evidence, identity, safety, privacy, or terminal-state semantics.
- No edits to another ticket's owned files, no dependency upgrade unless owned here, and no public claim.

## RED contract

- Test file: `adapters/codex/test/normalize.test.ts`
- Focused command: `npm test -w @aos/adapter-codex -- normalize`
- Expected pre-GREEN failure: native/wrapper inputs can leak canaries or omit required correlation.
- Capture the exact failing test name and message before editing production-owned files. If the failure differs, stop; the ticket precondition is stale or wrong.

## Minimum GREEN

- map declared lifecycle/user/tool/evidence/approval/intervention events and all four actor-attribution events, bound excerpts, redact values, preserve errors and correlations, and never synthesize attribution from an unsupported source.
- Change only the owned symbols and the minimum supporting types explicitly listed in ownership.

## Acceptance ↔ tests

- AC-E4-003-1 ↔ `adapters/codex/test/normalize.test.ts` case `event-parity`.
- AC-E4-003-2 ↔ `adapters/codex/test/normalize.test.ts` case `secret-canary`.
- AC-E4-003-3 ↔ `adapters/codex/test/normalize.test.ts` case `oversized`.
- AC-E4-003-4 ↔ `adapters/codex/test/normalize.test.ts` case `unknown-native`.
- AC-E4-003-5 ↔ `adapters/codex/test/normalize.test.ts` case `missing-parent`.
- AC-E4-003-6 ↔ `adapters/codex/test/normalize.test.ts` case `tool-error`.
- AC-E4-003-7 ↔ `adapters/codex/test/normalize.test.ts` case `actor-attribution-events`.

## Verification

1. Focused: `npm test -w @aos/adapter-codex -- normalize`; every named case above passes.
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
