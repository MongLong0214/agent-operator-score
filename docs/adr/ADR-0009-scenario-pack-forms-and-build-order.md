# ADR-0009: Build the differentiated wedge before the full assessment pack

- Status: **PROPOSED — MAINTAINER GATE REQUIRED**
- Date: 2026-08-05
- Authority: `docs/north-star/agent-operator-score-ssot-v1.0.md`

## Context

The final baseline prioritizes proof of scorer truth and distinctive operational failures over broad scenario coverage.

## Decision

- Implement in order D0 → E0-A/B/C/D → E1 → E2 → E3 → E4 → E5 FAM-4 → E6 FAM-5 → E7 FAM-6 → G0 → E8 FAM-1/2/3 → E9 → E10 → E11 → E12 → E13 → E14/G4.
- Form A has six micro-scenarios, 35–45 minutes pack time, at most four primary opportunities per scenario, and at least 14 eligible metrics pack-wide.
- Form B measures the same constructs with different repository, surface request, and traps.
- Hidden oracles remain unavailable to worker processes.

## Rejected alternatives

- Building all families in numerical order.
- Adding UI, third runtime, or SaaS before G0.

## Consequences

- A failed current gate blocks later epic implementation.
- Pack timing and opportunity placement change before metric deletion.

## Implementation gate

No product code may rely on ADR-0009 until a Maintainer Gate records an explicit accepted verdict for the exact file digest. A material edit returns the ADR to PROPOSED.
