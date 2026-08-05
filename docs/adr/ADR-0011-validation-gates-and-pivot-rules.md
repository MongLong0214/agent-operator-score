# ADR-0011: Gate public claims on scorer truth, human signal, transfer, and open reproduction

- Status: **PROPOSED — CEO GATE REQUIRED**
- Date: 2026-08-05
- Authority: `docs/north-star/agent-operator-score-ssot-v1.0.md`

## Context

A coherent specification does not prove the assessment measures a stable human construct.

## Decision

- G0 requires bit-repro and detection of false completion, stale evidence, duplicates, unsafe action, insufficient evidence, and takeover semantics.
- G1 uses a preregistered n≥20 alpha and requires person signal greater than task/session noise and median ≤45 minutes.
- G2 checks attribution sanity across model/harness changes; G3 checks one-lever transfer; G4 requires open schemas/fixtures/scorer and external reproduction.
- Failure triggers the explicit claim-reduction or diagnostics pivot in the SSOT.

## Rejected alternatives

- Shipping a score because fixtures pass.
- Percentiles before matched N≥300.

## Consequences

- Calendar targets never override gates.
- All deviations and missingness remain in validation outputs.

## Implementation gate

No product code may rely on ADR-0011 until the CEO records an explicit accepted verdict for the exact file digest. A material edit returns the ADR to PROPOSED.
