# D0-008 · Exact-head GitHub-review acceptance derivation, inactive

- Status: **BLOCKED — OWNER-RATIFIED ONE-TIME GOVERNANCE REPAIR + CEO GATE REQUIRED**
- Epic: D0
- Milestone: S0 · Name & Contracts
- Owning PRD: [D0-GOV](../../prd/PRD-D0-GOV-authenticated-governance-repair.md)
- Size: L
- Dependencies: D0-007

## Goal

Derive an observable exact-head acceptance candidate from authenticated GitHub pull-request and review facts, while keeping the derivation explicitly inactive. Before D0-009 activation it must never authorize RED, accept a gate, or freeze artifacts.

## Exact ownership

- `specs/github-acceptance-derivation.schema.v1.json` keys `schema_version`, `gate_pr`, `batch_id`, `exact_head_sha`, `target_branch`, `merge_commit_sha`, `manifest_digest`, `manifest_in_head`, `author_id`, `reviewer_id`, `merger_id`, `review_state`, `reviewer_permission`, and `activation`; new `deriveGitHubAcceptance` and `validateGitHubAcceptanceFacts` exports in `scripts/derive-github-acceptance.mjs`; `tests/github-acceptance-derivation.test.mjs`; and `fixtures/governance/github-acceptance/**`.
- The only observation-only resolver integration is existing `collectLiveExecutionFacts` plus new `collectGitHubAcceptanceFacts` and `resolveInactiveGitHubAcceptanceCandidate` in `scripts/resolve-execution-state.mjs`, and only new `inactive_authenticated_review_candidate` and `gate_accepted` definitions in `specs/execution-state.schema.v1.json`. D0-008 consumes D0-005's existing top-level `artifact_freeze` definition by asserting `result.artifact_freeze === null` while activation is false; it neither introduces nor modifies that schema definition.
- The future D0-008 allowlist/census edit is exactly the `controlPlaneAllowlist` literal in `scripts/validate-planning.mjs`, adding only `scripts/derive-github-acceptance.mjs` and `tests/github-acceptance-derivation.test.mjs`; and both `acceptedValidatorOutput` and `pendingValidatorOutput` literals in `tests/planning-contract.test.mjs`, changing `control_plane_code_files=13` and `control_plane_allowlist=13` to `15` in each literal.
- No activation configuration, branch-protection configuration, v2 registry record, GitHub mutation, or unrelated resolver logic is owned.

## Preconditions

1. The owner-ratified one-time governance repair plus the CEO gate is the explicit authority basis for this exact packet. It authorizes bounded transitional planning-control-plane code and tests only; it conveys zero product-code authority, no readiness, no artifact acceptance, and no artifact freeze.
2. ADR-0013, D0-GOV, D0-005 through D0-007, and this exact ticket carry that same basis at their exact candidate digests; advisory mode cannot accept them. D0-007 is verified on `dev` before this ticket's RED.
3. The v3 manifest validator and migration report are deterministic, contain identity and provenance only, and classify legacy rows as non-authorizing through derived effective-state input rather than a manifest field.
4. Fixture facts include distinct stable GitHub account IDs, current permissions, gate-PR author, reviewer, merger, exactly one `Gate-Batch`, merged gate-PR head, merge commit, `merged_by`, target branch, and artifact-manifest-in-head binding. No role string stands in for an identity.
5. The execution packet declares activation false and protects the D0-009-owned activation fields.

## Forbidden scope

- Enabling authenticated review; producing `READY_FOR_RED`; changing a registry row; freezing an artifact; merging/pushing/configuring GitHub; or accepting comments, labels, issue state, board, roadmap, or role strings as review facts.
- Fallback on GitHub outage, missing permission, changed head, duplicate review, malformed manifest, wrong base, or ambiguous actor identity.

## RED contract

- Test file: `tests/github-acceptance-derivation.test.mjs`.
- Focused command: `node --test tests/github-acceptance-derivation.test.mjs`.
- Stage only the named test before GREEN. Case `exact-head-authenticated-review-derives-pending-while-inactive` must fail with `ERR_MODULE_NOT_FOUND` for `scripts/derive-github-acceptance.mjs`; case `inactive-derivation-never-authorizes-or-freezes` must fail with the single pinned value `inactive derivation unexpectedly authorized RED or froze an artifact`.
- Capture the exact command, exit code, named failures, and declared inactive configuration before any GREEN edit. Any unrelated failure stops execution.

Expected pre-GREEN failure: `exact-head-authenticated-review-derives-pending-while-inactive` fails with `ERR_MODULE_NOT_FOUND` for `scripts/derive-github-acceptance.mjs`. `inactive-derivation-never-authorizes-or-freezes` fails with `inactive derivation unexpectedly authorized RED or froze an artifact`.

## Minimum GREEN

- Require a merged live/fixture gate PR targeting `dev`, exactly one `Gate-Batch: <batch_id>` field, the schema-valid v3 manifest in that gate PR's exact head, an authenticated merge commit reachable from `dev`, and an authenticated `merged_by` principal. Require an exact-head `APPROVED` review with current eligible permission; stable reviewer ID, gate-PR author ID, and merger ID are pairwise distinct. A changed head, stale/dismissed review, wrong target, unavailable fact, missing permission, duplicate fact, or ambiguous identity fails closed.
- Bind a positive derivation to exactly one schema-valid v3 artifact manifest and output provenance sufficient to audit the gate PR, batch ID, manifest-in-head proof, merge commit, merger, review, actor IDs, head, and manifest digest without secret values.
- When activation is false, emit an observable `INACTIVE_AUTHENTICATED_REVIEW_CANDIDATE` result only; keep ready set empty, `red_authorized=false`, gate acceptance false, and artifact freeze absent.
- Reuse the resolver's existing GitHub-fact transport boundary; do not parse free-form review comments or infer facts from locally committed strings.

## Acceptance ↔ tests

- AC-D0-008-1 ↔ `tests/github-acceptance-derivation.test.mjs` case `exact-head-authenticated-review-derives-pending-while-inactive`.
- AC-D0-008-2 ↔ `tests/github-acceptance-derivation.test.mjs` case `inactive-derivation-never-authorizes-or-freezes`.
- AC-D0-008-3 ↔ `tests/github-acceptance-derivation.test.mjs` cases `author-reviewer-collision-is-rejected`, `author-merger-collision-is-rejected`, `reviewer-merger-collision-is-rejected`, `wrong-base-is-rejected`, `malformed-manifest-is-rejected`, `stale-review-is-rejected`, `dismissed-review-is-rejected`, `wrong-target-is-rejected`, `github-outage-fails-closed`, `reviewer-permission-is-rejected`, `duplicate-gate-facts-are-rejected` and `ambiguous-principal-is-rejected`.

## Verification

1. RED: `node --test tests/github-acceptance-derivation.test.mjs`; capture the named missing-module failure before GREEN.
2. Focused: `node --test tests/github-acceptance-derivation.test.mjs`; `exact-head-authenticated-review-derives-pending-while-inactive`, `inactive-derivation-never-authorizes-or-freezes`, `author-reviewer-collision-is-rejected`, `author-merger-collision-is-rejected`, `reviewer-merger-collision-is-rejected`, `wrong-base-is-rejected`, `malformed-manifest-is-rejected`, `stale-review-is-rejected`, `dismissed-review-is-rejected`, `wrong-target-is-rejected`, `github-outage-fails-closed`, `reviewer-permission-is-rejected`, `duplicate-gate-facts-are-rejected`, and `ambiguous-principal-is-rejected` all pass.
3. Full: `npm test`; zero failure and no unregistered skip.
4. Build/package: `npm run build` and `npm run docs:check`; both pass with derivation observability but no authorization or freeze.
5. Manual/live: `LIVE_NA` — fixture-backed derivation only; live activation/configuration belongs to D0-009.
6. Ownership: `git diff --check <base>...<head>` passes and is restricted to **Exact ownership**.

## Stop and escalation

- Stop on a self-review, non-distinct account ID, stale/missing review, non-exact head, unauthenticated permission, malformed v3 manifest, external-state outage, or any attempt to activate the result.
- Escalate actual second-principal and branch-protection verification to D0-009. Do not broaden an inactive derivation into a live authorization path.

## Completion evidence

- Exact base/head; RED/focused/full/build/docs receipts; fixture provenance report; inactive-output report proving no ready/freeze effect; v3 manifest digest; ownership audit; exact-head review and CI.

## Invalidation

Any PR/review/permission/head/manifest fact, derivation schema, adapter, resolver integration, activation flag, runtime identity, or candidate-head change invalidates the affected evidence. A changed head always requires a new exact-head review.
