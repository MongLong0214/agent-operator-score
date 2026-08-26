# D0-005 · Governance mode contract and advisory boundary

- Status: **BLOCKED — OWNER-RATIFIED ONE-TIME GOVERNANCE REPAIR + CEO GATE REQUIRED**
- Epic: D0
- Milestone: S0 · Name & Contracts
- Owning PRD: [D0-GOV](../../prd/PRD-D0-GOV-authenticated-governance-repair.md)
- Size: M
- Dependencies: None

## Goal

D0-005 will supersede D0-004's single-owner policy and planning-validator authority source. It will establish `SOLE_OWNER_ADVISORY` as the canonical governance fact, remove the repository's separation-of-duties claim while that mode applies, and define without activating `AUTHENTICATED_REVIEW`. Until D0-005 passes its own artifact gate, D0-004 remains the operational authority; this successor routes the five numeric catalog records through the existing normal authority checks without changing governance mode, authorization, or artifact-freeze effect.

## Exact ownership

- The bullet below restates, in the form the ownership census reads, exactly the paths this section already names. It adds no scope.
- scripts/resolve-execution-state.mjs — as declared above; tests/governance-mode-contract.test.mjs — as declared above; scripts/validate-planning.mjs — as declared above; tests/planning-contract.test.mjs — as declared above; tests/execution-state.test.mjs — as declared above
- The future D0-005 mode-contract surface is exactly `docs/decisions/governance-mode-contract.v1.json` keys `version`, `modes`, `current_mode`, `authenticated_review_activation`, and `claims_separation_of_duties`; existing `expectedActorPolicyFromTicket`, `actorPolicyAgrees`, `finalize`, `emptyFailureState`, and `resolveExecutionState` plus new `loadGovernanceModeContract`, `parseGovernanceModeContract`, and `resolveGovernanceModeResult` in `scripts/resolve-execution-state.mjs`; only `governance_mode`, `claims_merge_authorization`, `readySet`, `claims_separation_of_duties`, and the one new top-level `artifact_freeze` result definition in `specs/execution-state.schema.v1.json`; the top-level `operational_authority` object in `docs/issues.json`; headings `Purpose and boundary`, `Roles and separate acceptance`, and `Non-authorizations and invalidation` in `docs/decisions/PRE-IMPLEMENTATION-GATE-ADMINISTRATION.md`; and `tests/governance-mode-contract.test.mjs`. D0-005 introduces `artifact_freeze` exactly once as a required top-level `{ "const": null }` property. D0-008 only consumes that property by asserting `result.artifact_freeze === null` while its derivation is inactive. D0-009 alone may modify this existing property to `anyOf` null or `#/$defs/authenticatedArtifactFreeze`, whose non-null object requires `manifest_id`, `path`, `sha256`, `kind`, and `exact_head_sha`; it may be non-null only after that ticket's live activation evaluation succeeds.
- `red_authorized` remains only `tickets.<ticket_id>.red_authorized` through the existing `$defs.ticketState` definition; D0-005 creates neither a top-level `red_authorized` nor an `implementation_authorized` field. For this ticket, non-authorization for implementation is represented only by the per-ticket tuple `red_authorized=false`, `readiness!="ready"`, `phase!="ready_for_red"`, and `packet=null`.
- The future D0-005 supersession of D0-004's policy and planning-validator authority source is exactly existing `operationalPolicyText`, `operationalPolicy`, and their `stableJson` equality check in `scripts/validate-planning.mjs`; existing cases `D0-004 single-owner policy does not require a nonexistent external actor` and `operational-authority-schema-and-ticket-agreement` in `tests/planning-contract.test.mjs`; the D0-GOV row in `docs/prd/INDEX.md`; D0-005 through D0-009 rows in `docs/tickets/BOARD.md`; the serial-foundation line in `docs/planning/AOS-EXECUTION-ROADMAP.md`; and `prds` D0-GOV `ticket_ids`, `planned_tests`, and `ticket_acceptance_bindings` in `docs/TRACEABILITY.md`. This packet does not make that supersession live.
- The future D0-005 allowlist/census edit is exactly the `controlPlaneAllowlist` literal in `scripts/validate-planning.mjs`, adding only `tests/governance-mode-contract.test.mjs`; and both `acceptedValidatorOutput` and `pendingValidatorOutput` literals in `tests/planning-contract.test.mjs`, changing `control_plane_code_files=9` and `control_plane_allowlist=9` to `10` in each literal.
- The post-removal issue-binding surface is exactly `isPositiveIssueNumber`, `collectTestCaseNames`, the `issueMap` parser, `manifestRecordsById`, and `validateNumericBindings` with its `issue map` and `issue manifest` callsites in `scripts/validate-planning.mjs`; `validateFactsCorpus`, `resolveOneTicket`, `collectLiveExecutionFacts`, and the `activeOwnership` filter in `scripts/resolve-execution-state.mjs`; the five `issue` and `kind` fields plus body templates in `docs/issues.json`; the five rows and opening rule in `docs/GITHUB-ISSUE-MAP.md`; requirement 6 and AC-D0-GOV-9 in `docs/prd/PRD-D0-GOV-authenticated-governance-repair.md`; the serial-foundation line in `docs/planning/AOS-EXECUTION-ROADMAP.md`; `all-issue-bindings-are-numeric-and-unique` in `tests/planning-contract.test.mjs`; `executable-ticket-still-requires-authority` in `tests/execution-state.test.mjs`; and their matching planned-test and D0-005 acceptance bindings in `docs/TRACEABILITY.md`. Each of the five catalog records is an `executable` ticket with a numeric issue identity; normal gate evaluation remains the sole route to readiness.
- The inherited D0-004 ownership is superseded for exactly those named policy and planning-validator authority symbols and fields; it is a supersession, not a dependency. No other D0-004 or Gate Administration surface is granted.
- No other file or symbol may be edited without a replacement ticket and renewed gate.

## Preconditions

1. The owner-ratified one-time governance repair plus the CEO gate is recorded as the explicit authority basis for this exact packet. It authorizes bounded transitional planning-control-plane code and tests only; it conveys zero product-code authority, no readiness, no artifact acceptance, and no artifact freeze.
2. ADR-0013, D0-GOV, and this exact ticket carry that same authority basis at their exact candidate digests; `SOLE_OWNER_ADVISORY` is not and cannot become an acceptance mechanism for them.
3. D0-004's single-owner policy and its planning-validator authority source will be superseded only by the future D0-005 implementation after its artifact gate; no D0-004 completion, partial subtask, structural acceptance, or closed issue is a prerequisite or substitute.
4. The execution packet pins a clean exact base, runtime/toolchain identity, permission profile, and every path/symbol above.
5. Any fact needed to activate authenticated review is supplied later by D0-009 from live GitHub evidence; this ticket neither infers nor manufactures that fact.

## Forbidden scope

- `docs/decisions/maintainer-gate-registry.v2.json`; any approval, transition, event, digest, or historical row; product code; GitHub issue/label/body mutation; and activation of authenticated review.
- Claiming separation of duties, authorization, artifact freeze, or `READY_FOR_RED` from an advisory record, role string, comment, label, board, roadmap, or issue state.
- Altering the five legacy digest-frozen artifacts or treating the Node 22.18 correction as approved.
- Treating a numeric GitHub issue binding as authority, readiness, or executable state; recording a binding without re-reading its issue identity, title, milestone, and labels; or allowing a malformed, duplicate, or disagreeing binding.

## RED contract

- Test file: `tests/governance-mode-contract.test.mjs`.
- Focused command: `node --test tests/governance-mode-contract.test.mjs`.
- Stage only the named test before GREEN and capture all twelve named case failures. The six contract-error cases must report, respectively: `missing-governance-mode-is-contract-error` — `governance mode contract error: missing current_mode`; `malformed-governance-mode-is-contract-error` — `governance mode contract error: malformed contract`; `unknown-governance-mode-is-contract-error` — `governance mode contract error: unknown mode`; `contradictory-governance-mode-is-contract-error` — `governance mode contract error: contradictory current_mode`; `d0-004-authority-source-is-rejected` — `governance mode contract error: D0-004 is not an authority source`; and `invalid-governance-contract-never-falls-back` — `governance mode contract error: invalid contract has no fallback`.
- The six valid-contract cases must use a staged otherwise-valid contract and call `resolveGovernanceModeResult`; each has its own pinned pre-GREEN assertion message, including when that export is absent: `valid-governance-contract-declares-exact-modes` — `governance mode contract positive assertion failed: declared modes must equal SOLE_OWNER_ADVISORY,AUTHENTICATED_REVIEW`; `valid-sole-owner-advisory-is-canonical` — `governance mode contract positive assertion failed: current_mode must equal SOLE_OWNER_ADVISORY`; `valid-sole-owner-advisory-emits-empty-ready-set` — `governance mode contract positive assertion failed: advisory readySet must equal []`; `valid-sole-owner-advisory-never-authorizes-red-merge-or-implementation` — `governance mode contract positive assertion failed: advisory ticket state must deny RED and implementation and result must deny merge authorization`; `valid-sole-owner-advisory-has-no-artifact-freeze` — `governance mode contract positive assertion failed: advisory artifact_freeze must equal null`; and `valid-sole-owner-advisory-never-claims-separation-of-duties-for-different-role-strings` — `governance mode contract positive assertion failed: advisory claims_separation_of_duties must equal false`.
- Capture the exact command, exit code, named failures, and messages before changing any future mode contract, resolver, schema, catalog object, or documentation. Any unrelated failure stops execution.

Expected pre-GREEN failure: all twelve named cases above fail with their respective pinned messages; a module-load, harness, or other unrelated failure stops execution.

## Planned supersession boundary

D0-005 will make the versioned mode contract the authority source only after its own artifact gate. It will then supersede D0-004's single-owner policy for the named future surfaces. This successor keeps the permanent numeric-binding validator and routes the five records through normal resolver evaluation; it neither changes the D0-004 authority source, the active runtime mode, authorization, artifact acceptance, artifact freeze, nor any separation-of-duties claim.

## Minimum GREEN

- Create a versioned mode contract with exactly `SOLE_OWNER_ADVISORY` and `AUTHENTICATED_REVIEW`; set advisory as the canonical mode and retain an explicit inactive activation state for authenticated review.
- In the future advisory mode, return an empty ready set, `red_authorized=false`, no artifact freeze, and no merge/implementation authorization regardless of structural registry fields or self-authored strings.
- Declare `claims_separation_of_duties=false` in the future versioned mode contract and resolver/schema results. Even when structural `prepared_by` and `approved_by` role strings differ, advisory will have no separation-of-duties claim, authorization, ready-set member, or artifact freeze.
- Remove active separation-of-duties claims from the named governance surfaces. State plainly that future advisory mode has no authenticated independent-review guarantee.
- Parse only the future versioned contract; missing, malformed, unknown, or contradictory mode input will fail closed to a contract error with no authorization. Do not make authenticated review active in this ticket.
- `valid-governance-contract-declares-exact-modes` asserts the sole mode set is exactly `SOLE_OWNER_ADVISORY` and `AUTHENTICATED_REVIEW`; `valid-sole-owner-advisory-is-canonical` asserts `result.governance_mode === "SOLE_OWNER_ADVISORY"`; `valid-sole-owner-advisory-emits-empty-ready-set` asserts `result.readySet` is exactly `[]`; `valid-sole-owner-advisory-never-authorizes-red-merge-or-implementation` asserts `result.claims_merge_authorization === false` and, for every `[ticketId, ticketState]` in `Object.entries(result.tickets)`, asserts `ticketState.red_authorized === false`, `ticketState.readiness !== "ready"`, `ticketState.phase !== "ready_for_red"`, and `ticketState.packet === null`; `valid-sole-owner-advisory-has-no-artifact-freeze` asserts `result.artifact_freeze === null`; and `valid-sole-owner-advisory-never-claims-separation-of-duties-for-different-role-strings` supplies distinct local `prepared_by` and `approved_by` strings and asserts `result.claims_separation_of_duties === false`. No assertion may read a nonexistent top-level `red_authorized` or `implementation_authorized` field.
- Mutation receipts are required: the six valid-contract cases must kill a `resolveGovernanceModeResult` mutation that adds, removes, or changes a declared mode or makes `AUTHENTICATED_REVIEW` current; `valid-sole-owner-advisory-never-claims-separation-of-duties-for-different-role-strings` must kill a `claims_separation_of_duties` mutation that derives the claim from unequal local `prepared_by` and `approved_by` strings.
- Make the future planning validator parse the future mode contract, require its byte-for-meaning equivalent copy in `docs/issues.json.operational_authority`, and reject D0-004 as that source.
- Require identical, unique positive numeric bindings in the issue map and manifest: `D0-005 → #173`, `D0-006 → #174`, `D0-007 → #175`, `D0-008 → #176`, and `D0-009 → #177`; every other ticket remains numerically bound. A numeric issue identity conveys no authority, readiness, or executable state.

## Acceptance ↔ tests

- AC-D0-005-1 ↔ `tests/governance-mode-contract.test.mjs` case `missing-governance-mode-is-contract-error`.
- AC-D0-005-2 ↔ `tests/governance-mode-contract.test.mjs` case `malformed-governance-mode-is-contract-error`.
- AC-D0-005-3 ↔ `tests/governance-mode-contract.test.mjs` case `unknown-governance-mode-is-contract-error`.
- AC-D0-005-4 ↔ `tests/governance-mode-contract.test.mjs` case `contradictory-governance-mode-is-contract-error`.
- AC-D0-005-5 ↔ `tests/governance-mode-contract.test.mjs` cases `d0-004-authority-source-is-rejected` and `invalid-governance-contract-never-falls-back`.
- AC-D0-005-6 ↔ `tests/planning-contract.test.mjs` cases `all-issue-bindings-are-numeric-and-unique` and `numeric-issue-binding-mutations-are-rejected`.
- AC-D0-005-7 ↔ `tests/execution-state.test.mjs` case `executable-ticket-still-requires-authority`.
- AC-D0-005-8 ↔ `tests/governance-mode-contract.test.mjs` case `valid-governance-contract-declares-exact-modes`.
- AC-D0-005-9 ↔ `tests/governance-mode-contract.test.mjs` case `valid-sole-owner-advisory-is-canonical`.
- AC-D0-005-10 ↔ `tests/governance-mode-contract.test.mjs` case `valid-sole-owner-advisory-emits-empty-ready-set`.
- AC-D0-005-11 ↔ `tests/governance-mode-contract.test.mjs` case `valid-sole-owner-advisory-never-authorizes-red-merge-or-implementation`.
- AC-D0-005-12 ↔ `tests/governance-mode-contract.test.mjs` case `valid-sole-owner-advisory-has-no-artifact-freeze`.
- AC-D0-005-13 ↔ `tests/governance-mode-contract.test.mjs` case `valid-sole-owner-advisory-never-claims-separation-of-duties-for-different-role-strings`.

## Verification

1. RED: `node --test tests/governance-mode-contract.test.mjs`; capture all twelve named failures and their pinned messages before GREEN.
2. Focused: `node --test tests/governance-mode-contract.test.mjs`; `missing-governance-mode-is-contract-error`, `malformed-governance-mode-is-contract-error`, `unknown-governance-mode-is-contract-error`, `contradictory-governance-mode-is-contract-error`, `d0-004-authority-source-is-rejected`, `invalid-governance-contract-never-falls-back`, `valid-governance-contract-declares-exact-modes`, `valid-sole-owner-advisory-is-canonical`, `valid-sole-owner-advisory-emits-empty-ready-set`, `valid-sole-owner-advisory-never-authorizes-red-merge-or-implementation`, `valid-sole-owner-advisory-has-no-artifact-freeze`, and `valid-sole-owner-advisory-never-claims-separation-of-duties-for-different-role-strings` all pass; retain the two required mutation-kill receipts.
3. Full: `npm test`; zero failure and no unregistered skip.
4. Build/package: `npm run build` and `npm run docs:check`; both pass with all twelve governance-mode cases, the numeric-binding invariant, and the authority requirement for executable tickets.
5. Manual/live: `LIVE_NA` — this ticket will not activate or mutate external GitHub settings.
6. Ownership: `git diff --check <base>...<head>` passes and the diff is restricted to **Exact ownership**.

## Stop and escalation

- Stop on a claim that a role string, registry field, closed issue, comment, or planning projection authenticates a principal; on ownership overlap; or if a live fact is unavailable or ambiguous.
- Stop if a requested change would activate authenticated review or edit a legacy registry record. Escalate to D0-009 or the owning ADR/PRD; do not broaden this ticket.

## Completion evidence

- Exact base/head, RED receipt, focused/full/build/docs receipts, future mode-contract digest, empty-ready-set report, separation-claim audit, ownership audit, exact-head review, and CI receipt.

## Invalidation

Any change to the mode contract, resolver/schema symbols, active governance wording, catalog object, runtime identity, or candidate head invalidates the affected RED/GREEN, review, and CI evidence. A later activation change belongs only to D0-009.
