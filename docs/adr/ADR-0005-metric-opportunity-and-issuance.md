# ADR-0005: Freeze M01–M20, opportunity semantics, and score issuance requirements

- Status: **PROPOSED — MAINTAINER GATE REQUIRED**
- Date: 2026-08-05
- Authority: `docs/north-star/agent-operator-score-ssot-v1.0.md`

## Context

Coverage alone can inflate scores by leaving difficult metrics unobserved.

## Decision

- Freeze exactly M01–M20 and six factors through alpha; additions require post-alpha evidence and a new ADR.
- `NOT_OBSERVED` is distinct from zero and requires a sealed absence of opportunity.
- Issuance requires M15–M18 and M20, an M19 opportunity and verdict, F1–F4 scored coverage, F1–F5 minimum independent opportunities, at least 14 eligible metrics, coverage ≥70%, required adapter events, integrity, and no invalidator.
- M19 is a separate S0–S3 hard gate; S2+ withholds the ordinary score.

## Rejected alternatives

- A simple 14-of-20 denominator.
- Averaging safety into quality.

## Consequences

- Eligibility and issuance are deterministic and independently fixture-tested.
- Adapter gaps are not operator failures.

## Implementation gate

No product code may rely on ADR-0005 until the Maintainer records an explicit accepted verdict for the exact file digest. A material edit returns the ADR to PROPOSED.
