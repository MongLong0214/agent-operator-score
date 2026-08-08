# PRD D0-GOV — Replace role-string gate claims with an advisory default and an authenticated-review activation path.

- Status: **PROPOSED — OWNER-RATIFIED ONE-TIME GOVERNANCE REPAIR + CEO GATE REQUIRED**
- Milestone: S0 · Name & Contracts
- Dependencies: Final SSOT; ADR-0012; ADR-0013
- Authority: `docs/north-star/agent-operator-score-ssot-v1.0.md`

## Goal

Define and implement a governance contract in which the current sole-owner condition is honestly advisory, unauthenticated legacy acceptance is quarantined without historical rewriting, and authenticated exact-head review can be activated only after independently verified GitHub controls exist.

## Transitional repair authority basis

The owner-ratified one-time governance repair plus the CEO gate is the sole authority basis for this exact repair packet. It authorizes bounded transitional planning-control-plane code and tests only, carries zero product-code authority, and cannot create a ready ticket, artifact acceptance, or artifact freeze. `SOLE_OWNER_ADVISORY` cannot replace that basis or accept this PRD, ADR-0013, or any D0-GOV ticket.

## Non-goals

- No product behavior, package publication, or change to the five digest-frozen artifacts bound by the legacy batch.
- No write to `docs/decisions/maintainer-gate-registry.v2.json` as part of this planning packet or as a substitute for authenticated approval.
- No fabricated approval, invalidation actor/event, external reviewer, GitHub issue number, branch-protection fact, or Node 22.18 approval.
- No automatic transition from advisory to authenticated review.

## Functional and contract requirements

1. Canonicalize `SOLE_OWNER_ADVISORY` as the current mode and prohibit it from emitting authorization, artifact freeze, `READY_FOR_RED`, or a separation-of-duties claim; define `AUTHENTICATED_REVIEW` as a separately activated mode only.
2. Derive v2 effective state so every existing structurally `ACCEPTED` row is `LEGACY_UNAUTHENTICATED`, preserving the original row and history while excluding it from authorization and freeze inputs.
3. Create a v3 artifact-manifest schema and fail-closed validator, then migrate legacy records with immutable provenance and no inferred acceptance effect.
4. Derive candidate acceptance from authenticated exact-head GitHub PR/review facts, with the derivation observable but inactive and incapable of authorizing or freezing artifacts before activation.
5. Activate `AUTHENTICATED_REVIEW` only after live verification of a distinct second principal, protected `dev`, stale-review dismissal, and bypass prevention; otherwise remain advisory and fail closed.
6. Enforce the closed transitional issue-binding contract: exactly `D0-005 → TBD-1` through `D0-009 → TBD-5`, with every other binding numeric. A placeholder has no GitHub issue identity, authority, readiness, or executable state. A successor planning PR must re-read GitHub identity, title, milestone, and labels; atomically replace the five placeholders with numeric bindings; remove the allowlist; and remove the transitional rule when the placeholder count reaches zero.

## Acceptance criteria

- AC-D0-GOV-1: the mode contract records `SOLE_OWNER_ADVISORY` as the current canonical fact and has an empty ready set, no artifact freeze, and no implicit activation path.
- AC-D0-GOV-2: active governance surfaces make no separation-of-duties claim in advisory mode and reject self-authored role strings as principal evidence.
- AC-D0-GOV-3: each existing v2 `ACCEPTED` row resolves as `LEGACY_UNAUTHENTICATED` without changing the source row, adding a fabricated actor/event, or treating its original approval as authenticated.
- AC-D0-GOV-4: legacy effective state contributes neither authorization nor an artifact freeze; the Node 22.18 correction remains unapproved until it has separate new-contract approval.
- AC-D0-GOV-5: v3 artifact manifests are schema-valid and bind exact artifact identities and migration provenance only; they reject missing/ambiguous inputs, never store an effective acceptance state, and preserve legacy records without upgrading their state.
- AC-D0-GOV-6: the inactive derivation requires a merged gate PR, exactly one `Gate-Batch`, a schema-valid v3 manifest present in that PR head, an authenticated merge commit and `merged_by`, and reviewer, author, and merger as three distinct authenticated principals; it is observable and still cannot authorize RED or freeze artifacts.
- AC-D0-GOV-7: activation requires a live verified second principal, `dev` branch protection with at least one required approving review, stale-review dismissal, administrator enforcement, and no user/team/app bypass allowance.
- AC-D0-GOV-8: after activation, stale reviews, changed heads, absent protection, bypass, ambiguous identity, or unavailable GitHub facts fail closed; the mode remains or returns to advisory rather than manufacturing readiness.
- AC-D0-GOV-9: malformed, duplicate, missing, wrong-pair, numeric-to-placeholder, and issue-map-versus-manifest placeholder-binding mutations fail closed, while the exact five permitted placeholders remain non-authorizing and removable only through the stated successor-planning-PR path.

## Failure and stop semantics

Any missing, stale, ambiguous, self-authored, wrong-head, unavailable, or bypassable fact blocks activation and leaves the ready set empty. A legacy record is historical evidence only. A changed artifact, including the Node 22.18 correction, requires a new separate approval; scope may not be widened to reuse a legacy digest or role string.

## Required completion evidence

- Exact base and candidate-head SHA, authority digests, runtime/toolchain identity, permission profile, and owned paths/symbols.
- RED receipts with each ticket's named expected failure before GREEN.
- Focused, full, build/package, and required manual/live receipts bound to the exact candidate head.
- Machine-readable effective-state, migration-provenance, derivation, and activation reports with no secret values or raw project uploads.
- Cumulative exact-head authenticated review, exact-head CI, and a separate explicit merge authorization where the active mode permits them.

## Invalidation

Any change to the mode contract, effective-state algorithm, source registry bytes, v3 schema/manifest, GitHub adapter, exact head, branch protection, principal permissions, bypass allowance, review state, or activation configuration invalidates the affected evidence. A changed head dismisses its prior review and cannot inherit authorization or artifact freeze.
