# Pre-implementation Gate Administration Control Plane

- Status: **ACTIVE CONTROL PLANE — D0-001 HISTORIC BATCH INVALIDATED / RENEWAL STRUCTURALLY ACCEPTED / EXTERNAL REVIEW REQUIRED**
- Dependencies: None
- Authority: ADR-0012; this decision is a planning/control-plane correction only.

## Purpose and boundary

This control plane exists before any product-ticket execution so a Gate Administrator can record an exact-digest Maintainer Gate batch without depending on D0-004, D0-002, RED, or product code. It does not accept an ADR, PRD, or ticket. The canonical v2 D0-001 history is `PENDING → ACCEPTED → INVALIDATED`; its separate renewal is structurally `ACCEPTED` at reviewed artifact head `cc23a4b0585f9537dbfd00327c253d17d8ae4387`. The historical accepted digest record remains invalidated after its ticket changed. The renewed structural record is not authorization to execute and requires independent external exact-head review and CI.

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
- A **Maintainer** is the external reviewer named in an accepted batch. The schema requires `prepared_by` and `approved_by` to differ, but `prepared_by`, `approved_by`, and `recorded_by` are mutable identity strings: their format and distinction are structural checks only, never proof of independent authorization.
- The **CEO** separately accepts this control-plane correction at its final exact candidate head, after cumulative review and CI. That acceptance is outside the Maintainer Gate registry and precedes any Gate Administrator action. It must not be inferred from this proposed document, a passing checker, or a GitHub issue state.
- The normal Maintainer exact-head review/CI remains required for every future accepted batch. A Maintainer may not approve their own batch, and D0-004 is never a Gate Administrator or approving authority.

The CEO activation, protected independent review/CI, and final-receipt exact-head facts cannot be authenticated locally. They are **external gate evidence**. A local `GATE_ADMINISTRATION_STRUCTURAL_PASS` therefore reports `external_gate_evidence=required` whenever an accepted batch is structurally complete and always appends `not_authorization`. It emits the exact `candidate_head=<40-hex>` when Git `HEAD` exists; only an all-PENDING, no-Git planning fixture may instead emit `candidate_head=unavailable_pending`, which is explicitly non-authoritative and cannot record a transition.

## Record model and lifecycle

The registry retains the invalidated D0-001 prerequisite batch and carries a separate structurally ACCEPTED renewal batch. `required_artifacts` and `required_transitions` state what a record must close. The renewed record binds each required artifact to its current SHA-256 digest and exact reviewed artifact head; the mutable structural fields remain review inputs, not authenticated authorization. A batch may progress only as follows:

```text
PENDING --(complete exact batch, distinct Maintainer approval)--> ACCEPTED
PENDING --(rejected review)-------------------------------------> REJECTED
ACCEPTED --(artifact or reviewed-head change)-------------------> INVALIDATED
```

`INVALIDATED` is terminal for that batch ID. A renewed review uses a new `PENDING` batch ID; no state may silently return to `PENDING`. The registry-level status is a derived summary: `PENDING` for all-pending, `PARTIAL` for pending/accepted, `ACCEPTED` for all-accepted, `REJECTED` when a rejection exists, and `INVALIDATED` when an invalidation exists. The checker rejects any mismatch.

For every lifecycle record with Git `HEAD`, the canonical registry, canonical schema, and executed validator must each be byte-identical to their `HEAD:<path>` entries before structural PASS; a worktree-only PENDING, ACCEPTED, REJECTED, or INVALIDATED receipt, or mutation of either executable contract surface, fails closed. The sole no-HEAD exception is an all-PENDING planning fixture: it is non-authoritative, emits `unavailable_pending`, and cannot contain any transition or acceptance evidence. Any REJECTED, INVALIDATED, PARTIAL, or ACCEPTED record without Git `HEAD` fails closed. For an accepted batch, every declared required path must appear once in `artifacts` with a SHA-256 digest and every required phase must point to the appropriate artifact paths. The declared repository is the normalized canonical GitHub owner/repository remote (`github.com/MongLong0214/agent-operator-score`), not a mutable basename. The checker verifies that `refs/remotes/origin/<target branch>` exists, that the exact candidate `HEAD` is based on that ref, and that `reviewed_head` resolves and is an ancestor of that exact candidate `HEAD`; a feature branch or detached CI head based on the target ref is valid before merge. It then verifies that each digest matches both the active file and that path at `reviewed_head`; malformed JSON/schema, duplicate paths, unsafe paths, wrong kind/path, wrong actual target, exact-head surface mismatch, a missing target ref, an unrelated candidate, unresolved or non-ancestor reviewed head, partial evidence, or a same-person approval fails closed. A material artifact edit or an artifact mismatch at the recorded head fails closed until the batch is explicitly invalidated and a fresh batch is reviewed.

The registry entry binds the reviewed artifact head. The reviewable **final receipt commit** is separately approved at its exact head by the Maintainer; if that candidate head changes before approval or merge, the review, CI, and proposed transition are stale and must be recreated. This avoids treating a post-review metadata write as evidence for a different head.

## Operating sequence

1. The historical D0-001 batch remains invalidated; it is not a current acceptance or a product gate. The separate renewal is structurally ACCEPTED, binds the current five prerequisite digests at `cc23a4b0585f9537dbfd00327c253d17d8ae4387`, and is not execution authority.
2. The Gate Administrator records the complete renewal candidate from the declared scope and current SHA-256 digest bindings, then runs `node scripts/validate-gate-administration.mjs`.
3. A different Maintainer performs external cumulative exact-head review and CI of that final renewal candidate. Only the reviewed final head may be merged as the renewed acceptance record.
4. The execution packet independently verifies the renewed accepted record, exact digests, target branch/base, dependency state, clean ownership, and its own ticket gate before RED. A structurally valid batch never substitutes for those checks.

## Non-authorizations and invalidation

This decision grants no ADR/PRD/ticket acceptance, no RED, no implementation authority, and no D0-001 execution authority. The registry retains `PENDING → ACCEPTED → INVALIDATED` historic evidence and a separate structurally ACCEPTED renewal; its mutable structural approval record is not authenticated external authorization, and all ADRs/PRDs/tickets remain proposed or blocked.

The historic accepted digest references are retained only as invalidated evidence. Any prior proposed review, test, CI, or candidate-head evidence for modified planning artifacts is invalidated; no pending item is promoted by that invalidation. A fresh external review of a renewed candidate is the next required action.
