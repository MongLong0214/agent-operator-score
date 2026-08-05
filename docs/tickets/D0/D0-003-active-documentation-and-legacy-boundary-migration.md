# D0-003 · Active documentation and legacy boundary migration

- Status: **BLOCKED — ADR + PRD + TICKET CEO GATES REQUIRED**
- Epic: D0
- Milestone: S0 · Name & Contracts
- Owning PRD: [D0](../../prd/PRD-D0-name-migration-and-repository-skeleton.md)
- Size: M
- Dependencies: D0-001

## Goal

Active documentation and legacy boundary migration. Deliver only the bounded contract below; do not infer adjacent scope.

## Exact ownership

- README.md; AGENTS.md; CONTRIBUTING.md; .github/copilot/*.md; .github/ISSUE_TEMPLATE/*.yml; docs/north-star/legacy/**
- No other file or symbol may be edited without a replacement ticket and renewed gate.

## Preconditions

1. Required ADRs and owning PRD are explicitly accepted at their exact digests.
2. This exact ticket is explicitly accepted and an execution packet pins the base SHA.
3. Every dependency above is verified complete on the target branch; active/partial work does not count.
4. Worktree is clean or unrelated owner changes are identified and protected.

## Forbidden scope

- deleting history; editing legacy substance; claiming implemented CLI
- No fallback that weakens evidence, identity, safety, privacy, or terminal-state semantics.
- No edits to another ticket's owned files, no dependency upgrade unless owned here, and no public claim.

## RED contract

- Test file: `tests/planning/document-surface.test.mjs`
- Focused command: `npm test -- tests/planning/document-surface.test.mjs`
- Expected pre-GREEN failure: active documentation still names the legacy product and implemented/planned boundaries are inconsistent.
- Capture the exact failing test name and message before editing production-owned files. If the failure differs, stop; the ticket precondition is stale or wrong.

## Minimum GREEN

- rewrite active operator/developer surfaces from the final SSOT; archive old planning unchanged; add explicit current/planned labels.
- Change only the owned symbols and the minimum supporting types explicitly listed in ownership.

## Acceptance ↔ tests

- AC-D0-003-1 ↔ `tests/planning/document-surface.test.mjs` case `active-copy`.
- AC-D0-003-2 ↔ `tests/planning/document-surface.test.mjs` case `legacy-preserved`.
- AC-D0-003-3 ↔ `tests/planning/document-surface.test.mjs` case `link-integrity`.
- AC-D0-003-4 ↔ `tests/planning/document-surface.test.mjs` case `no-implemented-claim`.

## Verification

1. Focused: `npm test -- tests/planning/document-surface.test.mjs`; every named case above passes.
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
