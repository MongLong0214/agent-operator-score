# D0-006 · Per-artifact gate batch scope and mechanical renewal

- Status: **BLOCKED — ADR + PRD + TICKET MAINTAINER GATES REQUIRED**
- Epic: D0
- Milestone: S0 · Name & Contracts
- Owning PRD: [D0](../../prd/PRD-D0-name-migration-and-repository-skeleton.md)
- Size: M
- Dependencies: D0-002

## Goal

Make Maintainer Gate acceptance affordable in both directions: cheap to grant for a new ticket, and cheap to give up for an honest correction to an authority document. Today one accepted batch binds five artifacts, so correcting the false Node 20 runtime floor in `docs/adr/ADR-0003-runtime-repository-and-distribution.md` would invalidate the repository's only planning acceptance and delete the live target of the `maintainer-gate-digest-invalidation` control. Re-scope standing batches to exactly one artifact each, enforce that every ADR, PRD, and ticket artifact appears in at most one `ACCEPTED` batch, emit the resulting blast radius, and make renewal a command rather than hand-edited JSON. Do not weaken digest binding, do not add a lifecycle state, and do not convert a self-authored registry string into authorization.

## Exact ownership

- `scripts/validate-gate-administration.mjs`; `scripts/gate-renew.mjs`; `tests/planning/gate-batch-scope.test.mjs`; `docs/decisions/maintainer-gate-registry.v2.json`; `docs/decisions/PRE-IMPLEMENTATION-GATE-ADMINISTRATION.md`; and only `package.json` script `gate:renew`.
- Narrow pre-RED harness carve-out only: before staging the RED test, insert only `scripts/gate-renew.mjs` and `tests/planning/gate-batch-scope.test.mjs` into `controlPlaneAllowlist` in `scripts/validate-planning.mjs`; in `tests/planning-contract.test.mjs`, change only the `control_plane_allowlist` and `control_plane_code_files` literals in both `acceptedValidatorOutput` and `pendingValidatorOutput` from `9` to `11`; in `tests/planning/workspace-skeleton.test.mjs`, change only `expectedScripts` and `expectedScriptsText` to add the exact `gate:renew` entry. No other symbol, fixture, setup/teardown, assertion, or file is granted by this carve-out.
- Narrow D0-004 carve-out only: in `tests/planning-contract.test.mjs`, change only the batch identifier inside the single expected-stderr assertion of case `maintainer-gate-digest-invalidation` from `d0-002-prerequisites-red-census-contract-correction-renewal` to the re-scoped ADR-0001 batch identifier. The case name, its target artifact, its expected `stale digest` prefix, and every other assertion stay byte-for-byte unchanged. This carve-out narrows nothing the control asserts; it repoints one identifier at the batch that still binds the same artifact.
- The registry re-scope is a record-shape change only. It records no new acceptance, promotes no batch, and preserves every existing `INVALIDATED` batch as historical evidence.
- No other file or symbol may be edited without a replacement ticket and renewed gate.

## Preconditions

1. Required ADRs and owning PRD are explicitly accepted at their exact digests, and this exact ticket is explicitly accepted.
2. The execution packet pins the base SHA and identifies the authenticated repository owner. D0-002's own completion is not asserted here: its GitHub issue is closed, but issue state is not completion authority, and the resolver is the sole operational-state authority.
3. `node scripts/validate-gate-administration.mjs` passes at the execution base and its `current_accepted_tickets` output is recorded as the pre-change baseline.
4. The pre-RED harness carve-out is complete before the RED test is staged: both census literal pairs read `11` and `package.json` declares `gate:renew`.
5. Worktree is clean and `refs/remotes/origin/dev` resolves, because an `ACCEPTED` batch is verified against the target ref as well as the working tree.
6. Bootstrap remains active. This ticket does not merge D0-004C, does not re-enable the `Gate-Batch` pull-request requirement, and does not claim merge authorization.

## Scope rule

A standing batch binds exactly one artifact. Batch identifiers are `gate-adr-<nnnn>`, `gate-prd-<id>`, and `gate-ticket-<id>`, lowercased. `required_transitions` therefore carries exactly the one transition matching that artifact's kind, and `transitions` closes exactly that kind's path set. Renewal appends `-r<n>`; an `INVALIDATED` identifier is terminal and is never reused.

The invariant this ticket adds is that every ADR, PRD, and ticket path appears in at most one `ACCEPTED` batch. `scripts/validate-gate-administration.mjs` already enforces this for `TICKET` artifacts and reports `multiple current accepted batches for ticket <path>`; the same rule extends to `ADR` and `PRD` with the same fail-closed shape. Without it, one artifact can sit in several accepted batches, and editing it fails the planning build once per batch while dropping several gates at once.

Blast radius is computed, never declared. For an ADR path it is the set of tickets whose owning PRD lists that ADR in its `- Dependencies:` line; for a PRD path it is the set of tickets whose `- Owning PRD:` link resolves to it; for a ticket path it is that ticket alone. The checker derives this from the live ADR, PRD, and ticket corpus at read time and emits it; no registry field asserts it, and a registry-supplied value is rejected rather than trusted. At the execution base this bounds a single ADR correction to between 5 and 18 tickets rather than all 66.

## Forbidden scope

- Marking any gate accepted; recording a `Gate-Batch` pull-request receipt; merging D0-004C or re-enabling the post-C gate chain; adding, removing, or renaming a lifecycle state, transition, or registry key; relaxing digest binding, reviewed-head binding, target-tip binding, or the equal-preparer-and-approver rejection; deleting or narrowing the `maintainer-gate-digest-invalidation` control; editing any ADR, PRD, or ticket body, including the stale Node 20 prose this ticket makes correctable; product source; wall-clock-dependent registry output; permissive fallback on unavailable Git facts, malformed registry, or ambiguous artifact kind.

## RED contract

- Test file: `tests/planning/gate-batch-scope.test.mjs`
- Focused command: `npm test -- tests/planning/gate-batch-scope.test.mjs`
- Stage only the RED test after the pre-RED harness carve-out and before any checker, renewal-script, or registry edit. At that point `scripts/gate-renew.mjs` does not exist and the invariant is unenforced.
- Capture two independent named failures before their owning GREEN edit. First, `one-accepted-batch-per-artifact` fails because a fixture registry placing one ADR path in two `ACCEPTED` batches is accepted by the current checker, which restricts the uniqueness rule to `TICKET` artifacts. Second, `renewal-mints-fresh-pending-batch` fails with `ERR_MODULE_NOT_FOUND` for `scripts/gate-renew.mjs`.
- Every fixture registry is constructed at the canonical relative path inside an isolated worktree copy. No test writes into the live repository root, and no test mutates the canonical registry in place.
- An unrelated failure, a fixture that fails for a Git-availability reason rather than the named reason, or a mutant already failing before its edit stops execution.

Expected pre-GREEN failure: `one-accepted-batch-per-artifact` reports that a duplicate `ACCEPTED` ADR binding was accepted, and `renewal-mints-fresh-pending-batch` cannot load the missing `scripts/gate-renew.mjs` module.

## Minimum GREEN

- Extend the existing accepted-artifact uniqueness rule in `scripts/validate-gate-administration.mjs` from `TICKET` to all three kinds, keeping the current message shape and fail-closed behaviour. An artifact bound by two `ACCEPTED` batches is an error, not a warning, and yields no `currentAcceptedTickets`.
- Emit the computed blast radius on the structural pass line as `blast_radius=<artifact_path>:<ticket_ids>` groups, sorted, or `none` when no `ACCEPTED` batch exists. Derive the ticket set from the ticket corpus; a registry-declared value is rejected.
- Re-scope the standing registry so each currently `ACCEPTED` artifact binding becomes its own single-artifact batch under the naming rule above, and record the superseded multi-artifact batch as `INVALIDATED` with an explicit reason. Preserve every historical batch and its original digests. Re-scoping records no new approval: each new batch carries the same structural `prepared_by` and `approved_by` values it inherits, and those values remain `not_authorization`.
- Add `scripts/gate-renew.mjs` and the `gate:renew` script. `npm run gate:renew -- <artifact-path>` recomputes the artifact digest from disk, transitions the batch currently binding that path to `INVALIDATED` with a supplied reason, appends a fresh `PENDING` batch at the next `-r<n>` identifier with the recomputed digest, and prints the exact single `Gate-Batch: <id>` line a future ratifying pull request must carry. It never writes `ACCEPTED`, never reuses a terminal identifier, never edits an artifact, and refuses an unknown path, an ambiguous kind, or a path bound by no batch.
- After a material edit to one ADR, exactly one batch is invalidated and `npm run docs:check` passes in the same commit that carries the edit and the renewal. This is the property that unblocks the Node 20 correction; the acceptance for that one artifact is correctly lost and must be re-earned.
- Keep the digest control intact. A material edit to an artifact whose batch is still `ACCEPTED` still fails the planning build with `stale digest <batch-id> <path>`; only the batch identifier in that message changes.
- `docs/decisions/PRE-IMPLEMENTATION-GATE-ADMINISTRATION.md` records the one-artifact scope rule, the uniqueness invariant, the renewal command, and the fact that a single-owner `prepared_by`/`approved_by` pair is a structural record and not independent authorization. It also corrects its own stale claim that the D0-004 B-harness carve-out renewal is currently `ACCEPTED`; the registry records it as `INVALIDATED`.

## Acceptance ↔ tests

- AC-D0-006-1 ↔ `tests/planning/gate-batch-scope.test.mjs` case `one-accepted-batch-per-artifact`: an ADR, PRD, or ticket path bound by two `ACCEPTED` batches fails closed with the existing message shape and yields no accepted-ticket census.
- AC-D0-006-2 ↔ `tests/planning/gate-batch-scope.test.mjs` case `single-artifact-batch-closes-its-transition`: a batch binding one artifact with exactly its one matching required transition passes, and a batch whose transition set does not exactly close its required kind still fails.
- AC-D0-006-3 ↔ `tests/planning/gate-batch-scope.test.mjs` cases `editorial-correction-invalidates-one-batch` and `planning-build-green-after-scoped-invalidation`: a material edit to one ADR invalidates exactly one batch, leaves every other `ACCEPTED` batch untouched, and the planning build passes in the same commit as the paired renewal.
- AC-D0-006-4 ↔ `tests/planning/gate-batch-scope.test.mjs` case `blast-radius-is-computed-not-declared`: the emitted radius equals the ticket set derived from the corpus, and a registry-declared radius field is rejected rather than trusted.
- AC-D0-006-5 ↔ `tests/planning/gate-batch-scope.test.mjs` cases `renewal-mints-fresh-pending-batch` and `invalidated-batch-id-is-terminal`: renewal appends a `PENDING` batch at a fresh identifier with the on-disk digest, and reusing or resurrecting a terminal identifier fails closed.
- AC-D0-006-6 ↔ `tests/planning/gate-batch-scope.test.mjs` cases `renewal-is-not-authorization` and `equal-preparer-and-approver-fails-closed`: renewal never emits `ACCEPTED`, its printed `Gate-Batch` line is a template rather than a receipt, and an equal preparer and approver pair is still rejected.
- AC-D0-006-7 ↔ `tests/planning/gate-batch-scope.test.mjs` case `digest-invalidation-control-survives-rescope`: after re-scoping, a material edit to `docs/adr/ADR-0001-product-identity-and-legacy-boundary.md` still fails the planning build with a `stale digest` error naming the re-scoped ADR-0001 batch.

## Verification

1. RED: after the pre-RED harness carve-out, `npm test -- tests/planning/gate-batch-scope.test.mjs`; retain only the two named primary failures as the RED receipt.
2. Focused: `npm test -- tests/planning/gate-batch-scope.test.mjs`; every named case above passes.
3. Gate checker: `node scripts/validate-gate-administration.mjs`; structural pass emits the re-scoped batch census, `not_authorization`, and the computed blast radius.
4. Renewal round trip: `npm run gate:renew -- docs/adr/ADR-0003-runtime-repository-and-distribution.md` on a scratch copy; exactly one batch is invalidated, one fresh `PENDING` batch appears, and the printed `Gate-Batch` line matches its identifier.
5. Full: `npm test`; zero failure and no unregistered skip.
6. Build and docs: `npm run build` and `npm run docs:check`; both pass and the census line matches disk.
7. Offline resolver: `npm run ops:check`; Bootstrap remains active, `bootstrap.active` is true, and no ticket gains readiness from this change.
8. Manual/live: `LIVE_NA`; this ticket owns control-plane records and checker code only.
9. Ownership: `git diff --check <base>...<head>` passes and `git diff --name-only <base>...<head>` lists only the owned paths and the two named carve-outs.

## Stop and escalation

- Stop on any attempt to record an acceptance, promote a batch, or produce a `Gate-Batch` receipt from this ticket; on a re-scope that changes an artifact digest; on losing an `ACCEPTED` binding for an artifact that was not edited; on a blast radius that disagrees with the corpus; on an unavailable `origin/dev` ref or unresolvable reviewed head reported as pass; or on the `maintainer-gate-digest-invalidation` control ceasing to fail for a material edit.
- Escalate rather than absorb: D0-004 resolves to `COMPLETION_EFFECT_REVERTED` under online-strict resolution because part C is absent from the tree; the offline resolver, which cannot see merge state, reports it differently, so the mode must be named whenever this result is quoted. This ticket deliberately does not re-land D0-004C. The evidence that the post-C gate chain cannot deliver what it asserts, chiefly that the only `ACCEPTED` batch records `approved_by` as the placeholder `independent-maintainer-external-review-required` while the sole separation control is string inequality between two self-authored fields, belongs to D0-004's owner. Whether to re-land C behind a second authenticated principal or amend D0-004's scope is a D0-004 decision and must not be resolved inside this ticket.
- A dependency or contract defect is escalated to its owning ADR/PRD/ticket; do not broaden this ticket.

## Completion evidence

- Exact base/head SHA and diff manifest limited to owned paths and the two named carve-outs.
- RED receipt carrying both named primary failures with their exact reasons.
- Focused, full, build, docs, gate-checker, and offline-resolver receipts.
- Before-and-after batch census with per-artifact bindings, and the computed blast radius for each `ACCEPTED` artifact.
- Renewal round-trip transcript showing one invalidation, one fresh `PENDING` batch, and the printed `Gate-Batch` template.
- Explicit statement that no acceptance was recorded, Bootstrap remains active, and `claims_merge_authorization` is unchanged.

## Invalidation

Any change to this ticket, its PRD/ADR dependencies, the gate schema, the canonical registry, the checker, the renewal script, the ticket corpus used to compute blast radius, or the candidate head invalidates the affected evidence and returns the lane to the earliest changed gate. Adding the `gate:renew` script or the RED test file moves the pinned script surface in `tests/planning/workspace-skeleton.test.mjs`, both census literal pairs in `tests/planning-contract.test.mjs`, and every focused-lane pass total that counts test files; those are expected consequences of the carve-out and must be updated within it, never by widening ownership. Re-scoping the registry invalidates any prior review bound to a superseded batch identifier; no pending item is promoted by that invalidation.
