# E4-002 · Implement Codex identity and capability discovery

- Status: **BLOCKED — ADR + PRD + TICKET MAINTAINER GATES REQUIRED**
- Epic: E4
- Milestone: S2 · Runner & Differentiated Wedge
- Owning PRD: [E4](../../prd/PRD-E4-codex-adapter.md)
- Size: L
- Dependencies: E4-001

## Goal

Implement Codex identity and capability discovery. Deliver only the bounded contract below; do not infer adjacent scope.

## Exact ownership

- adapters/codex/src/identity.ts — discoverCodexIdentity; adapters/codex/src/capabilities.ts — discoverCodexCapabilities
- No other file or symbol may be edited without a replacement ticket and renewed gate.

## Preconditions

1. Required ADRs and owning PRD are explicitly accepted at their exact digests.
2. This exact ticket is explicitly accepted and an execution packet pins the base SHA.
3. Every dependency above is verified complete on the target branch; active/partial work does not count.
4. Worktree is clean or unrelated owner changes are identified and protected.

## Forbidden scope

- invented revision; reading private unrelated config; experimental websocket; private database; undocumented logs; treating unknown as success
- No fallback that weakens evidence, identity, safety, privacy, or terminal-state semantics.
- No edits to another ticket's owned files, no dependency upgrade unless owned here, and no public claim.

## RED contract

- Test file: `adapters/codex/test/capabilities.test.ts`
- Focused command: `npm test -w @aos/adapter-codex -- capabilities`
- Expected pre-GREEN failure: unknown/missing identity, missing installed generated-schema digest, or a forbidden-source capability row appears complete.
- Capture the exact failing test name and message before editing production-owned files. If the failure differs, stop; the ticket precondition is stale or wrong.

## Minimum GREEN

- query only Codex app-server stdio JSON-RPC plus the exact installed generated schema, hash the permitted runtime/harness/tool profile, emit exact/limited/unknown identity, and persist the six-field capability digest with every capability source/effect.
- Change only the owned symbols and the minimum supporting types explicitly listed in ownership.

## Acceptance ↔ tests

- AC-E4-002-1 ↔ `adapters/codex/test/capabilities.test.ts` case `complete`.
- AC-E4-002-2 ↔ `adapters/codex/test/capabilities.test.ts` case `limited`.
- AC-E4-002-3 ↔ `adapters/codex/test/capabilities.test.ts` case `unknown`.
- AC-E4-002-4 ↔ `adapters/codex/test/capabilities.test.ts` case `missing-required`.
- AC-E4-002-5 ↔ `adapters/codex/test/capabilities.test.ts` case `config-redaction`.
- AC-E4-002-6 ↔ `adapters/codex/test/capabilities.test.ts` case `stable-digest`.
- AC-E4-002-7 ↔ `adapters/codex/test/capabilities.test.ts` case `installed-schema-digest`.
- AC-E4-002-8 ↔ `adapters/codex/test/capabilities.test.ts` case `forbidden-source`.

## Verification

1. Focused: `npm test -w @aos/adapter-codex -- capabilities`; every named case above passes.
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
