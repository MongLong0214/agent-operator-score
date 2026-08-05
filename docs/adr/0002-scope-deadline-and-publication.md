# ADR-0002: Freeze the 90-day OSS scope and defer public transition

- Status: Accepted (2026-08-05, owner-supplied FINAL north-star)
- Owner: CEO

## Context

The product is deliberately smaller than an assessment platform. The 90-day plan must not silently regain SaaS, commercial, credential, or multi-runtime scope.

## Decision

- S0–S4 ends 2026-11-03 KST.
- Factory tier is M: the input is an evidence-sensitive standard project, not an executable reference repository or paper-derived clone.
- The GitHub repository starts private and targets public OSS at M4 only after license, notices, intended-use, limitations, and external-reproduction gates pass.
- E0–E12 are the only roadmap epics. No third runtime or new metric enters the critical path.

## Rejected

- Public from the first commit: exposes an unlicensed, unvalidated assessment and bypasses the publication gate.
- SaaS-first: contradicts local-only privacy and adds account, telemetry, and multi-tenancy surfaces.
- “Ship a score now, validate later”: converts an untested hypothesis into false precision.

## Consequences

Backlog issues hold every cut item. Missing the deadline does not permit weakening G0–G4 or the evidence labels.

