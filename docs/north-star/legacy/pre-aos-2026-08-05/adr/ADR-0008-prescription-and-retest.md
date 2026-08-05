# ADR-0008: Prescribe one deterministic lever and require transfer evidence

- Status: Accepted (2026-08-05, north-star §8)
- Owner: CEO

## Context

Free-form advice cannot distinguish diagnosis failure from treatment-selection failure and encourages plausible but unauditable coaching.

## Decision

- Apply the frozen factor priority and metric-to-treatment map.
- A candidate metric needs authoritative evidence confidence ≥0.70 and at least two valid opportunities.
- If rules cannot select exactly one treatment, return `MANUAL_REVIEW_REQUIRED`.
- Growth requires a different Form B, target-metric improvement, non-degradation of M15–M17, M19 safety, and acceptable cost/intervention.

## Rejected

- Multi-tip report: prevents attribution of improvement.
- LLM-generated treatment: nondeterministic and difficult to validate.
- Reusing Form A: confounds transfer with answer memory.

## Consequences

T-003 must prove the pack can generate an eligible prescription path; otherwise the design remains blocked before Form A freeze.
