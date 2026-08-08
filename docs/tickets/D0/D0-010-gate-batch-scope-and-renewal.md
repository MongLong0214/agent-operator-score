# D0-010 · Per-artifact gate batch scope and renewal

- Status: **BLOCKED — ADR + PRD + TICKET MAINTAINER GATES REQUIRED**
- Epic: D0
- Milestone: S0 · Name & Contracts
- Owning PRD: [D0](../../prd/PRD-D0-name-migration-and-repository-skeleton.md)
- Size: M
- Dependencies: D0-002
- Governing ADR: [ADR-0013](../../adr/ADR-0013-authenticated-governance-modes-and-legacy-quarantine.md)

## Renumbering provenance

This was an allocation error: D0-005 through D0-009 were assigned without checking that open issue #167 and open PR #171 already held the identifier intended for this workstream. `dev` is canonical; after PR #172 that identifier belongs to the effective-state quarantine and legacy-reclassification artifact. The unmerged gate-batch workstream is bound to issue #167. This is a corrective renumbering, not a routine ticket choice.

## Governing authority and D0-006 relationship

ADR-0013 governs the current `SOLE_OWNER_ADVISORY` mode and its `LEGACY_UNAUTHENTICATED` effect: unequal locally authored `prepared_by` and `approved_by` strings are not authenticated approval or separation of duties. D0-006 is the D0-GOV delivery that derives that effective state from immutable v2 rows; D0-010 must preserve that result and must neither rewrite its source registry nor turn it into approval.

This is a governing-ADR relationship, not a D0-006 ticket dependency. The owning D0 PRD declares D0-002 only, not D0-006, so this ticket does not add a cross-PRD dependency that the PRD does not authorize. ADR-0013 is nevertheless required at its exact digest because its advisory/legacy semantics constrain this ticket's mechanics.

## Goal

Make Gate Administration mechanics precise without fabricating approval. In `SOLE_OWNER_ADVISORY`, establish the per-artifact naming rule, extend the accepted-artifact uniqueness check to ADRs and PRDs, emit a computed blast radius, and add deterministic `gate:renew` mechanics. These mechanics never write an `ACCEPTED` record and never assert that an artifact is approved. The standing multi-artifact rows are not re-scoped in advisory mode; their `LEGACY_UNAUTHENTICATED` effective state remains intact until authenticated review is active.

## Exact ownership

- `scripts/validate-gate-administration.mjs`; `scripts/gate-renew.mjs`; `tests/planning/gate-batch-scope.test.mjs`; `docs/decisions/PRE-IMPLEMENTATION-GATE-ADMINISTRATION.md`; the D0-010 `planned_tests` entry and D0-010 acceptance bindings in `docs/TRACEABILITY.md`; and only `package.json` script `gate:renew`.
- Narrow pre-RED harness carve-out only: before staging the RED test, insert only `scripts/gate-renew.mjs` and `tests/planning/gate-batch-scope.test.mjs` into `controlPlaneAllowlist` in `scripts/validate-planning.mjs`; in `tests/planning-contract.test.mjs`, change only the `control_plane_allowlist` and `control_plane_code_files` literals in both `acceptedValidatorOutput` and `pendingValidatorOutput` from `9` to `11`; in `tests/planning/workspace-skeleton.test.mjs`, change only `expectedScripts` and `expectedScriptsText` to add the exact `gate:renew` entry. No other symbol, fixture, setup/teardown, assertion, or file is granted by this carve-out.
- No registry row, transition, event, digest, or historical batch is owned. The canonical registry remains byte-identical during this advisory-mode work.
- No other file or symbol may be edited without a replacement ticket and renewed gate.

## Preconditions

1. ADR-0001, ADR-0003, ADR-0012, governing ADR-0013, the owning D0 PRD, and this exact ticket are explicitly accepted at their exact digests.
2. The execution packet pins the base SHA and identifies the authenticated repository owner. D0-002's own completion is not asserted here: its GitHub issue is closed, but issue state is not completion authority, and the resolver is the sole operational-state authority.
3. D0-006's effective-state behavior is read as the governing relationship described above, not inferred from a registry role string or added as a D0-010 dependency.
4. `node scripts/validate-gate-administration.mjs` passes at the execution base and its `current_accepted_tickets` output is recorded as the pre-change baseline.
5. The pre-RED harness carve-out is complete before the RED test is staged: both census literal pairs read `11` and `package.json` declares `gate:renew`.
6. Worktree is clean and `refs/remotes/origin/dev` resolves, because structural `ACCEPTED` rows are verified against the target ref as well as the working tree.
7. Bootstrap remains active. This ticket does not merge D0-004C, does not re-enable the `Gate-Batch` pull-request requirement, and does not claim merge authorization.

## Scope rule

The per-artifact naming rule applies to future single-artifact batches only: `gate-adr-<nnnn>`, `gate-prd-<id>`, and `gate-ticket-<id>`, lowercased. Its `required_transitions` carries exactly the one transition matching the artifact's kind, and `transitions` closes exactly that kind's one-path set. Renewal appends `-r<n>`; an `INVALIDATED` identifier is terminal and is never reused. This rule does not silently redefine a standing legacy multi-artifact row.

The invariant this ticket adds is that every ADR, PRD, and ticket path appears in at most one structural `ACCEPTED` batch. `scripts/validate-gate-administration.mjs` already enforces this for `TICKET` artifacts and reports `multiple current accepted batches for ticket <path>`; the same rule extends to `ADR` and `PRD` with the same fail-closed shape. Without it, one artifact can sit in several accepted batches, and editing it fails the planning build once per batch while dropping several gates at once.

`prepared_by != approved_by` remains only a structural record-shape check. While `SOLE_OWNER_ADVISORY` is active, both strings are unauthenticated locally authored values: their inequality conveys no authentication, no approval, no authorization, no readiness, no artifact freeze, and no separation of duties.

Blast radius is computed, never declared. For an ADR path it is the sorted, deduplicated union of (a) tickets whose owning PRD lists that ADR in `- Dependencies:` and (b) tickets whose exact `- Governing ADR:` metadata names that ADR. For a PRD path it is the set of tickets whose `- Owning PRD:` link resolves to it; for a ticket path it is that ticket alone. The checker derives this from the live ADR, PRD, and ticket corpus at read time and emits it; a registry-supplied radius is rejected rather than trusted. The governing-ADR arm is required even when the owning PRD does not list the ADR.

## Advisory-mode split

### Now, in `SOLE_OWNER_ADVISORY`

- Own the future single-artifact naming rule, all-kind uniqueness extension, governing-ADR-aware `blast_radius` output, and `scripts/gate-renew.mjs` with `gate:renew`.
- Keep the canonical registry byte-identical. The checker may diagnose structural rows, but it cannot create approval from them.
- `gate:renew` never writes `ACCEPTED` and never emits a receipt. For a non-legacy single-artifact binding in an isolated scratch registry, it recomputes the digest, invalidates that non-authorizing binding with a supplied reason, appends a fresh `PENDING` `-r<n>` record, and prints the exact `Gate-Batch: <id>` template a future ratifying pull request would need. It refuses an unknown path, an ambiguous kind, a terminal identifier, and any standing legacy multi-artifact row while advisory mode is active.

### Deferred until authenticated review is active

After D0-009 has activated `AUTHENTICATED_REVIEW` from current live GitHub facts, a separately authorized exact-base packet may re-scope the standing structural `ACCEPTED` bindings into new per-artifact batches and may write an `INVALIDATED` transition for the superseded legacy multi-artifact row. That work is not an acceptance criterion or a registry write in this advisory packet. Until it occurs under authenticated review, every standing row retains ADR-0013's `LEGACY_UNAUTHENTICATED` effective state, with no authorization, readiness, or artifact-freeze effect.

## Forbidden scope

- Writing an `ACCEPTED` record; recording a `Gate-Batch` pull-request receipt; re-scoping a standing legacy batch; writing an `INVALIDATED` transition on a legacy multi-artifact row; merging D0-004C; or re-enabling the post-C gate chain.
- Editing `docs/decisions/maintainer-gate-registry.v2.json`, the five digest-frozen legacy artifacts, any ADR, PRD, or ticket body other than this exact ticket, product source, or a lifecycle state, transition, registry key, digest binding, reviewed-head binding, target-tip binding, or the `maintainer-gate-digest-invalidation` control.
- Treating unequal preparer/approver strings as a principal, approval, or separation-of-duties signal; wall-clock-dependent registry output; or a permissive fallback on unavailable Git facts, malformed registry, or ambiguous artifact kind.

## RED contract

- Test file: `tests/planning/gate-batch-scope.test.mjs`.
- Focused command: `npm test -- tests/planning/gate-batch-scope.test.mjs`.
- Stage only the RED test after the pre-RED harness carve-out and before any checker or renewal-script edit. At that point `scripts/gate-renew.mjs` does not exist and all-kind uniqueness is unenforced.
- Capture the three named failures before their owning GREEN edit. `one-accepted-batch-per-artifact` fails because a fixture registry placing one ADR path in two `ACCEPTED` batches is accepted by the current checker, which restricts uniqueness to `TICKET` artifacts. `renewal-mints-fresh-pending-batch` and `advisory-renewal-refuses-legacy-multi-artifact-batch` fail with `ERR_MODULE_NOT_FOUND` for `scripts/gate-renew.mjs`.
- Every fixture registry is constructed at the canonical relative path inside an isolated scratch copy. No test writes into the live repository root, mutates the canonical registry in place, or creates an `ACCEPTED` transition.
- An unrelated failure, a fixture that fails for a Git-availability reason rather than the named reason, or a mutant already failing before its edit stops execution.

Expected pre-GREEN failure: `one-accepted-batch-per-artifact` reports that a duplicate `ACCEPTED` ADR binding was accepted; `renewal-mints-fresh-pending-batch` and `advisory-renewal-refuses-legacy-multi-artifact-batch` cannot load `scripts/gate-renew.mjs`.

## Minimum GREEN

- Extend the existing accepted-artifact uniqueness rule in `scripts/validate-gate-administration.mjs` from `TICKET` to all three kinds, keeping the current message shape and fail-closed behavior. An artifact bound by two `ACCEPTED` batches is an error, not a warning, and yields no `currentAcceptedTickets`.
- Emit the computed blast radius on the structural pass line as sorted `blast_radius=<artifact_path>:<ticket_ids>` groups, or `none` when no structural `ACCEPTED` batch exists. For ADRs, include both owning-PRD dependencies and exact-ticket `Governing ADR` references; reject a registry-declared radius.
- Add `scripts/gate-renew.mjs` and the `gate:renew` script. Its advisory-mode path never writes `ACCEPTED`, never treats a structural row as approved, never edits an artifact, and refuses a standing legacy multi-artifact binding without changing it. Its isolated non-legacy one-artifact round trip may create only the explicit `INVALIDATED` then fresh `PENDING` records described in **Advisory-mode split**.
- Do not re-scope the canonical registry. Do not write an `INVALIDATED` transition for a standing legacy multi-artifact row. The deferred authenticated-review step is intentionally absent from this GREEN.
- `docs/decisions/PRE-IMPLEMENTATION-GATE-ADMINISTRATION.md` records the future single-artifact naming rule, all-kind uniqueness invariant, advisory renewal behavior, governing-ADR blast-radius input, and that unequal single-owner preparer/approver strings are structural shape only, not independent authorization.

## Acceptance ↔ tests

- AC-D0-010-1 ↔ `tests/planning/gate-batch-scope.test.mjs` case `one-accepted-batch-per-artifact`: an ADR, PRD, or ticket path bound by two `ACCEPTED` batches fails closed with the existing message shape and yields no accepted-ticket census.
- AC-D0-010-2 ↔ `tests/planning/gate-batch-scope.test.mjs` case `single-artifact-batch-closes-its-transition`: a future one-artifact batch with exactly its one matching required transition passes, and a batch whose transition set does not exactly close its required kind still fails.
- AC-D0-010-3 ↔ `tests/planning/gate-batch-scope.test.mjs` case `advisory-renewal-refuses-legacy-multi-artifact-batch`: advisory renewal leaves a standing legacy multi-artifact row byte-identical, writes no transition, and reports that authenticated review is required.
- AC-D0-010-4 ↔ `tests/planning/gate-batch-scope.test.mjs` case `blast-radius-is-computed-not-declared`: the emitted radius equals the corpus-derived union and includes a ticket that names ADR-0013 in `Governing ADR` even though its owning PRD does not list ADR-0013; a registry-declared radius field is rejected rather than trusted.
- AC-D0-010-5 ↔ `tests/planning/gate-batch-scope.test.mjs` cases `renewal-mints-fresh-pending-batch` and `invalidated-batch-id-is-terminal`: an isolated non-legacy one-artifact renewal appends a `PENDING` batch at a fresh identifier with the on-disk digest, and reusing or resurrecting a terminal identifier fails closed.
- AC-D0-010-6 ↔ `tests/planning/gate-batch-scope.test.mjs` cases `renewal-is-not-authorization` and `equal-preparer-and-approver-fails-closed`: renewal never emits `ACCEPTED`, its printed `Gate-Batch` line is a template rather than a receipt, and preparer/approver inequality remains a structural shape guard with no authentication or separation-of-duties claim.

## Verification

1. RED: after the pre-RED harness carve-out, `npm test -- tests/planning/gate-batch-scope.test.mjs`; retain the three named failures and their exact reasons as the RED receipt.
2. Focused: `npm test -- tests/planning/gate-batch-scope.test.mjs`; every named case above passes.
3. Gate checker: `node scripts/validate-gate-administration.mjs`; structural pass emits `not_authorization` and the computed governing-ADR-aware blast radius without a registry write.
4. Renewal round trip: on an isolated scratch registry containing a non-legacy single-artifact binding, `npm run gate:renew -- docs/adr/ADR-0003-runtime-repository-and-distribution.md` invalidates exactly that scratch binding, appends one fresh `PENDING` binding, and prints its `Gate-Batch` template. Against a copied standing legacy multi-artifact row it fails closed and leaves the copied row byte-identical.
5. Full: `npm test`; zero failure and no unregistered skip.
6. Build and docs: `npm run build` and `npm run docs:check`; both pass and the census line matches disk.
7. Offline resolver: `npm run ops:check`; Bootstrap remains active, `bootstrap.active` is true, and no ticket gains readiness from this change.
8. Manual/live: `LIVE_NA`; the packet neither writes external state nor asserts authenticated review.
9. Ownership: `git diff --check <base>...<head>` passes and `git diff --name-only <base>...<head>` lists only **Exact ownership**, the pre-RED harness carve-out, and no frozen artifact or canonical registry.

## Stop and escalation

- Stop on any attempt to write `ACCEPTED`, re-scope a standing batch, transition a legacy multi-artifact row, fabricate an approval, promote a batch, or produce a `Gate-Batch` receipt; on a blast radius that disagrees with the corpus; or on a role-string inequality presented as authentication or separation of duties.
- Stop on an unavailable `origin/dev` ref or unresolvable reviewed head reported as pass; on the `maintainer-gate-digest-invalidation` control ceasing to fail for a material edit; or on a governing ADR omitted from the computed radius.
- Escalate the deferred re-scope and legacy-row invalidation to a separately authorized exact-base packet only after D0-009 activates authenticated review. Do not create a D0-006 dependency that the owning D0 PRD does not declare.
- A dependency or contract defect is escalated to its owning ADR/PRD/ticket; do not broaden this ticket.

## Completion evidence

- Exact base/head SHA and diff manifest limited to owned paths and the pre-RED harness carve-out; explicit byte-identical canonical-registry proof.
- RED receipt carrying all three named failures with their exact reasons.
- Focused, full, build, docs, gate-checker, and offline-resolver receipts.
- Computed blast-radius receipt proving the governing-ADR input and rejecting a registry-declared value.
- Renewal transcripts for the isolated non-legacy round trip and the legacy-multi-artifact refusal.
- Explicit statement that no acceptance, registry transition, artifact approval, readiness, freeze, or separation-of-duties claim was recorded; Bootstrap remains active and `claims_merge_authorization` is unchanged.

## Invalidation

Any change to this ticket, its PRD or governing ADR basis, the gate schema, checker, renewal script, ticket corpus or Governing ADR metadata used to compute blast radius, or candidate head invalidates the affected evidence and returns the lane to the earliest changed gate. Adding the `gate:renew` script or RED test file moves the pinned script surface in `tests/planning/workspace-skeleton.test.mjs`, both census literal pairs in `tests/planning-contract.test.mjs`, and every focused-lane pass total that counts test files; those expected consequences remain within the pre-RED carve-out. The deferred authenticated re-scope has no evidence in this advisory packet and cannot inherit this packet's review or CI.
