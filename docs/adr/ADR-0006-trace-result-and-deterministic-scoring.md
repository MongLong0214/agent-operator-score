# ADR-0006: Use versioned normalized traces, canonical results, and deterministic-first grading

- Status: **PROPOSED — MAINTAINER GATE REQUIRED**
- Date: 2026-08-05
- Authority: `docs/north-star/agent-operator-score-ssot-v1.0.md`

## Context

Independent rescoring and false-completion detection require stable evidence contracts.

## Decision

- Define `aos-trace` and `aos-result` JSON Schemas with bounded payloads, correlation IDs, digests, redaction state, and version identity.
- Store no hidden chain-of-thought or secret values.
- Use deterministic oracle, invariant, mutation, diff/state/policy checks before any model judge.
- Implement the frozen O/P harmonic-mean formula; preserve raw floats in JSON and display nearest five points before G1.
- Canonical serialization and scorer digest are required for every issued result.

## Rejected alternatives

- Free-form logs as the scoring contract.
- Allowing an LLM judge to override deterministic facts.

## Consequences

- Bit reproduction is G0.
- Schema or scorer changes invalidate dependent fixture and report evidence.

## Implementation gate

No product code may rely on ADR-0006 until the Maintainer records an explicit accepted verdict for the exact file digest. A material edit returns the ADR to PROPOSED.
