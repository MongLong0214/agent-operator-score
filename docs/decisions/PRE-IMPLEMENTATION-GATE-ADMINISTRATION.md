# Pre-implementation Gate Administration Control Plane

- Dependencies: None
- Authority: ADR-0012; this decision is a planning/control-plane correction only.

## Purpose and boundary

This control plane exists before any product-ticket execution so a Gate Administrator can record an exact-digest Maintainer Gate batch without depending on D0-004 implementation, D0-002 implementation, RED, or product code. It does not itself authorize an ADR, PRD, or ticket. The current registry census below is the sole batch-state inventory in this document. A structural record is not authorization to execute; exact-head technical review, existing CI, and explicit CEO production PASS remain required. Future advisory mode (SOLE_OWNER_ADVISORY) has no authenticated independent-review guarantee, no separation-of-duties claim, no authorization, and no artifact freeze.

It owns only the administration record and its independent fail-closed checker:

| Owner | Paths/symbols |
|---|---|
| Pre-implementation Gate Administration | This decision; `docs/decisions/MAINTAINER-GATE-STATUS.md`; `docs/decisions/maintainer-gate.schema.json`; `docs/decisions/maintainer-gate-registry.v2.json`; `scripts/validate-gate-administration.mjs` (`validateGateAdministration`); `tests/gate-administration-contract.test.mjs`; only the `gates=<status>` portion of `acceptedValidatorOutput` and `pendingValidatorOutput` in `tests/planning-contract.test.mjs` for Gate Administration lifecycle truth |
| Pre-implementation compatibility migration | `package.json` `scripts.test` only; `scripts/validate-planning.mjs` only to require, delegate to, and allowlist the independently owned administration checker; and only the `planning validator delegates gate records to the independent administration checker` test case with its direct delegation plumbing in `tests/planning-contract.test.mjs`. It explicitly excludes `acceptedValidatorOutput` and `pendingValidatorOutput`. This is a non-circular bootstrap allowance: it depends on no D0 ticket, permits no semantic-validator expansion, and grants no product authority. |
| D0-001, after its renewed gate | Only the numeric `control_plane_code_files` literal in `acceptedValidatorOutput` and `pendingValidatorOutput` for its future 4→6 census change when `scripts/validate-identity.mjs` and `tests/planning/identity.test.mjs` are introduced; it does not own the `gates=<status>` portion or any remaining symbol. |
| D0-004, after its own gates and D0-002 complete | The semantic-validator portions of `scripts/validate-planning.mjs`, the remainder of `tests/planning-contract.test.mjs` outside the D0-001 numeric literal, the isolated fixture setup/teardown and canonical-validator preservation regression for the existing D0 identity allowlist test, Gate Administration `gates=<status>` portion, and the compatibility migration's exact delegation test case/plumbing, and `docs/TRACEABILITY.md`; it may consume an independently valid gate record but must not own, write, or approve the administration surfaces above. |

No product path, workspace layout, product test, or implementation ticket ownership is granted here. The named `package.json` test-discovery migration is the sole package-manifest exception. D0-004 continues to own its future semantic validator work; the separation prevents its dependency from becoming a prerequisite for recording the gates that precede it.

The production checker reads only `docs/decisions/maintainer-gate-registry.v2.json`; it accepts no registry-path flag or programmatic root override. Lifecycle timestamps must be strict RFC 3339 values with a UTC designator or numeric offset and a valid calendar date. That canonical path must be a regular non-symlink file and its real path must remain inside the repository. Isolated tests construct that same canonical relative path rather than substituting a sibling fixture.

## Roles and separate acceptance

- A **Gate Administrator** prepares a batch and runs the independent checker. The role may create only a structurally valid *candidate* record.
- A **Maintainer** record carries the structural `prepared_by`, `approved_by`, and `recorded_by` fields. Their values must satisfy the checker, but they may be recorded sequentially by the one authenticated repository owner in `single_owner_agent_team` mode. They are mutable structural fields and remain `not_authorization`, never proof of independent authorization. Unequal role strings are not two principals and are not a separation-of-duties claim.
- The **CEO** separately provides explicit production PASS at the final exact candidate head, after cumulative review and CI. That PASS is outside the Maintainer Gate registry and is required before merge. It must not be inferred from this proposed document, a passing checker, or a GitHub issue state.
- Independent exact-head technical review, existing CI, and explicit CEO production PASS remain required for every accepted candidate. Before D0-004C merges, future resolver/workflow checks are `NOT_REQUIRED_UNTIL_D0_004C`; after that merge their absence fails closed. D0-004 implementation is never a Gate Administrator or approving authority.

The exact-head technical review, CI, and final CEO PASS facts cannot be authenticated locally. They are **external gate evidence**. A local `GATE_ADMINISTRATION_STRUCTURAL_PASS` therefore reports `external_gate_evidence=required` whenever an accepted batch is structurally complete and always appends `not_authorization`. It emits the exact `candidate_head=<40-hex>` when Git `HEAD` exists; only an all-PENDING, no-Git planning fixture may instead emit `candidate_head=unavailable_pending`, which is explicitly non-authoritative and cannot record a transition.

## Record model and lifecycle

The registry retains all four invalidated D0-001 prerequisite batches, the invalidated prior D0-002 renewal, and the invalidated prior D0-004 single-owner Bootstrap candidate as historical records and carries the current structurally `ACCEPTED` D0-002 renewal and D0-004 B-harness carve-out renewal. `required_artifacts` and `required_transitions` state what a record must close. Each accepted record binds every required artifact to its SHA-256 digest and exact reviewed artifact head; mutable structural fields remain review inputs, not authenticated authorization. A batch may progress only as follows:

```text
PENDING --(complete exact batch, structural approval record)----> ACCEPTED
PENDING --(rejected review)-------------------------------------> REJECTED
ACCEPTED --(artifact or reviewed-head change)-------------------> INVALIDATED
```

`INVALIDATED` is terminal for that batch ID. A renewed review uses a new `PENDING` batch ID; no state may silently return to `PENDING`. The registry-level status is a derived summary: `PENDING` for all-pending, `PARTIAL` for pending/accepted, `ACCEPTED` for all-accepted, `REJECTED` when a rejection exists, and `INVALIDATED` when an invalidation exists. The checker rejects any mismatch.

For every lifecycle record with Git `HEAD`, the canonical registry, canonical schema, and executed validator must each be byte-identical to their `HEAD:<path>` entries before structural PASS; a worktree-only PENDING, ACCEPTED, REJECTED, or INVALIDATED receipt, or mutation of either executable contract surface, fails closed. The sole no-HEAD exception is an all-PENDING planning fixture: it is non-authoritative, emits `unavailable_pending`, and cannot contain any transition or acceptance evidence. Any REJECTED, INVALIDATED, PARTIAL, or ACCEPTED record without Git `HEAD` fails closed. For an accepted batch, every declared required path must appear once in `artifacts` with a SHA-256 digest and every required phase must point to the appropriate artifact paths. The declared repository is the normalized canonical GitHub owner/repository remote (`github.com/MongLong0214/agent-operator-score`), not a mutable basename. The checker verifies that `refs/remotes/origin/<target branch>` exists, that the exact candidate `HEAD` is based on that ref, and that `reviewed_head` resolves and is an ancestor of that exact candidate `HEAD`; a feature branch or detached CI head based on the target ref is valid before merge. It then verifies that each digest matches both the active file and that path at `reviewed_head`; malformed JSON/schema, duplicate paths, unsafe paths, wrong kind/path, wrong actual target, exact-head surface mismatch, a missing target ref, an unrelated candidate, unresolved or non-ancestor reviewed head, partial evidence, or equal preparer/approver field values fails closed. A material artifact edit or an artifact mismatch at the recorded head fails closed until the batch is explicitly invalidated and a fresh batch is reviewed.

The registry entry binds the reviewed artifact head. The reviewable **final receipt commit** requires independent exact-head technical review, existing CI, and explicit CEO production PASS; if that candidate head changes before approval or merge, the review, CI, and proposed transition are stale and must be recreated. This avoids treating a post-review metadata write as evidence for a different head.

## Current registry census

| Batch | Registry status |
| --- | --- |
| `d0-001-prerequisites` | INVALIDATED |
| `d0-001-prerequisites-renewal` | INVALIDATED |
| `d0-001-prerequisites-contract-correction-renewal` | INVALIDATED |
| `d0-001-prerequisites-red-contract-renewal` | INVALIDATED |
| `d0-002-prerequisites` | INVALIDATED |
| `d0-002-prerequisites-adr-0003-renewal` | INVALIDATED |
| `d0-002-prerequisites-adr-0003-contract-correction-renewal` | INVALIDATED |
| `d0-002-prerequisites-red-census-contract-correction-renewal` | ACCEPTED |
| `d0-004-prerequisites-single-owner-bootstrap` | INVALIDATED |
| `d0-004-prerequisites-b-harness-carveout-renewal` | INVALIDATED |
| `d0-004-prerequisites-completion-marker-receipt-renewal` | ACCEPTED |
| `d0-013-prerequisites` | ACCEPTED |
| `d0-012-prerequisites` | ACCEPTED |
| `d0-011-prerequisites` | INVALIDATED |
| `d0-011-census-corrected-prerequisites` | ACCEPTED |
| `d0-005-owner-direction-prerequisites` | ACCEPTED |
| `d0-006-owner-direction-prerequisites` | ACCEPTED |
| `d0-007-owner-direction-prerequisites` | ACCEPTED |
| `d0-008-owner-direction-prerequisites` | ACCEPTED |
| `d0-009-owner-direction-prerequisites` | ACCEPTED |
| `d0-001-owner-direction-prerequisites` | ACCEPTED |
| `e0a-001-e0a-002-e0a-003-owner-direction-prerequisites` | ACCEPTED |
| `e0b-001-e0b-002-e0b-003-owner-direction-prerequisites` | ACCEPTED |
| `e0c-001-e0c-002-e0c-003-owner-direction-prerequisites` | ACCEPTED |
| `e2-001-e2-002-e2-003-e2-004-e2-005-owner-direction-prerequisites` | ACCEPTED |
| `e3-001-e3-002-e3-003-e3-004-owner-direction-prerequisites` | ACCEPTED |

## Operating sequence

1. All D0-001 prerequisite batches remain invalidated; none is a current planning acceptance or execution authority. D0-001 implementation completion is retained solely as historical post-merge completion evidence. Current structural candidates are the D0-002 renewal and the D0-004 B-harness carve-out renewal; each binds five current prerequisite digests and neither is execution authority.
2. The Gate Administrator records the complete D0-004 B-harness carve-out renewal from the declared scope and current SHA-256 digest bindings, then runs `node scripts/validate-gate-administration.mjs`.
3. Independent exact-head technical review, existing CI, and explicit CEO production PASS are required for the final candidate. Only that reviewed final head may be merged.
4. The execution packet independently verifies the renewed accepted record, exact digests, target branch/base, dependency state, clean ownership, and its own ticket gate before RED. A structurally valid batch never substitutes for those checks.

## Non-authorizations and invalidation

This decision grants no product implementation authority and no D0-001 execution authority. The current registry census above is the sole batch-state inventory in this document; mutable structural approval records are not authenticated authorization, and D0-004 RED remains blocked until its exact-head review, CI, CEO PASS, and execution packet gates are independently satisfied. D0-001 verified post-merge completion remains historical completion evidence only. Advisory mode claims no separation of duties and cannot authorize RED, accept a gate, or freeze an artifact.

The historic accepted digest references are retained only as invalidated evidence. Any prior proposed review, test, CI, or candidate-head evidence for modified planning artifacts is invalidated; no pending item is promoted by that invalidation. A fresh exact-head review of a renewed candidate is the next required action.
