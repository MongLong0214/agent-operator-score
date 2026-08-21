# D0-009 · Authenticated-review activation after live control verification

- Status: **BLOCKED — OWNER-RATIFIED ONE-TIME GOVERNANCE REPAIR + CEO GATE REQUIRED**
- Epic: D0
- Milestone: S0 · Name & Contracts
- Owning PRD: [D0-GOV](../../prd/PRD-D0-GOV-authenticated-governance-repair.md)
- Size: L
- Dependencies: D0-008

## Goal

Activate `AUTHENTICATED_REVIEW` only after live GitHub facts prove a second authenticated principal, a protected `dev`, dismissal of stale reviews, and prevention of administrator/user/team/app bypass. D0-009 will re-verify D0-008's author, reviewer, and merger as three distinct authenticated principals at activation; it will not inherit that condition from D0-008. Until every fact is current and verified, keep `SOLE_OWNER_ADVISORY` active and the ready set empty.

## Exact ownership

- Only `authenticated_review_activation` in `docs/decisions/governance-mode-contract.v1.json`; new `collectAuthenticatedReviewActivationFacts`, `evaluateAuthenticatedReviewActivation`, and `selectActiveGovernanceMode` plus the `resolveExecutionState` callsite in `scripts/resolve-execution-state.mjs`; only new `authenticated_review_activation` and `activation_blockers` definitions in `specs/execution-state.schema.v1.json`; D0-009's exact modification of D0-005's existing top-level `artifact_freeze` from `{ "const": null }` to `anyOf` null or `#/$defs/authenticatedArtifactFreeze`, with the non-null definition requiring `manifest_id`, `path`, `sha256`, `kind`, and `exact_head_sha`; `tests/authenticated-review-activation.test.mjs`; and `fixtures/governance/authenticated-review-activation/**`. The field may be non-null only when this ticket's live activation evaluation succeeds.
- The exact live GitHub read adapter is existing `createAuthenticatedGitHubTransport` in `scripts/resolve-execution-state.mjs`; it remains read-only. The only collector change is new `collectAuthenticatedReviewActivationFacts` called by existing `collectLiveExecutionFacts`, issuing only `GET /repos/{owner}/{repo}/branches/dev/protection`, `GET /repos/{owner}/{repo}/collaborators/{login}/permission`, `GET /repos/{owner}/{repo}/pulls/{number}`, and `GET /repos/{owner}/{repo}/pulls/{number}/reviews`. It receives no GitHub write token or mutation capability.
- The future D0-009 allowlist/census edit is exactly the `controlPlaneAllowlist` literal in `scripts/validate-planning.mjs`, adding only `tests/authenticated-review-activation.test.mjs`; and both `acceptedValidatorOutput` and `pendingValidatorOutput` literals in `tests/planning-contract.test.mjs`, changing `control_plane_code_files=15` and `control_plane_allowlist=15` to `16` in each literal.
- No v2 registry edit, v3 migration rewrite, artifact-manifest schema change, product code, GitHub setting mutation, or issue/label/body mutation is owned.

## Preconditions

1. The owner-ratified one-time governance repair plus the CEO gate is the explicit authority basis for this exact packet. It authorizes bounded transitional planning-control-plane code and tests only; it conveys zero product-code authority, no readiness, no artifact acceptance, and no artifact freeze.
2. ADR-0013, D0-GOV, D0-005 through D0-008, and this exact ticket carry that same basis at their exact candidate digests; advisory mode cannot accept them. D0-008 is verified on `dev` with its derivation still inactive before this ticket's RED.
3. The execution packet includes fresh live GitHub API receipts for repository identity, collaborator permissions, `GET /repos/{owner}/{repo}/branches/dev/protection`, the candidate PR, its reviews, and the candidate head. Fixture evidence is insufficient for activation.
4. The live facts prove at least two distinct stable GitHub User IDs with current eligible permissions: the PR author and an approving reviewer must differ, and the reviewer is the verified second principal rather than a role string or duplicated account.
5. The live protection response is `200`, requires at least one approving pull-request review, has `dismiss_stale_reviews=true`, has `require_last_push_approval=true`, enforces administrators, and has empty user/team/app pull-request bypass allowances. Missing, `404`, partial, or ambiguous branch-protection responses fail closed.
6. The candidate has an exact-head `APPROVED` review from the second principal after its latest head change; no stale, dismissed, bypassed, or self review counts.

## Forbidden scope

- Activating from static fixtures, comments, labels, issue state, registry strings, a sole owner, a role title, a stale review, an unprotected branch, or a bypassable configuration.
- Mutating repository collaborators, branch protection, reviews, check status, issues, labels, pull requests, or registry history; accepting administrator bypass; and silently retaining activation after a required fact disappears.
- Altering the Node 22.18 candidate or treating a legacy artifact digest as a freeze.

## RED contract

- Test file: `tests/authenticated-review-activation.test.mjs`.
- Focused command: `node --test tests/authenticated-review-activation.test.mjs`.
- Stage only the named test before GREEN. Case `activation-requires-second-principal-and-protected-dev` must fail with `authenticated review activation is inactive`; case `activation-stale-review-dismissal-required` must use a fixture in which every other activation fact is valid and only `dismiss_stale_reviews=false`, and must fail with `authenticated review activation is inactive: stale-review dismissal is required`.
- Capture the exact command, exit code, named failures, and a redacted live-fact availability receipt before changing the activation stanza or resolver/schema symbols. Any unrelated failure stops execution.

Expected pre-GREEN failure: `activation-requires-second-principal-and-protected-dev` reports `authenticated review activation is inactive`; `activation-stale-review-dismissal-required` reports `authenticated review activation is inactive: stale-review dismissal is required`.

## Minimum GREEN

- Enable the activation stanza only when all preconditions are evaluated from current live GitHub facts on the exact candidate head. Persist no mutable assertion that substitutes for a future live check.
- Re-verify D0-008's three-principal condition at activation: current stable author, reviewer, and merger IDs must be pairwise distinct authenticated principals. Do not inherit any prior derivation result. Require a distinct reviewer account with current eligible permission and exact-head approval; require `dev` protection with one or more approving reviews, stale-review dismissal, last-push approval, administrator enforcement, and zero user/team/app bypass allowances.
- Treat any changed head, review dismissal, absent/changed protection, permission loss, bypass allowance, unavailable endpoint, wrong target, duplicate/ambiguous identity, or artifact mismatch as fail closed: no activation, no authorization, no freeze, and advisory mode remains effective.
- `activation-stale-review-dismissal-required` starts from the passing activation fixture and mutates only `dismiss_stale_reviews` to `false`; it must report the pinned stale-review-dismissal failure, so no other protection field can make the negative pass incidentally.
- After activation, authorize only the separate downstream authenticated-review decision path bound to an exact v3 manifest and current GitHub facts. This ticket does not approve the Node 22.18 correction or any implementation ticket.

## Acceptance ↔ tests

- AC-D0-009-1 ↔ `tests/authenticated-review-activation.test.mjs` cases `activation-requires-second-principal-and-protected-dev` and `activation-revalidates-three-distinct-principals`.
- AC-D0-009-2 ↔ `tests/authenticated-review-activation.test.mjs` cases `activation-github-outage-fails-closed`, `activation-protection-404-fails-closed`, `activation-partial-protection-fails-closed`, `activation-permission-loss-fails-closed`, `activation-admin-enforcement-required`, `activation-last-push-approval-required`, `activation-user-bypass-fails-closed`, `activation-team-bypass-fails-closed`, `activation-app-bypass-fails-closed`, `activation-wrong-target-fails-closed`, `activation-identity-collision-fails-closed` and `activation-artifact-mismatch-fails-closed`.
- AC-D0-009-3 ↔ `tests/authenticated-review-activation.test.mjs` case `activation-stale-review-dismissal-required`.

## Verification

1. RED: `node --test tests/authenticated-review-activation.test.mjs`; capture the named activation failures before GREEN.
2. Focused: `node --test tests/authenticated-review-activation.test.mjs`; `activation-requires-second-principal-and-protected-dev`, `activation-revalidates-three-distinct-principals`, `activation-github-outage-fails-closed`, `activation-protection-404-fails-closed`, `activation-partial-protection-fails-closed`, `activation-permission-loss-fails-closed`, `activation-admin-enforcement-required`, `activation-last-push-approval-required`, `activation-user-bypass-fails-closed`, `activation-team-bypass-fails-closed`, `activation-app-bypass-fails-closed`, `activation-wrong-target-fails-closed`, `activation-identity-collision-fails-closed`, `activation-artifact-mismatch-fails-closed`, and `activation-stale-review-dismissal-required` all pass.
3. Full: `npm test`; zero failure and no unregistered skip.
4. Build/package: `npm run build` and `npm run docs:check`; both pass and report the activation decision without a fallback.
5. Manual/live: obtain fresh authenticated API receipts proving the second principal and every protected-`dev` invariant; exercise a new-head/stale-review fixture and confirm it blocks. No write API call is permitted.
6. Ownership: `git diff --check <base>...<head>` passes and the diff is restricted to **Exact ownership**.

## Stop and escalation

- Stop if the second principal is absent, the protected-branch endpoint is unavailable/404/partial, any bypass allowance exists, stale reviews are not dismissed, admin enforcement is absent, a reviewer equals the author, or a head/review/manifest fact is stale or ambiguous.
- Stop rather than weakening a control. Report the missing live fact to the maintainer; advisory remains the honest canonical state.

## Completion evidence

- Exact base/head; RED/focused/full/build/docs receipts; redacted live GitHub receipts for every activation invariant; protected-branch configuration digest; reviewer/author distinct-ID and permission report; stale-review/bypass negative results; no-write audit; ownership audit; exact-head review and CI.

## Invalidation

Any change to activation configuration, collaborator permission, principal identity, PR author/reviewer, review state, head, branch-protection setting, bypass allowance, v3 manifest, resolver/schema, runtime identity, or candidate head immediately invalidates activation and its authorization/freeze effect. The system falls back to `SOLE_OWNER_ADVISORY`, never to a permissive mode.
