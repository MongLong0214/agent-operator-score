# ADR-0004: Bind every score to an Opportunity Profile without pretending to deconfound it

- Status: **PROPOSED — MAINTAINER GATE REQUIRED**
- Date: 2026-08-05
- Authority: `docs/north-star/agent-operator-score-ssot-v1.0.md`

## Context

Observed results combine operator decisions, model/runtime/harness/tool effects, task difficulty, budgets, and session noise.

## Decision

- The assessment unit is the human operator in a declared Opportunity Profile.
- Every run records suite/form, language, runtime/adapter, exact model identity when observable, reasoning settings, harness/tool/permission/network/context/budget/intervention policy, and repository/environment digests.
- Opportunity Profile records conditions and blocks invalid comparisons; it does not statistically remove environment effects.
- Raw scores are directly comparable only for matched profiles or an approved bridge study.

## Rejected alternatives

- Treating environment complexity or model price as operator skill.
- Automatic cross-environment normalization without crossover evidence.

## Consequences

- Missing required identity blocks score issuance.
- Reports show differences without rank when profiles are unmatched.

## Implementation gate

No product code may rely on ADR-0004 until the Maintainer records an explicit accepted verdict for the exact file digest. A material edit returns the ADR to PROPOSED.
