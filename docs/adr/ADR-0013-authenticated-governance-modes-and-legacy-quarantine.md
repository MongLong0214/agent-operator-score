# ADR-0013: Define advisory and authenticated-review governance modes and quarantine unauthenticated legacy acceptance

- Status: **PROPOSED — OWNER-RATIFIED ONE-TIME GOVERNANCE REPAIR + CEO GATE REQUIRED**
- Date: 2026-08-08
- Authority: `docs/north-star/agent-operator-score-ssot-v1.0.md`

## Context

The current gate record has a structural separation-of-roles check, but that check is not authentication. At the planning base, all ten batches use a self-authored role string in `approved_by`, while all `prepared_by` values are unauthenticated locally-authored strings. The inequality between the two fields is therefore a naming convention, not evidence of two principals. This includes the literal value `independent-maintainer-external-review-required`, which says that external review is required rather than proving it occurred.

The activation preconditions require live GitHub facts and fail closed when those facts are absent, unavailable, or ambiguous. GitHub facts are nevertheless available to the repository: the existing execution-state resolver already treats `pr.merged_by` and reviews as first-class GitHub facts. The defect is in governance derivation, not in the availability of a source of authenticated evidence.

## Transitional repair authority

The explicit authority basis for this exact repair is the **owner-ratified one-time governance repair plus the CEO gate**. It authorizes only bounded transitional planning-control-plane code and its tests at the exact execution-packet base and candidate head. It conveys zero product-code authority, no artifact acceptance, no readiness, no artifact freeze, and no ongoing substitute for authenticated review.

## Decision

### Mode contract

The repository has exactly two governance modes.

1. `SOLE_OWNER_ADVISORY` is the canonical current fact. It records planning and operational observations but produces no authorization, no artifact freeze, and no claim of separation of duties. It may still report which planning work is next: `READY_FOR_RED` names a planning phase, not a permission to merge, and reporting it is an observation about planning completeness of exactly the kind advisory mode exists to record. Authenticated-review mode does not activate by implication, by an identity-like string, or because an existing record is structurally valid.
2. `AUTHENTICATED_REVIEW` may produce authorization and an artifact freeze only after D0-009 verifies and enables every activation precondition from live GitHub facts. Its derivation uses distinct authenticated principals and exact-head GitHub review facts, not mutable registry fields, comments, labels, issue state, or role strings.

The repository claims no separation of duties while `SOLE_OWNER_ADVISORY` is in force. Advisory review may be useful, but it is never a substitute for an authenticated independent reviewer.

### Legacy effective state

Existing v2 `ACCEPTED` rows are retained unchanged, with their original bytes and Git history intact. Their effective state is `LEGACY_UNAUTHENTICATED`, not accepted authority. This is a non-destructive reclassification:

- it adds no invented invalidation actor, event, or approval;
- it does not retouch an original approval to make it look genuine;
- it removes both authorization and artifact-freeze effect from the legacy row; and
- it does not automatically approve the Node 22.18 correction or any other changed artifact. Such work needs separately authenticated approval under the new contract.

### Delivery sequence

The contract is delivered only in this order: mode contract and claim removal; v2 effective-state quarantine; v3 artifact-manifest schema and legacy migration; inactive exact-head GitHub-review acceptance derivation; then separately authorized activation. Migration precedes derivation, and derivation remains inactive until activation proves a second principal, protected `dev`, stale-review dismissal, and bypass prevention.

## Rejected alternatives

- Treating `prepared_by != approved_by` as two-person evidence.
- Retrofitting a false historical invalidation or replacement approval into an existing row.
- Reusing old artifact digests as a freeze for the Node 22.18 correction.
- Activating review derivation before the live repository has a second principal and protected-branch controls.
- Treating a closed issue, label, comment, roadmap, board, or self-authored role string as authorization.

## Consequences

- The ready set carries no authorization in advisory mode. It identifies which tickets are
  planning-complete; it does not permit a merge, and the derivation says so alongside it with
  `claims_merge_authorization: false` and `governing_mode: SOLE_OWNER_ADVISORY`. An operator
  who treats a non-empty ready set as authorization is contradicted by the same output.
- Existing registry history remains auditable but cannot authorize implementation or freeze artifacts.
- A v3 manifest makes artifact identity and migration provenance explicit before an acceptance result can be derived; it never stores an effective acceptance state.
- Live GitHub access becomes a required, fail-closed dependency only for `AUTHENTICATED_REVIEW`; an outage or ambiguous fact leaves activation and authorization unavailable.

## Implementation gate

This repair's owner-ratified one-time governance repair plus CEO gate authorizes bounded transitional planning-control-plane code and tests only. It conveys zero product-code authority and does not make D0-GOV, an atomic ticket, a registry row, or an artifact accepted. Every later implementation still requires the applicable authenticated authority chain and exact-base execution packet.
