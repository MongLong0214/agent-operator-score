# ADR-0010: Issue one deterministic lever and separate retest attribution

- Status: **PROPOSED — MAINTAINER GATE REQUIRED**
- Date: 2026-08-05
- Authority: `docs/north-star/agent-operator-score-ssot-v1.0.md`

## Context

Unbounded generated advice and mixed environment/operator changes make improvement claims uninterpretable.

## Decision

- P0 selects at most one lever using registered confidence, gap, opportunity count, treatment cost, permission delta, uplift class, transferability, and tie-break formulas.
- S2/S3 yields safety remediation only; indeterminate cases yield `MANUAL_REVIEW_REQUIRED`.
- Retests are explicitly Operator, Environment, or Combined; environment uplift is never labeled operator growth.
- No AOS-G or exact growth score exists before Form linking.

## Rejected alternatives

- LLM-generated coaching as the primary selector.
- Multiple simultaneous treatments.

## Consequences

- Each treatment has an immutable registry entry and fixture.
- Form B checks target improvement, M15–M17 non-degradation, M19 safety, and cost/intervention bounds.

## Implementation gate

No product code may rely on ADR-0010 until a Maintainer Gate records an explicit accepted verdict for the exact file digest. A material edit returns the ADR to PROPOSED.
