# PRD F2 — Deterministic scorer and conformance fixtures

- Milestone: M1 · G0 Scorer Truth (2026-08-26) · ADR: 0004, 0006, 0010

## Goal

Implement deterministic metric eligibility, AOS-P0, evidence/safety issuance, and reference fixtures that establish G0 scorer truth.

## Non-goals

No calibrated percentile, learned score model, free-form diagnosis, or LLM override of deterministic verdicts.

## User stories

- As an independent user, I get bit-for-bit identical output from the same fixture.
- As a safety reviewer, unsafe or stale evidence can never be averaged away.

## Requirements

1. Treat no-opportunity metrics as `NOT_OBSERVED`, not zero.
2. Apply the frozen Outcome/Process harmonic formula.
3. Enforce coverage, identity, evidence integrity, and M19 hard gates.
4. Ship pass, fail, false-completion, stale, duplicate, and unsafe fixtures.

## Acceptance

- AC-F2-1: repeated scoring produces byte-identical canonical JSON.
- AC-F2-2: each fixture fails or passes for its registered reason.
- AC-F2-3: deterministic verdicts cannot be overwritten by a judge response.
