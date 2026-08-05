# E14-001 · Complete license notices and security clearance

- Status: **BLOCKED — ADR + PRD + TICKET MAINTAINER GATES REQUIRED**
- Epic: E14
- Milestone: S5 · Public OSS
- Owning PRD: [E14](../../prd/PRD-E14-public-oss-and-g4.md)
- Size: L
- Dependencies: E13-002

## Goal

Complete formal publication, license, notices, and security clearance. Minimum name clearance is a D0 input and cannot be repeated or substituted here. Deliver only the bounded contract below; do not infer adjacent scope.

## Exact ownership

- docs/clearance/PUBLICATION-LEGAL-CLEARANCE.md; LICENSE; THIRD_PARTY_NOTICES.md; SECURITY.md; docs/decisions/PUBLICATION-CLEARANCE.md
- No other file or symbol may be edited without a replacement ticket and renewed gate.

## Preconditions

1. Required ADRs and owning PRD are explicitly accepted at their exact digests.
2. This exact ticket is explicitly accepted and an execution packet pins the base SHA.
3. Every dependency above is verified complete on the target branch; active/partial work does not count.
4. Worktree is clean or unrelated owner changes are identified and protected.

## Forbidden scope

- performing or substituting minimum name clearance; choosing license without review; treating search as trademark opinion; public visibility change
- No fallback that weakens evidence, identity, safety, privacy, or terminal-state semantics.
- No edits to another ticket's owned files, no dependency upgrade unless owned here, and no public claim.

## RED contract

- Test file: `tests/publication/clearance.test.mjs`
- Focused command: `npm test -- tests/publication/clearance.test.mjs`
- Expected pre-GREEN failure: publication can proceed without resolved identity/legal/security fields.
- Capture the exact failing test name and message before editing production-owned files. If the failure differs, stop; the ticket precondition is stale or wrong.

## Minimum GREEN

- verify the D0 minimum-name-clearance input remains unresolved or present without treating it as legal advice; select license/contributor terms, enumerate dependencies/notices and disclosure policy, complete formal publication/legal review, and emit a blocking verdict when any required input is unresolved.
- Change only the owned symbols and the minimum supporting types explicitly listed in ownership.

## Acceptance ↔ tests

- AC-E14-001-1 ↔ `tests/publication/clearance.test.mjs` case `d0-name-input`.
- AC-E14-001-2 ↔ `tests/publication/clearance.test.mjs` case `license`.
- AC-E14-001-3 ↔ `tests/publication/clearance.test.mjs` case `notices`.
- AC-E14-001-4 ↔ `tests/publication/clearance.test.mjs` case `contributor`.
- AC-E14-001-5 ↔ `tests/publication/clearance.test.mjs` case `security`.
- AC-E14-001-6 ↔ `tests/publication/clearance.test.mjs` case `unresolved-block`.

## Verification

1. Focused: `npm test -- tests/publication/clearance.test.mjs`; every named case above passes.
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
