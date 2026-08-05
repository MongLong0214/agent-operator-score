# ADR-0010: Treat measurement validity and stop rules as product requirements

- Status: Accepted (2026-08-05, north-star §§7, 14)
- Owner: CEO

## Context

A reproducible scorer can still measure the wrong construct. The project must be allowed to disprove its own headline claim.

## Decision

- G0–G4 are ordered release gates. Deterministic oracles outrank model judges.
- Alpha evaluates person/task/session variance, known groups, judge agreement, duration, understanding, and Form B transfer.
- The individual 0–100 score is stopped or redesigned when person variance is too small, environment explains most variance, known groups do not separate, judges disagree persistently, p90 exceeds 45 minutes, Form A/B do not link, or safety false negatives are high.
- A diagnostic suite, trace spec, or coaching lab remains an acceptable pivot.

## Rejected

- Stars or adoption as validation: popularity does not establish measurement truth.
- Hiding negative alpha outcomes: makes the open method less trustworthy than the problem it claims to solve.
- Hiring or certification use: unsupported by local security and calibration evidence.

## Consequences

`VALIDATION.md`, `LIMITATIONS.md`, and `INTENDED_USE.md` are release blockers, not marketing appendices.
