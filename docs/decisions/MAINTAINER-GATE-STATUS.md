# Historical Maintainer Gate status snapshot

Date: 2026-08-06

**HISTORICAL SNAPSHOT — NEVER USE FOR CURRENT READINESS.** This file preserves the gate-administration state observed on its date. The canonical gate data is `maintainer-gate-registry.v2.json`; current readiness must follow the interim direct-fact rule in `AGENTS.md` and, after D0-004 is verified, `npm run ops:status -- --strict`. This snapshot, its tables, and its next-action prose are not resolver inputs or execution authorization.

| Layer | Census | State | Effect |
|---|---:|---|---|
| Final SSOT | 1 | FINAL / owner-supplied | Derived planning may be drafted. |
| Gate Administration control plane | 1 | ACTIVE / three prior D0-001 batches `INVALIDATED`; bounded-RED renewal structurally `ACCEPTED` | The bounded-RED digest renewal is structurally ACCEPTED, is not execution authorization, and exact-head CEO review and CI are required. |
| ADR | 12 | PROPOSED | PRD approval blocked. |
| PRD | 19 | PROPOSED | Ticket approval blocked. |
| Atomic tickets | 64 executable | BLOCKED | Product implementation forbidden. |
| Superseded record | 1 (D0-003) | SUPERSEDED | Evidence-only; it owns no implementation. |
| Product code | Computed by validator | NOT STARTED | The current planning validator computes the census; semantic ownership enforcement is not yet implemented. |
| Publication | — | BLOCKED through E14/G4 | Repository/package release forbidden. |

## Required next gate order

1. The bounded-RED renewal binds the five current prerequisite digests and reviewed artifact head `53abf77c724bffc785bc9820ef9bbe5ffece89d3`; the independent checker rejects malformed, wrong-target, stale-digest, partial, or self-approved records.
2. Main performs the external exact-head CEO review and requires exact-head CI before accepting the final correction candidate.
3. Only after that review, merge verification, post-merge `dev` CI, and a fresh execution packet are verified may RED restart for that ticket.

A changed reviewed artifact or reviewed head invalidates the affected accepted batch; a new batch and renewed review are required. The canonical v2 registry retains three invalidated D0-001 batches and one structurally accepted bounded-RED renewal. No mutable record can self-approve or authorize execution.

The local checker is structural only: it reads only the canonical regular non-symlink registry inside this repository and emits `GATE_ADMINISTRATION_STRUCTURAL_PASS`, never authorization. CEO activation, protected independent review/CI, and final-receipt exact-head facts remain external gate evidence; mutable identity strings in a registry do not authenticate them.
