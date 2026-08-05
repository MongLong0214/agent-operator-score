# D0-002 · Repository and npm-workspace skeleton

- Status: **BLOCKED — ADR + PRD + TICKET MAINTAINER GATES REQUIRED**
- Epic: D0
- Milestone: S0 · Name & Contracts
- Owning PRD: [D0](../../prd/PRD-D0-name-migration-and-repository-skeleton.md)
- Size: M
- Dependencies: D0-001

## Goal

Create the real zero-product-code npm workspace skeleton required by the SSOT. Deliver only manifests, ownership markers, and deterministic planning tests; do not infer a CLI or package behavior.

## Exact ownership

- `package.json` except `scripts.test` owned by D0-001; `packages/{schema,scorer,runner,reporter}/package.json`; `adapters/{codex,claude-code}/package.json`; `suites/coding-core-v0/OWNERS.md`; `fixtures/OWNERS.md`; `conformance/OWNERS.md`; `docs/clearance/MINIMUM-NAME-CLEARANCE.md`; `tests/planning/workspace-skeleton.test.mjs`
- No other file or symbol may be edited without a replacement ticket and renewed gate.

## Preconditions

1. Required ADRs and owning PRD are explicitly accepted at their exact digests.
2. This exact ticket is explicitly accepted and an execution packet pins the base SHA.
3. Every dependency above is verified complete on the target branch; active/partial work does not count.
4. Worktree is clean or unrelated owner changes are identified and protected.

## Forbidden scope

- feature implementation; package entrypoints; dependencies; npm publication; build artifacts
- No fallback that weakens evidence, identity, safety, privacy, or terminal-state semantics.
- No edits to another ticket's owned files, no dependency upgrade unless owned here, and no public claim.

## RED contract

- Test file: `tests/planning/workspace-skeleton.test.mjs`
- Focused command: `npm test -- tests/planning/workspace-skeleton.test.mjs`
- Expected pre-GREEN failure: the required workspace manifests and ownership markers are missing, so no one-owner/zero-code package census can be proven.
- Capture the exact failing test name and message before editing production-owned files. If the failure differs, stop; the ticket precondition is stale or wrong.

## Minimum GREEN

- create a root manifest named `agent-operator-score` as the sole future publish candidate; keep it non-publishable until E14.
- create workspace manifests exactly at `packages/{schema,scorer,runner,reporter}` and `adapters/{codex,claude-code}` named `@aos/*`, each with `private: true`, no executable entrypoint, no dependencies, and no product source.
- retain engine range `>=20 <25`; reserve `aos` as a documented future CLI name without creating a runnable bin target.
- add one ownership marker per future package path and make every marker point to exactly one ticket/PRD owner.
- record the minimum GitHub/npm/domain/basic-trademark name-clearance evidence and explicit search limits; a missing or unresolved item blocks canonical-name adoption, not a legal opinion, LICENSE, contribution acceptance, redistribution, or publication authorization.
- Change only the owned symbols and the minimum supporting types explicitly listed in ownership.

## Acceptance ↔ tests

- AC-D0-002-1 ↔ `tests/planning/workspace-skeleton.test.mjs` case `workspace-census`: exact root/internal workspace names and paths exist.
- AC-D0-002-2 ↔ `tests/planning/workspace-skeleton.test.mjs` case `internal-workspaces-private`: every `@aos/*` manifest has `private: true`; only root is the publish candidate.
- AC-D0-002-3 ↔ `tests/planning/workspace-skeleton.test.mjs` case `one-owner-per-path`: each future package path has exactly one owner.
- AC-D0-002-4 ↔ `tests/planning/workspace-skeleton.test.mjs` case `product-code-zero`: manifest/source census finds no product code or runnable bin target.
- AC-D0-002-5 ↔ `tests/planning/workspace-skeleton.test.mjs` case `engine-matrix`: root engines remain `>=20 <25` and CI declares Node 20/22/24.
- AC-D0-002-6 ↔ `tests/planning/workspace-skeleton.test.mjs` case `minimum-name-clearance`: required evidence/search-limit fields are present and any unresolved state blocks canonical-name adoption without asserting formal legal, LICENSE, contribution, redistribution, or publication clearance.

## Verification

1. Focused: `npm test -- tests/planning/workspace-skeleton.test.mjs`; every named case above passes.
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
