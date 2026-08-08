# E4-001 · Define runtime adapter interface and controlled wrapper lifecycle

- Status: **BLOCKED — ADR + PRD + TICKET MAINTAINER GATES REQUIRED**
- Epic: E4
- Milestone: S2 · Runner & Differentiated Wedge
- Owning PRD: [E4](../../prd/PRD-E4-codex-adapter.md)
- Size: L
- Dependencies: E3-004

## Goal

Define runtime adapter interface and controlled wrapper lifecycle. Deliver only the bounded contract below; do not infer adjacent scope.

## Exact ownership

- packages/runner/src/adapter.ts — RuntimeAdapter,AdapterSession; adapters/codex/src/index.ts — CodexAdapter
- No other file or symbol may be edited without a replacement ticket and renewed gate.

## Preconditions

1. Required ADRs and owning PRD are explicitly accepted at their exact digests.
2. This exact ticket is explicitly accepted and an execution packet pins the base SHA.
3. Every dependency above is verified complete on the target branch; active/partial work does not count.
4. Worktree is clean or unrelated owner changes are identified and protected.

## Forbidden scope

- Claude implementation; scorer coupling; native-specific public schema; any source outside Codex app-server stdio JSON-RPC and the exact installed generated schema/digest
- No fallback that weakens evidence, identity, safety, privacy, or terminal-state semantics.
- No edits to another ticket's owned files, no dependency upgrade unless owned here, and no public claim.

## RED contract

- Test file: `adapters/codex/test/interface.test.ts`
- Focused command: `npm test -w @aos/adapter-codex -- interface`
- Expected pre-GREEN failure: runner and adapter have no total lifecycle/error/capability contract.
- Capture the exact failing test name and message before editing production-owned files. If the failure differs, stop; the ticket precondition is stale or wrong.

## Minimum GREEN

- define discover/start/event/stop/cancel/capabilities/digest methods, typed errors, wrapper correlation and bounded event sink. The Codex v0 interface permits only app-server stdio JSON-RPC and the exact installed generated-schema digest; capability digest includes runtime version, protocol/schema version, adapter version, source class, supported event groups, and known missing events.
- Change only the owned symbols and the minimum supporting types explicitly listed in ownership.

## Acceptance ↔ tests

- AC-E4-001-1 ↔ `adapters/codex/test/interface.test.ts` case `lifecycle-happy`.
- AC-E4-001-2 ↔ `adapters/codex/test/interface.test.ts` case `start-fail`.
- AC-E4-001-3 ↔ `adapters/codex/test/interface.test.ts` case `stop-timeout`.
- AC-E4-001-4 ↔ `adapters/codex/test/interface.test.ts` case `double-stop`.
- AC-E4-001-5 ↔ `adapters/codex/test/interface.test.ts` case `capability-digest`.
- AC-E4-001-6 ↔ `adapters/codex/test/interface.test.ts` case `primary-source-boundary`.

## Verification

1. Focused: `npm test -w @aos/adapter-codex -- interface`; every named case above passes.
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
