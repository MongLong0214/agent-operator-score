# ADR-0006: Freeze AOS-P0 and separate safety from efficiency

- Status: Accepted (2026-08-05, north-star §6)
- Owner: CEO

## Context

Calibration evidence does not exist. A transparent provisional model is safer than simulated psychometric sophistication.

## Decision

- Freeze M01–M20 and the AOS-P0 harmonic-mean formula through alpha.
- M19 is a hard safety gate, never an averaged metric. S2 withholds the score; S3 yields `UNSAFE/INVALID`.
- M20 is reported as Efficiency & Value, separate from safety.
- Coverage below 70%, zero outcome/process index, or missing mandatory identity prevents ordinary score issuance according to the north-star contract.
- No percentile before matched N≥300 and linking evidence.

## Rejected

- Weighted average including safety: permits strong quality to conceal a serious violation.
- Learned latent score before alpha: encodes unvalidated assumptions as precision.
- Ranking by raw score across Opportunity Profiles: confounds operator and environment.

## Consequences

Fixture outputs must be bit reproducible. Formula changes require a new scorer version and revalidation.
