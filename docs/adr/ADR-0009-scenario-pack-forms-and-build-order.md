# ADR-0009: Build the differentiated wedge before the full assessment pack, ordered by a dependency DAG

- Status: **PROPOSED — MAINTAINER GATE REQUIRED**
- Date: 2026-08-07
- Authority: `docs/north-star/agent-operator-score-ssot-v1.0.md`

## Context

The final baseline prioritizes proof of scorer truth and distinctive operational failures over broad scenario coverage. A single global total order caps throughput at one lane at a time even when ticket ownership is provably disjoint.

## Decision

- The canonical dependency source is the `dependencies` field of the normalized ticket catalog. Any roadmap ordering is a projection of it and carries no authority.
- Reference projection: D0 → E0-A/B/C/D → E1 → E2 → E3 → E4 → E5 FAM-4 → E6 FAM-5 → E7 FAM-6 → G0 → E8 FAM-1/2/3 → E9 → E10 → E11 → E12 → E13 → E14/G4.
- A ticket is READY only when: every declared dependency is verified complete; the owned path and symbol sets of all concurrently active lanes are disjoint; there is no conflict on shared manifest, lockfile, or control-plane surfaces; and the lane runs in an isolated worktree pinned to an exact base.
- Implementation may proceed in parallel across ready lanes. Integration and merge are serialized in a deterministic topological order.
- The wedge-first priority (prove scorer truth and distinctive operational failures before broad scenario coverage) is retained as a prioritisation heuristic over the DAG, not as a hard total order.
- Form A has six micro-scenarios, 35–45 minutes pack time, at most four primary opportunities per scenario, and at least 14 eligible metrics pack-wide.
- Form B measures the same constructs with different repository, surface request, and traps.
- Hidden oracles remain unavailable to worker processes.

## Rejected alternatives

- Building all families in numerical order.
- Retaining the global total order: caps throughput at one lane regardless of provably disjoint ownership.
- Unrestricted parallelism without a readiness predicate: permits shared-surface collisions.
- Adding UI, third runtime, or SaaS before G0.

## Consequences

- A failed dependency still blocks its dependents, but no longer blocks unrelated lanes.
- D0-007-dependency-dag-readiness owns readiness-predicate enforcement.
- Pack timing and opportunity placement change before metric deletion.

## Implementation gate

No product code may rely on ADR-0009 until a Maintainer Gate records an explicit accepted verdict for the exact file digest. A material edit returns the ADR to PROPOSED.
