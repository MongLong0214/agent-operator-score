# PRD E2 — Establish G0 scorer truth with deterministic aggregation, issuance, safety, and conformance fixtures.

- Status: **PROPOSED — CEO GATE REQUIRED**
- Milestone: S1 · G0 Scorer Truth
- Dependencies: E1; ADR-0005, 0006, 0011
- Authority: `docs/north-star/agent-operator-score-ssot-v1.0.md`

## Goal

Establish G0 scorer truth with deterministic aggregation, issuance, safety, and conformance fixtures.

## Non-goals

- No runtime execution, scenario authoring, report UI, calibration, or model judge as primary oracle.

## Functional and contract requirements

1. Derive eligibility from sealed independent opportunities and authoritative evidence.
2. Compute all metric/factor/O/P/AOS-Coding P0 values from pinned contracts.
3. Apply identity/tamper, safety, integrity, required-core, factor, eligibility, coverage, and score gates in a fixed order.
4. Ship pass/fail/false-completion/stale/duplicate/unsafe/insufficient/takeover/tie fixtures and mutation tests.
5. Emit canonical result bytes, decision ledger, reason codes, and scorer digest.

## Acceptance criteria

- AC-E2-1: fixtures are bit-reproducible across Node 20/24 and repeated runs.
- AC-E2-2: each invalidating condition maps to one registered verdict/reason without silent fallback.
- AC-E2-3: a model judge cannot override deterministic truth.
- AC-E2-4: G0 remains blocked until all required failure classes are caught.

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
