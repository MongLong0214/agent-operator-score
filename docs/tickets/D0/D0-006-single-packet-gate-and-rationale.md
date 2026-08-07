# D0-006 · Single execution packet, canonical ADR-set batch, and gate rationale fields

- Status: **BLOCKED — ADR + PRD + TICKET MAINTAINER GATES REQUIRED**
- Epic: D0
- Milestone: S0 · Name & Contracts
- Owning PRD: [D0G](../../prd/PRD-D0G-governance-simplification.md)
- Size: L
- Dependencies: D0-005

## Goal

Implement the binding CEO governance-simplification decision's second coupled deliverable: one execution packet per ticket, one canonical reusable ADR-set batch, and mandatory rationale fields on REJECTED and INVALIDATED Gate Administration records. Collapse only the duplicated machine lifecycle and maintainer transition bookkeeping that produced 8 of 10 INVALIDATED gate-registry batches to date, three of them from D0-001 alone re-binding ADR-0001/0003/0012 independently of D0-002. The separate CEO confirmations of ADR, PRD, and ticket are retained exactly; nothing here may merge or skip them.

## Exact ownership

- `docs/decisions/maintainer-gate.schema.json` — bump to the unified schema (`version: 3`, title updated) that defines both the ADR-set batch record and the ticket-packet record described below, replacing the single coupled-batch shape.
- `docs/decisions/maintainer-gate-registry.json` — the new unified, sole active registry; this ticket creates it.
- `scripts/validate-gate-administration.mjs` — the exported `validateGateAdministration` function and its CLI entry point only, extended for the two-record model, ADR-subset fan-out, mandatory rationale fields, append-only enforcement, and the frozen-history boundary below.
- `tests/gate-administration-contract.test.mjs` — the complete test module.
- Historical boundary only: `docs/decisions/maintainer-gate-registry.v1.json` and `docs/decisions/maintainer-gate-registry.v2.json` are frozen read-only history; this ticket may add a read-only marker but must not alter their recorded batch content, and neither file may become an active read or write target of the validator.
- No other file or symbol may be edited without a replacement ticket and renewed gate. In particular, `docs/decisions/PRE-IMPLEMENTATION-GATE-ADMINISTRATION.md` and `docs/decisions/MAINTAINER-GATE-STATUS.md` remain outside this ticket's ownership; if closing this ticket's contract requires editing their prose or ownership table, stop per Stop and escalation rather than broadening scope.

## Preconditions

1. The canonical ADR-set batch (exact ADR path and digest set covering at minimum ADR-0001, ADR-0003, ADR-0009, ADR-0012) and the owning PRD are explicitly accepted at their exact digests.
2. This exact ticket is explicitly accepted and an execution packet pins the base SHA. This ticket's own admission packet is necessarily recorded under the current coupled-batch model, since the unified packet shape does not exist until this ticket ships; only tickets accepted after this ticket's GREEN use the new packet shape.
3. D0-005 is complete and verified: two-tier tree/commit evidence binding and the head-preserving `workflow_dispatch` retrigger are both live.
4. PR #150 has resolved its own CI and ticket gates and completed merge and post-merge verification; no governance change from this PRD reaches `dev` before that.
5. Worktree is clean or unrelated owner changes are identified and protected.

## Forbidden scope

- Merging or skipping any of the three CEO step-gates (ADR acceptance, PRD acceptance, ticket acceptance); the global step-gate from ADR-0012 is retained exactly.
- Introducing a CommitLore service, file, or any other new subsystem for rationale capture; rationale fields live only on the existing event/rejection/invalidation records inside the unified registry.
- Mutating historical `maintainer-gate-registry.v1.json` or `.v2.json` content beyond marking it read-only; their recorded batches, digests, and events must remain byte-identical.
- Any change to PR #150's head, its worktree, or its CI/ticket gates.
- Product source; GitHub mutation; self-approval; permissive fallback on malformed packet, ADR-set batch, digest, rationale field, or frozen-history state.
- No edits to another ticket's owned files, no dependency upgrade unless owned here, and no public claim.

## RED contract

- Test file: `tests/gate-administration-contract.test.mjs`
- Focused command: `npm test -- tests/gate-administration-contract.test.mjs`
- Expected pre-GREEN failure: the live schema and validator enforce only a single coupled ADR+PRD+TICKET batch with `reason` as the sole mandatory rejection/invalidation field, so the following mutants currently pass and must each be captured as an unexpected PASS before editing:
  1. A REJECTED record fixture carrying no `reason_code`, `affected_evidence`, `supersedes_batch`, or `next_transition`.
  2. An INVALIDATED record fixture omitting the same four fields, since today only `reason` is required.
  3. A ticket-packet fixture that reuses an ADR-set batch identity plus a proper subset of its ADR artifacts, since the live schema has no `adr_set_batch_id` and forces full ADR re-binding per batch.
  4. A fixture where changing one ADR's digest in a shared ADR-set batch invalidates a ticket packet that does not reference that ADR, since batches today couple all three kinds with no per-ADR fan-out boundary.
  5. A fixture that points the checker's canonical active-registry path at `docs/decisions/maintainer-gate-registry.v1.json` or `.v2.json`, since the checker has no unified-active-registry/frozen-history distinction yet.
- Capture each named mutant and its unexpected PASS before editing the schema or validator. If a mutant already fails for an unrelated reason, stop and correct the mutant rather than claiming RED.

## Minimum GREEN

- Split the registry into two record kinds while preserving the existing lifecycle state machine unchanged for both (`PENDING→ACCEPTED`, `PENDING→REJECTED`, `ACCEPTED→INVALIDATED`, `REJECTED`/`INVALIDATED` terminal, no silent return to `PENDING`): canonical **ADR-set batches** binding only `kind: "ADR"` artifacts with exact digests, and **ticket packets** binding exactly one PRD artifact, one TICKET artifact, an `adr_set_batch_id` reference, and the exact ADR-path subset of that batch the ticket actually uses.
- Every ticket packet additionally carries mandatory, schema-validated `base_sha` (the exact base commit the packet pins), `ownership` (the ticket's exact-ownership path list), `red_command` (the ticket's RED focused command), and `verification_lanes` (the ticket's named verification lane list); a packet missing any of these fails closed.
- Retain `required_transitions` exactly as `ADR_ACCEPTED`, `PRD_ACCEPTED`, `TICKET_READY_FOR_RED` on every ticket packet; reject a packet whose transitions merge, omit, or substitute any of the three, so the three CEO confirmations stay structurally distinct and unskippable.
- A ticket packet is valid only when its `adr_set_batch_id` resolves to an ACCEPTED ADR-set batch and every referenced ADR path's digest equals that batch's current artifact digest. A digest change to one ADR invalidates only packets whose ADR-path subset includes that ADR; a digest change to an ADR referenced by every packet (e.g. ADR-0012) invalidates every one of them — this fan-out is correct and must not be suppressed.
- Add a `rejection` object to both record kinds, structurally mirroring `invalidation`. Extend both `rejection` and `invalidation` to require `reason_code` (short stable token), `reason` (free text, already required), `affected_evidence` (non-empty array of evidence paths/identifiers), `supersedes_batch` (the id it supersedes, or an explicit `"none"` sentinel for a first record), and `next_transition` (the next allowed lifecycle action or an explicit terminal marker). A REJECTED or INVALIDATED record missing any of these five fields fails closed.
- Make both record kinds append-only: once a record reaches `REJECTED` or `INVALIDATED`, no prior field — including its rationale fields — may be edited on a later run; only a new record with a new id may be added. Verify this against the same id's previously committed bytes at a prior reviewed/exact head, not against the working tree alone.
- Freeze `docs/decisions/maintainer-gate-registry.v1.json` and `.v2.json` as read-only history: the validator's canonical active-registry path resolves only to `docs/decisions/maintainer-gate-registry.json`; any fixture pointing required/reviewed artifacts, exact-head surfaces, or a write target at `.v1.json`/`.v2.json` fails closed, and their previously committed bytes must remain byte-identical.
- Migrate the current bounded-RED-accepted D0-001 packet (`d0-001-prerequisites-red-contract-renewal`) into the new model without granting new execution authority: express it as one ADR-set batch (ADR-0001/0003/0012) plus one ticket packet referencing it, preserving its ACCEPTED status, reviewed head, and non-authorization semantics exactly. The three superseded INVALIDATED D0-001 batches remain in frozen `v2.json` history only and are not restated in the unified file.
- Change only the owned symbols and files above; no CommitLore service, file, or other new subsystem.

## Acceptance ↔ tests

- AC-D0-006-1 ↔ `tests/gate-administration-contract.test.mjs` case `packet-binds-single-and-preserves-three-ceo-gates`.
- AC-D0-006-2 ↔ `tests/gate-administration-contract.test.mjs` case `adr-set-batch-reuse-and-narrow-adr-subset-reference`.
- AC-D0-006-3 ↔ `tests/gate-administration-contract.test.mjs` case `single-adr-digest-change-invalidates-only-referencing-packets`.
- AC-D0-006-4 ↔ `tests/gate-administration-contract.test.mjs` case `shared-adr-digest-change-invalidates-every-referencing-packet`.
- AC-D0-006-5 ↔ `tests/gate-administration-contract.test.mjs` case `v1-v2-registry-frozen-and-unified-registry-is-sole-write-target`.
- AC-D0-006-6 ↔ `tests/gate-administration-contract.test.mjs` case `rejected-and-invalidated-records-require-mandatory-rationale-fields`.
- AC-D0-006-7 ↔ `tests/gate-administration-contract.test.mjs` case `rationale-fields-are-append-only`.
- AC-D0-006-8 ↔ `tests/gate-administration-contract.test.mjs` case `d0-001-bounded-red-lineage-migrates-without-new-authority`.

## Verification

1. Focused: `npm test -- tests/gate-administration-contract.test.mjs`; each named mutant fails for its expected reason and the migrated canonical corpus passes.
2. Full: `npm test`; zero failure and no unregistered skip.
3. Build/package: `npm run build`; zero warning promoted by policy where applicable.
4. Manual/live: `LIVE_NA` — this ticket owns no runtime, scenario, external target, or publication surface.
5. Ownership: inspect `git diff --name-only <base>...<head>` and reject every unowned path, including any edit to `.v1.json`/`.v2.json` beyond the read-only marker.

## Stop and escalation

- Stop on ambiguous authority, missing ownership, malformed schema/registry, stale digest, wrong target, an attempt to merge or skip a CEO step-gate, a proposed CommitLore or new subsystem, an edit to frozen `.v1.json`/`.v2.json` content, timeout without a terminal state, or partial state.
- Stop and escalate rather than broaden scope if closing this contract requires editing `docs/decisions/PRE-IMPLEMENTATION-GATE-ADMINISTRATION.md` or `docs/decisions/MAINTAINER-GATE-STATUS.md`, or if migrating the D0-001 lineage requires touching `.v1.json`/`.v2.json` bytes.
- A dependency or contract defect is escalated to its owning ADR/PRD/ticket; do not broaden this ticket.

## Completion evidence

- Exact base/head SHA, mutant RED receipts, canonical focused/full/build receipts.
- Acceptance-to-test result table for AC-D0-006-1 through AC-D0-006-8.
- ADR-set batch and ticket-packet digest report, fan-out invalidation report (single-ADR and shared-ADR cases), and frozen-history byte-identity report for `.v1.json`/`.v2.json`.
- Security/privacy/fail-closed/wrong-target/timeout/partial-state review and stale-evidence invalidation statement.
- Exact-head cumulative reviewer verdict and CI receipt before merge eligibility.

## Invalidation

Any change to the SSOT, ADR-set batch composition or digests, owning PRD, this exact ticket, the unified registry, the gate schema, the validator, runtime identity, or candidate head invalidates the affected evidence and returns this lane to the earliest changed gate.
