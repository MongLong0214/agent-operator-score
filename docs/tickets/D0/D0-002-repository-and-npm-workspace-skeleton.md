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

- `package.json` except `scripts.test` owned by D0-001; `package-lock.json` root package record; `packages/{schema,scorer,runner,reporter}/package.json`; `adapters/{codex,claude-code}/package.json`; `suites/coding-core-v0/OWNERS.md`; `fixtures/OWNERS.md`; `conformance/OWNERS.md`; `docs/clearance/MINIMUM-NAME-CLEARANCE.md`; `tests/planning/workspace-skeleton.test.mjs`.
- Narrow temporary carve-out from D0-004 to D0-002 only: in `scripts/validate-planning.mjs`, add only `tests/planning/workspace-skeleton.test.mjs` to `controlPlaneAllowlist`; in `tests/planning-contract.test.mjs`, update only the expected `control_plane_code_files=6` to `control_plane_code_files=7` and `control_plane_allowlist=6` to `control_plane_allowlist=7` literals in each of `acceptedValidatorOutput` and `pendingValidatorOutput`, as required by that one insertion. D0-004's exact ownership excludes these symbols while this carve-out applies. No other symbol or file change is permitted by this carve-out.
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
- Required pre-GREEN staging: add only this named test module before every GREEN-owned edit, then run the canonical focused command and full `npm test` lane; do not substitute a reduced pre-existing test selection.
- Expected pre-GREEN failure: Case `workspace-census` must fail with the bounded root-name/missing-manifest failure: root `package.json` is `agent-operator-score-repository` rather than required `agent-operator-score`, and the required workspace manifests are missing.
- The only permitted companion failures from that staging are the planning validator's unallowlisted-test-path failure and the `acceptedValidatorOutput` and `pendingValidatorOutput` planning-contract mismatches, each caused only by the staged file raising both expected census/allowlist literals from `6` to `7`. Any other failure stops execution; these companions are not alternate RED evidence.
- Capture the exact primary `workspace-census` missing-manifest failure and only those authorized companion names/messages before editing manifests, ownership markers, the package lock, or the D0-004 carve-out symbols. After this RED receipt, the planner allowlist and both required census updates are mandatory GREEN edits. If `workspace-census` does not fail for the exact bounded root-name/missing-manifest behavior, stop; the ticket precondition is stale or wrong.

## Minimum GREEN

- create a root manifest named `agent-operator-score` as the sole future publish candidate; keep it non-publishable until E14, and update the `package-lock.json` root package record to the same name.
- create workspace manifests exactly at `packages/{schema,scorer,runner,reporter}` and `adapters/{codex,claude-code}` named `@aos/schema`, `@aos/scorer`, `@aos/runner`, `@aos/reporter`, `@aos/adapter-codex`, and `@aos/adapter-claude-code`, respectively; each is `private: true`, has no executable entrypoint or dependencies, and contains no product source.
- retain engine range `>=20 <25`; reserve `aos` as a documented future CLI name without creating a runnable bin target.
- add one ownership marker per future package path and make every marker point to exactly one owner: ticket `D0-002` and PRD `PRD-D0-name-migration-and-repository-skeleton`.
- record the minimum GitHub/npm/domain/basic-trademark name-clearance evidence with exactly `source`, `query`, `searched_at`, `result`, `limits`, and `status`; no `checked_at`, `channel`, or `source_url` field is permitted unless a separately accepted authority requires it. Any `status` other than `CLEAR` blocks canonical-name adoption; this is not a legal opinion, LICENSE, contribution acceptance, redistribution, or publication authorization.
- apply the narrow D0-004 planner allowlist and census carve-out only after the required RED receipt.
- Change only the owned symbols and the minimum supporting types explicitly listed in ownership.

## Acceptance ↔ tests

- AC-D0-002-1 ↔ `tests/planning/workspace-skeleton.test.mjs` case `workspace-census`: exact root/internal workspace names and paths exist.
- AC-D0-002-2 ↔ `tests/planning/workspace-skeleton.test.mjs` case `internal-workspaces-private`: every `@aos/*` manifest has `private: true`; only root is the publish candidate.
- AC-D0-002-3 ↔ `tests/planning/workspace-skeleton.test.mjs` case `one-owner-per-path`: each future package path has exactly one owner.
- AC-D0-002-4 ↔ `tests/planning/workspace-skeleton.test.mjs` case `product-code-zero`: manifest/source census finds no product code or runnable bin target.
- AC-D0-002-5 ↔ `tests/planning/workspace-skeleton.test.mjs` case `engine-matrix`: root engines remain `>=20 <25` and CI declares Node 20/22/24.
- AC-D0-002-6 ↔ `tests/planning/workspace-skeleton.test.mjs` case `minimum-name-clearance`: each record has exactly `source`, `query`, `searched_at`, `result`, `limits`, and `status`; no alternate field is accepted without separate authority, and every status other than `CLEAR` blocks canonical-name adoption without asserting formal legal, LICENSE, contribution, redistribution, or publication clearance.
- AC-D0-002-7 ↔ `tests/planning/workspace-skeleton.test.mjs` case `workspace-lock-consistency`: the root manifest and `package-lock.json` root package record are both named `agent-operator-score`.

## Verification

1. Install/lock: `npm ci` is mandatory and succeeds with the workspace lock consistent with the root manifest.
2. Focused: `npm test -- tests/planning/workspace-skeleton.test.mjs`; every named case above passes.
3. Full: `npm test`; zero failure, skip only when preregistered by this ticket.
4. Build/package: `npm run build`; zero warning promoted by policy and deterministic artifact manifest where applicable.
5. Planning/gate: `npm run docs:check` and `node scripts/validate-gate-administration.mjs` pass on the rebased exact candidate head.
6. CI: required exact-head CI passes after the rebase; a receipt from any prior head is stale.
7. Manual/live: `LIVE_NA` unless the ticket explicitly owns a runtime/scenario surface; for runtime/scenario tickets run only the controlled local fixture named by the PRD, never a production target.
8. Ownership: inspect `git diff --name-only <base>...<head>` and reject every unowned path; the correction handoff contains exactly this ticket file and no merge.

## Stop and escalation

- Stop on ambiguity, wrong target, ownership overlap, missing required observability, unsafe permission, secret exposure, silent fallback, timeout without a registered terminal state, partial state, nondeterminism, or evidence not tied to exact head.
- A dependency or contract defect is escalated to its owning ADR/PRD/ticket; do not broaden this ticket.

## Completion evidence

- Exact base/head SHA and diff manifest.
- RED receipt with the required primary failure and only the authorized companions; GREEN focused/full/build/planning/gate receipts.
- Acceptance-to-test result table, artifact/schema/scorer digests where produced, and manual/LIVE_NA rationale.
- Security/privacy/fail-closed/wrong-target/timeout/partial-state review and stale-evidence invalidation statement.
- Exact-head cumulative reviewer verdict and CI receipt before merge eligibility.

## Invalidation

Any change to this ticket, its PRD/ADR dependencies, owned sources, test oracle, fixture manifest, package lock, runtime identity, or candidate head invalidates the affected evidence and returns the lane to the earliest changed gate.
