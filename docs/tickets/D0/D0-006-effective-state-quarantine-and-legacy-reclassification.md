# D0-006 · v2 effective-state quarantine and legacy reclassification

- Status: **BLOCKED — OWNER-RATIFIED ONE-TIME GOVERNANCE REPAIR + CEO GATE REQUIRED**
- Epic: D0
- Milestone: S0 · Name & Contracts
- Owning PRD: [D0-GOV](../../prd/PRD-D0-GOV-authenticated-governance-repair.md)
- Size: M
- Dependencies: D0-005

## Goal

Non-destructively classify every existing v2 structurally `ACCEPTED` row as `LEGACY_UNAUTHENTICATED`, preserving source records and Git history while excluding those rows from authorization and artifact-freeze inputs.

## Exact ownership

- In `scripts/validate-gate-administration.mjs`, exactly existing `canonicalRegistryRelativePath`, `verifyCanonicalRegistry`, and `validateGateAdministration` plus new `deriveEffectiveGateState`; in `scripts/resolve-execution-state.mjs`, exactly existing `findAcceptedGate` and `evaluateTicketGates` plus new `applyEffectiveGateStateToGateFacts`; only new `effective_gate_state`, `effective_gate_state_reason`, `effectiveGateState`, and `effectiveGateStateRecord` definitions in `specs/execution-state.schema.v1.json`; `tests/gate-effective-state.test.mjs`; and `fixtures/governance/effective-state/**`.
- The future D0-006 allowlist/census edit is exactly the `controlPlaneAllowlist` literal in `scripts/validate-planning.mjs`, adding only `tests/gate-effective-state.test.mjs`; and both `acceptedValidatorOutput` and `pendingValidatorOutput` literals in `tests/planning-contract.test.mjs`, changing `control_plane_code_files=10` and `control_plane_allowlist=10` to `11` in each literal.
- The original `docs/decisions/maintainer-gate-registry.v2.json`, its rows, its approval values, digest values, transitions, and events are explicitly excluded.
- No other file or symbol may be edited without a replacement ticket and renewed gate.

## Preconditions

1. The owner-ratified one-time governance repair plus the CEO gate is the explicit authority basis for this exact packet. It authorizes bounded transitional planning-control-plane code and tests only; it conveys zero product-code authority, no readiness, no artifact acceptance, and no artifact freeze.
2. ADR-0013, D0-GOV, D0-005, and this exact ticket carry that same basis at their exact candidate digests; advisory mode cannot accept them. D0-005 is verified on `dev` before this ticket's RED.
3. The execution packet captures the exact bytes and SHA-256 of the v2 registry before RED and identifies every base-row whose structural status is `ACCEPTED`.
4. The packet derives the root-cause census from the v2 registry: all ten historical batches lack GitHub-authenticated approval, every `approved_by` is a role string, and all `prepared_by` values are unauthenticated locally-authored strings.
5. No concurrent owner changes the named checker, resolver, schema symbols, fixtures, or test path.

## Forbidden scope

- Editing the v2 registry or its historical records; adding an invalidation actor/event; replacing an approval string; changing Git history; or implying an original approval was genuine.
- Reusing any legacy digest as authorization or artifact freeze, including for the Node 22.18 correction.
- Product behavior, GitHub mutation, authenticated-review activation, or a permissive fallback for a missing/ambiguous v2 input.

## RED contract

- Test file: `tests/gate-effective-state.test.mjs`.
- Focused command: `node --test tests/gate-effective-state.test.mjs`.
- Stage only the named test and fixture before GREEN. Case `accepted-self-authored-row-is-legacy-unauthenticated` must fail with `effective state mismatch: actual ACCEPTED; required LEGACY_UNAUTHENTICATED`; case `legacy-unauthenticated-row-does-not-freeze-artifacts` must fail because the old result still contributes a freeze input.
- Capture the exact command, exit code, named failures, source-registry SHA-256, and fixture IDs before any GREEN edit. Any unrelated failure stops execution.

Expected pre-GREEN failure: `accepted-self-authored-row-is-legacy-unauthenticated` reports `effective state mismatch: actual ACCEPTED; required LEGACY_UNAUTHENTICATED`.

## Minimum GREEN

- Compute an effective state separate from immutable v2 record text. The census will cover every v2 base row with structural `ACCEPTED`; each such row without an authenticated GitHub approval fact resolves exactly to `LEGACY_UNAUTHENTICATED`.
- Preserve source byte identity and history; emit source record ID, source digest, structural state, effective state, and bounded reason. Do not write an invented event or actor.
- Exclude `LEGACY_UNAUTHENTICATED` from authorization, ready-set, and artifact-freeze calculations. The Node 22.18 correction requires its own v3-manifest and authenticated-review approval later; it receives no inherited effect.
- Missing, duplicate, unsafe, malformed, or unverified source input produces a bounded fail-closed result and no freeze.

## Acceptance ↔ tests

- AC-D0-006-1 ↔ `tests/gate-effective-state.test.mjs` case `accepted-self-authored-row-is-legacy-unauthenticated`.
- AC-D0-006-2 ↔ `tests/gate-effective-state.test.mjs` case `legacy-unauthenticated-row-does-not-freeze-artifacts`.
- AC-D0-006-3 ↔ `tests/gate-effective-state.test.mjs` case `effective-state-census-covers-every-accepted-row`.
- AC-D0-006-4 ↔ `tests/gate-effective-state.test.mjs` case `effective-state-missing-input-is-rejected`.
- AC-D0-006-5 ↔ `tests/gate-effective-state.test.mjs` case `effective-state-duplicate-input-is-rejected`.
- AC-D0-006-6 ↔ `tests/gate-effective-state.test.mjs` case `effective-state-unsafe-input-is-rejected`.
- AC-D0-006-7 ↔ `tests/gate-effective-state.test.mjs` case `effective-state-malformed-input-is-rejected`.
- AC-D0-006-8 ↔ `tests/gate-effective-state.test.mjs` case `effective-state-unverified-input-is-rejected`.

## Verification

1. RED: `node --test tests/gate-effective-state.test.mjs`; capture the named effective-state mismatch before GREEN.
2. Focused: `node --test tests/gate-effective-state.test.mjs`; `accepted-self-authored-row-is-legacy-unauthenticated`, `legacy-unauthenticated-row-does-not-freeze-artifacts`, `effective-state-census-covers-every-accepted-row`, `effective-state-missing-input-is-rejected`, `effective-state-duplicate-input-is-rejected`, `effective-state-unsafe-input-is-rejected`, `effective-state-malformed-input-is-rejected`, and `effective-state-unverified-input-is-rejected` all pass.
3. Full: `npm test`; zero failure and no unregistered skip.
4. Build/package: `npm run build` and `npm run docs:check`; both pass without changing the v2 registry.
5. Manual/live: compare the recorded pre/post v2 registry SHA-256; it must be byte-identical. `LIVE_NA` for external mutation.
6. Ownership: `git diff --check <base>...<head>` passes and excludes the v2 registry.

## Stop and escalation

- Stop on any proposal to modify a historical record, add a fake actor/event, infer authentication from text, or reuse a legacy digest.
- Stop if the baseline registry bytes, batch census, or source provenance cannot be determined. Escalate to ADR-0013; do not manufacture a migration result.

## Completion evidence

- Exact base/head; immutable source-registry SHA-256 before and after; per-row effective-state report; RED/focused/full/build/docs receipts; Node 22.18 non-approval assertion; ownership audit; exact-head review and CI.

## Invalidation

Any source-registry byte change, effective-state rule, fixture fact, resolver/schema change, Node 22.18 artifact change, runtime identity, or candidate-head change invalidates the affected evidence. It never retroactively edits history.
