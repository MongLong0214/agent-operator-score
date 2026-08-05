# PRD E0-D — Make every input and tie-break in deterministic one-lever selection executable and fixture-backed.

- Status: **PROPOSED — CEO GATE REQUIRED**
- Milestone: S0 · Name & Contracts
- Dependencies: E0-A, E0-C; ADR-0010
- Authority: `docs/north-star/agent-operator-score-ssot-v1.0.md`

## Goal

Make every input and tie-break in deterministic one-lever selection executable and fixture-backed.

## Non-goals

- No generated advice, learned uplift model, or multiple simultaneous treatments.

## Functional and contract requirements

1. Define formula/range/missing/tie-break/source-events/fixture/version for confidence, normalized gap, opportunity count, treatment cost, permission delta, expected uplift, and transferability.
2. Freeze factor priority F5→F4→F1→F2→F3→F6 for ties/three-point band.
3. Freeze M01–M20 treatment map and safety-remediation path.
4. Define `MANUAL_REVIEW_REQUIRED` and deterministic decision trace.

## Acceptance criteria

- AC-E0D-1: every input field has a total formula or explicit missing rule.
- AC-E0D-2: safety, confidence, opportunity, tie, lower-cost, permission, and abstention fixtures return one stable outcome.
- AC-E0D-3: selector cannot return more than one ordinary lever.

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
