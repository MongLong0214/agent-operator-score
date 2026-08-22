# E1-004 · Carry the write target outside the redaction bound

- Status: **BLOCKED — ADR + PRD + TICKET MAINTAINER GATES REQUIRED**
- Epic: E1
- Milestone: S1 · G0 Scorer Truth
- Owning PRD: [E1](../../prd/PRD-E1-trace-and-result-schemas.md)
- Size: M
- Dependencies: E1-001,E1-003

## Goal

Carry the write target as a canonical event field outside the bounded payload excerpt, so redaction cannot destroy actor attribution. Deliver only the bounded contract below; do not infer adjacent scope.

## Why this is its own ticket

Two consumers of `payload` required shapes that exclude each other. The canonical schema requires a bounded string or null; the workspace classifier reads named object fields; and above the 2048-character bound the redaction step serializes the object and slices it, producing a string the classifier never parses. Measured: a write of 2013 characters of contents is attributed, and 2014 is `actor.attribution_unknown` with the score withheld. SSOT §9.2 attribution therefore stops existing above roughly 2 KiB, and a normalized adapter event does not validate against the frozen contract at all.

Correcting that reissues frozen evidence — the G0 digest manifest, the canonical vector corpus, and the schema conformance fixtures — which is why it cannot ride as a contributing merge on E1-001, E3-001 or E9-002. Those tickets are complete and their gates were accepted against the current shape.

Gate dependencies are the two E1 tickets whose contracts this extends. The change also edits files
owned by E3-001 and E9-002 — both `verified` — but that is ownership, declared below, not a gate
dependency: declaring a cross-epic edge would require a PRD basis PRD-E1 does not carry, and
PRD-E1 is pinned by an ACCEPTED batch.

## Exact ownership

- specs/aos-trace.schema.json; specs/events.v0.json; packages/schema/src/trace.ts — parseTraceEvent; adapters/claude-code/src/normalize.ts — normalizeClaudeEvent; adapters/claude-code/src/redact.ts — redactClaudePayload; packages/runner/src/workspace.ts — classifyWorkspaceMutation; scripts/verify-g0.mjs — G0_DIGEST_MANIFEST,G0_DIGEST_MANIFEST_SHA256; scripts/schema-conformance.mjs — the recorded schema digests only
- packages/schema/test/trace-schema.test.ts; adapters/claude-code/test/normalize.test.ts; packages/runner/test/workspace.test.ts
- No other file or symbol may be edited without a replacement ticket and renewed gate.

## Preconditions

1. Required ADRs and owning PRD are explicitly accepted at their exact digests.
2. This exact ticket is explicitly accepted and an execution packet pins the base SHA.
3. Every dependency above is verified complete on the target branch; active/partial work does not count.
4. Worktree is clean or unrelated owner changes are identified and protected.

## Forbidden scope

- widening the payload bound; guessing a target the event does not carry; an absolute or traversing target
- No fallback that weakens evidence, identity, safety, privacy, or terminal-state semantics.
- No edits to another ticket's owned files, no dependency upgrade unless owned here, and no public claim.

## RED contract

- Test file: `packages/runner/test/workspace.test.ts`
- Focused command: `npm test -w @aos/runner -- workspace`
- Expected pre-GREEN failure: a write past the bounded payload excerpt loses its target and is attributed to nobody.
- Capture the exact failing test name and message before editing production-owned files. If the failure differs, stop; the ticket precondition is stale or wrong.

## Minimum GREEN

- carry `target_path` as an allowed canonical event field, validated as a workspace-relative path when present; keep `payload` a bounded string or null; set the target outside the excerpt so truncation cannot remove it; classify from the field; and reissue the digest manifest entries the schema change moves.
- Change only the owned symbols and the minimum supporting types explicitly listed in ownership.

## Acceptance ↔ tests

- AC-E1-004-1 ↔ `packages/schema/test/trace-schema.test.ts` case `target-path`.
- AC-E1-004-2 ↔ `adapters/claude-code/test/normalize.test.ts` case `normalized-trace-contract`.
- AC-E1-004-3 ↔ `packages/runner/test/workspace.test.ts` case `attribution-survives-the-payload-bound`.

## Verification

1. Focused: `npm test -w @aos/runner -- workspace`; every named case above passes.
2. Full: `npm test`; zero failure, skip only when preregistered by this ticket.
3. Build/package: `npm run build`; zero warning promoted by policy and deterministic artifact manifest where applicable.
4. Manual/live: `LIVE_NA`.
5. Ownership: inspect `git diff --name-only <base>...<head>` and reject every unowned path.

## Stop and escalation

- Stop on ambiguity, wrong target, ownership overlap, missing required observability, unsafe permission, secret exposure, silent fallback, timeout without a registered terminal state, partial state, nondeterminism, or evidence not tied to exact head.
- A dependency or contract defect is escalated to its owning ADR/PRD/ticket; do not broaden this ticket.

## Completion evidence

- Exact base/head SHA and diff manifest.
- RED receipt with expected reason; GREEN focused/full/build receipts.
- Acceptance-to-test result table, artifact/schema/scorer digests where produced, and manual/LIVE_NA rationale.
- The measured attribution table across the bound, showing the size at which attribution previously stopped and that it no longer does.
- Security/privacy/fail-closed/wrong-target/timeout/partial-state review and stale-evidence invalidation statement.
- Exact-head cumulative reviewer verdict and CI receipt before merge eligibility.

## Invalidation

Any change to this ticket, its PRD/ADR dependencies, owned sources, test oracle, fixture manifest, package lock, runtime identity, or candidate head invalidates the affected evidence and returns the lane to the earliest changed gate.
