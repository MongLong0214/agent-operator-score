# PRD E5 — Build executable FAM-4 scenarios for continuity, transition, retry/idempotency, and stall handling.

- Status: **PROPOSED — CEO GATE REQUIRED**
- Milestone: S2 · Runner & Differentiated Wedge
- Dependencies: E4; ADR-0009
- Authority: `docs/north-star/agent-operator-score-ssot-v1.0.md`

## Goal

Build executable FAM-4 scenarios for continuity, transition, retry/idempotency, and stall handling.

## Non-goals

- No FAM-1/2/3 broad pack, UI, or self-report scoring.

## Functional and contract requirements

1. Seal family/form/version, budgets, worker visibility, faults, opportunity map, oracles, and exposure.
2. Create distinct resume/state-loss, reviewer-fail, duplicate-run, stale-checkpoint, and no-progress injections.
3. Measure M12–M14 primary opportunities and only evidence-backed secondary metrics.
4. Allow multiple valid implementations while grading invariants and terminal truth.

## Acceptance criteria

- AC-E5-1: resume succeeds only from current durable state and exact evidence.
- AC-E5-2: retry cannot duplicate registered effects or consume stale state.
- AC-E5-3: stalls terminate/block honestly within budget.
- AC-E5-4: opportunity audit proves no double attribution.

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
