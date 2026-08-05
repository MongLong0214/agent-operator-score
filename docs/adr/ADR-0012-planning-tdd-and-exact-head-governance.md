# ADR-0012: Require gated ADR, PRD, atomic ticket, TDD, cumulative review, and exact-head evidence

- Status: **PROPOSED — MAINTAINER GATE REQUIRED**
- Date: 2026-08-05
- Authority: `docs/north-star/agent-operator-score-ssot-v1.0.md`

## Context

Low-context implementers need bounded ownership and evidence that remains valid only for the reviewed revision.

## Decision

- The SSOT is the sole product-level authority. Accepted ADRs, PRDs, and exact tickets constrain implementation but cannot override SSOT direction, metric set, architecture, or order.
- No product code is written until the owning ADR set, PRD, and exact ticket each pass an explicit Maintainer Gate.
- Every ticket names files/symbols, dependencies, forbidden scope, RED and expected failure, minimum GREEN, AC-to-test mapping, focused/full/build/manual lanes, invalidation, stop conditions, and evidence.
- RED precedes GREEN; implementation is minimal; cumulative review covers all prior obligations.
- Any candidate-head change invalidates affected tests, artifacts, reviews, and CI until rerun.
- `docs/decisions/maintainer-gate.schema.json` and its registry are the machine-readable record for ADR-batch acceptance, epic-PRD acceptance, exact-ticket readiness for RED, SHA-256 bindings, and digest invalidation; a pending registry cannot self-approve.

## Rejected alternatives

- Epic-sized implementation tickets.
- CI green as a substitute for exact-head review.

## Consequences

- The ticket registry is executable governance, not a roadmap summary.
- Ambiguity, ownership overlap, missing observability, wrong target, unsafe permissions, silent fallback, timeout, or partial state stops work.

## Implementation gate

No product code may rely on ADR-0012 until a Maintainer Gate records an explicit accepted verdict for the exact file digest. A material edit returns the ADR to PROPOSED.
