# Pre-implementation Gate Administration Control Plane

- Status: **PROPOSED — CEO EXACT-HEAD ACCEPTANCE REQUIRED**
- Dependencies: None
- Authority: ADR-0012; this decision is a planning/control-plane correction only.

## Purpose and boundary

This control plane exists before any product-ticket execution so a Gate Administrator can record an exact-digest Maintainer Gate batch without depending on D0-004, D0-002, RED, or product code. It does not accept an ADR, PRD, or ticket; the registry committed with this correction remains `PENDING` with no recorded artifact or transition.

It owns only the administration record and its independent fail-closed checker:

| Owner | Paths/symbols |
|---|---|
| Pre-implementation Gate Administration | This decision; `docs/decisions/MAINTAINER-GATE-STATUS.md`; `docs/decisions/maintainer-gate.schema.json`; `docs/decisions/maintainer-gate-registry.v2.json`; `scripts/validate-gate-administration.mjs` (`validateGateAdministration`); `tests/gate-administration-contract.test.mjs` |
| D0-004, after its own gates and D0-002 complete | `scripts/validate-planning.mjs`, `tests/planning-contract.test.mjs`, and the semantic-validator portions of `docs/TRACEABILITY.md`; it may consume an independently valid gate record but must not own, write, or approve the administration surfaces above. |

No product path, package/workspace manifest, product test, or implementation ticket ownership is granted here. D0-004 continues to own its future semantic validator work; the separation prevents its dependency from becoming a prerequisite for recording the gates that precede it.

## Roles and separate acceptance

- A **Gate Administrator** prepares a batch and runs the independent checker. The role may create only a structurally valid *candidate* record.
- A **Maintainer** is the external reviewer named in an accepted batch. The schema requires `prepared_by` and `approved_by` to differ; a self-labelled JSON record is not proof of authorization.
- The **CEO** separately accepts this control-plane correction at its final exact candidate head, after cumulative review and CI. That acceptance is outside the Maintainer Gate registry and precedes any Gate Administrator action. It must not be inferred from this proposed document, a passing checker, or a GitHub issue state.
- The normal Maintainer exact-head review/CI remains required for every future accepted batch. A Maintainer may not approve their own batch, and D0-004 is never a Gate Administrator or approving authority.

## Record model and lifecycle

The registry starts with a declared D0-001 prerequisite batch. `required_artifacts` and `required_transitions` state what a future record must close, but are not acceptance evidence. A batch may progress only as follows:

```text
PENDING --(complete exact batch, distinct Maintainer approval)--> ACCEPTED
PENDING --(rejected review)-------------------------------------> REJECTED
ACCEPTED --(artifact or reviewed-head change)-------------------> INVALIDATED
```

`INVALIDATED` is terminal for that batch ID. A renewed review uses a new `PENDING` batch ID; no state may silently return to `PENDING`. The registry-level status is a derived summary: `PENDING` for all-pending, `PARTIAL` for pending/accepted, `ACCEPTED` for all-accepted, `REJECTED` when a rejection exists, and `INVALIDATED` when an invalidation exists. The checker rejects any mismatch.

For an accepted batch, every declared required path must appear once in `artifacts` with a SHA-256 digest, every required phase must point to the appropriate artifact paths, and `reviewed_head` must resolve. The checker verifies that each digest matches both the active file and that path at `reviewed_head`; malformed JSON/schema, duplicate paths, unsafe paths, wrong kind/path, missing phase, wrong head, partial evidence, or a same-person approval fails closed. A material artifact edit or an artifact mismatch at the recorded head fails closed until the batch is explicitly invalidated and a fresh batch is reviewed.

The registry entry binds the reviewed artifact head. The reviewable **final receipt commit** is separately approved at its exact head by the Maintainer; if that candidate head changes before approval or merge, the review, CI, and proposed transition are stale and must be recreated. This avoids treating a post-review metadata write as evidence for a different head.

## Operating sequence

1. CEO reviews and accepts this correction's final exact head; that is a control-plane activation, not a product gate.
2. A Gate Administrator creates an accepted-batch candidate from the declared pending scope, with exact SHA-256 digests and a resolvable reviewed head, then runs `node scripts/validate-gate-administration.mjs`.
3. A different Maintainer performs external cumulative exact-head review and CI of that candidate. Only the reviewed final head may be merged as the acceptance record.
4. The execution packet independently verifies the accepted record, exact digests, target branch/base, dependency state, clean ownership, and its own ticket gate before RED. A structurally valid batch never substitutes for those checks.

## Non-authorizations and invalidation

This decision grants no ADR/PRD/ticket acceptance, no RED, no implementation authority, and no D0-001 execution authority. The current registry is deliberately still `PENDING`; all ADRs/PRDs/tickets remain proposed or blocked.

There are no accepted digest references to recompute in this correction. Any prior proposed review, test, CI, or candidate-head evidence for modified planning artifacts is invalidated; no pending item is promoted by that invalidation. CEO review of this candidate is the next required action.
