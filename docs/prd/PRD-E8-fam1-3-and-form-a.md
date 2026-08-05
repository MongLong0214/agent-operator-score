# PRD E8 — Add FAM-1 Intent, FAM-2 Context, FAM-3 Graph and freeze a complete Form A only when timing and eligibility pass.

- Status: **PROPOSED — MAINTAINER GATE REQUIRED**
- Milestone: S3 · Full Form A & Second Runtime
- Dependencies: G0 PASS via E7; ADR-0009
- Authority: `docs/north-star/agent-operator-score-ssot-v1.0.md`

## Goal

Add FAM-1 Intent, FAM-2 Context, FAM-3 Graph and freeze a complete Form A only when timing and eligibility pass.

## Non-goals

- No metric additions, solution-path enforcement, or post-hoc timing exclusions.

## Functional and contract requirements

1. Build contracting/ask-no-ask, context/decoy/stale/injection/no-retrieval, and DAG/routing/join/collision scenarios.
2. Keep scenario primary opportunities ≤4 and validate all secondary opportunities from trace.
3. Compose six-family pack with transitions, budgets, exposure, sealed oracles, required-core, factor minima, and prescription eligibility.
4. Run reference/scripted policies and freeze only if median ≤40m, p90 ≤45m and all issuance opportunity conditions pass.

## Acceptance criteria

- AC-E8-1: each family discriminates registered constructs without rewarding formality or tool count.
- AC-E8-2: worker cannot access any hidden oracle.
- AC-E8-3: pack-level metric and time requirements pass simultaneously.
- AC-E8-4: failing timing adjusts scenario design, not metric count.

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
