# Maintainer Gate status

Date: 2026-08-05

| Layer | Census | State | Effect |
|---|---:|---|---|
| Final SSOT | 1 | FINAL / owner-supplied | Derived planning may be drafted. |
| Gate Administration control plane | 1 | ACTIVE / historic canonical v2 `PENDING → ACCEPTED → INVALIDATED`; fresh renewal `PENDING` | The historic D0-001 acceptance is invalidated; the separate digest-bound renewal is PENDING, and there is no current acceptance and renewed external review is required. |
| ADR | 12 | PROPOSED | PRD approval blocked. |
| PRD | 19 | PROPOSED | Ticket approval blocked. |
| Atomic tickets | 64 executable | BLOCKED | Product implementation forbidden. |
| Superseded record | 1 (D0-003) | SUPERSEDED | Evidence-only; it owns no implementation. |
| Product code | Computed by validator | NOT STARTED | The current planning validator computes the census; semantic ownership enforcement is not yet implemented. |
| Publication | — | BLOCKED through E14/G4 | Repository/package release forbidden. |

## Required next gate order

1. An authorized Gate Administrator prepares a fresh digest-bound `PENDING` renewal batch; the independent checker rejects malformed, wrong-target, stale-digest, partial, or self-approved records.
2. A different Maintainer performs external exact-head review and CI of the final renewal candidate and accepts or rejects it externally.
3. Only after that renewed exact batch and a fresh execution packet are independently verified may RED be authorized for that ticket.

A changed reviewed artifact or reviewed head invalidates the affected accepted batch; a new pending batch and renewed review are required. The canonical v2 registry records `PENDING → ACCEPTED → INVALIDATED` for D0-001 because its ticket digest changed. That historic transition is not current acceptance and cannot self-approve.

The local checker is structural only: it reads only the canonical regular non-symlink registry inside this repository and emits `GATE_ADMINISTRATION_STRUCTURAL_PASS`, never authorization. CEO activation, protected independent review/CI, and final-receipt exact-head facts remain external gate evidence; mutable identity strings in a registry do not authenticate them.
