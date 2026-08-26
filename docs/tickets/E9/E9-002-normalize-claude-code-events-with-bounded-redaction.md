# E9-002 · Normalize Claude Code events with bounded redaction

- Status: **BLOCKED — ADR + PRD + TICKET MAINTAINER GATES REQUIRED**
- Epic: E9
- Milestone: S3 · Full Form A & Second Runtime
- Owning PRD: [E9](../../prd/PRD-E9-claude-code-adapter-and-parity.md)
- Size: L
- Dependencies: E9-001

## Goal

Normalize Claude Code events with bounded redaction. Deliver only the bounded contract below; do not infer adjacent scope.

## Exact ownership

- adapters/claude-code/src/normalize.ts — normalizeClaudeEvent; adapters/claude-code/src/redact.ts — redactClaudePayload
- No other file or symbol may be edited without a replacement ticket and renewed gate.

## Preconditions

1. Required ADRs and owning PRD are explicitly accepted at their exact digests.
2. This exact ticket is explicitly accepted and an execution packet pins the base SHA.
3. Every dependency above is verified complete on the target branch; active/partial work does not count.
4. Worktree is clean or unrelated owner changes are identified and protected.

## Forbidden scope

- invented delegation join; raw prompts/secrets; unbounded logs; silent event synthesis
- No fallback that weakens evidence, identity, safety, privacy, or terminal-state semantics.
- No edits to another ticket's owned files, no dependency upgrade unless owned here, and no public claim.

## RED contract

- Test file: `adapters/claude-code/test/normalize.test.ts`
- Focused command: `npm test -w @aos/adapter-claude-code -- normalize`
- Expected pre-GREEN failure: native/hook/wrapper inputs lack vendor-neutral bounded mapping.
- Capture the exact failing test name and message before editing production-owned files. If the failure differs, stop; the ticket precondition is stale or wrong.

## Minimum GREEN

- normalize declared lifecycle/user/tool/context/retrieval/delegation/evidence/approval/intervention events and all four actor-attribution events from permitted sources only; emit `UNAVAILABLE` where proof is absent and never synthesize attribution.
- Change only the owned symbols and the minimum supporting types explicitly listed in ownership.

## Acceptance ↔ tests

- AC-E9-002-1 ↔ `adapters/claude-code/test/normalize.test.ts` case `semantic-events`.
- AC-E9-002-2 ↔ `adapters/claude-code/test/normalize.test.ts` case `delegation-gap`.
- AC-E9-002-3 ↔ `adapters/claude-code/test/normalize.test.ts` case `secret-canary`.
- AC-E9-002-4 ↔ `adapters/claude-code/test/normalize.test.ts` case `oversized`.
- AC-E9-002-5 ↔ `adapters/claude-code/test/normalize.test.ts` case `missing-parent`.
- AC-E9-002-6 ↔ `adapters/claude-code/test/normalize.test.ts` case `tool-error`.
- AC-E9-002-7 ↔ `adapters/claude-code/test/normalize.test.ts` case `actor-attribution-events`.

## Verification

1. Focused: `npm test -w @aos/adapter-claude-code -- normalize`; every named case above passes.
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
