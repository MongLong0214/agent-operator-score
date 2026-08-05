# PRD E0-A — Encode the frozen M01–M20 registry and the complete score-issuance predicate before scoring code.

- Status: **PROPOSED — CEO GATE REQUIRED**
- Milestone: S0 · Name & Contracts
- Dependencies: D0; ADR-0004, 0005, 0006
- Authority: `docs/north-star/agent-operator-score-ssot-v1.0.md`

## Goal

Encode the frozen M01–M20 registry and the complete score-issuance predicate before scoring code.

## Non-goals

- No metric implementation, calibration weights, new metrics, percentile, or judge.

## Functional and contract requirements

1. Represent factor, question, evidence class, opportunity rule, gaming guard, treatment route, and consumer route for exactly M01–M20.
2. Represent independent opportunity IDs and NOT_OBSERVED semantics.
3. Encode all ten issuance requirements from SSOT §6.1, including required M15–M20 coverage and factor minima.
4. Pin O/P weights, harmonic mean, zero semantics, F1–F6 presentation mapping, S0–S3 safety gate, raw precision, five-point display rounding, and version identity.

## Acceptance criteria

- AC-E0A-1: registry validation rejects M21, gaps, duplicates, dead routes, and unknown evidence classes.
- AC-E0A-2: issuance truth-table fixtures cover every missing required condition independently.
- AC-E0A-3: score formula vectors include O=0, P=0, NOT_OBSERVED, safety S2/S3, and rounding boundaries.

## Failure and stop semantics

- Missing prerequisite, ambiguous ownership, unsupported observability, unsafe permission, wrong target, silent fallback, stale evidence, timeout without a terminal state, or partial-state ambiguity is a hard stop.
- A failed acceptance criterion blocks this epic and every dependent epic; scope cannot be broadened to manufacture PASS.
- Any material edit after approval returns this PRD to PROPOSED and invalidates dependent ticket approval.

## Required completion evidence

- Exact base and exact candidate-head SHA.
- RED command, failing test name, and expected failure reason captured before GREEN.
- Focused, full, build/package, and required manual/live lane outputs tied to candidate head.
- Acceptance-to-test matrix with no orphan requirement or orphan test.
- Diff ownership audit, security/privacy/fail-closed review, and stale-evidence invalidation statement.
