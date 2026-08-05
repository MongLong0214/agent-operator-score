# PRD E0-C — Prove the 35–45 minute pack and required metric opportunities can coexist before building scenarios.

- Status: **PROPOSED — MAINTAINER GATE REQUIRED**
- Milestone: S0 · Name & Contracts
- Dependencies: E0-A, E0-B; ADR-0009
- Authority: `docs/north-star/agent-operator-score-ssot-v1.0.md`

## Goal

Prove the 35–45 minute pack and required metric opportunities can coexist before building scenarios.

## Non-goals

- No human calibration claim and no deletion of metrics to make the simulation pass.

## Functional and contract requirements

1. Preregister scenario overhead, operator policies, family budgets, primary opportunity caps, transition overhead, and uncertainty assumptions.
2. Simulate/reference-run median, p90, eligible metric count, factor minima, issuance core, and prescription eligibility together.
3. Reject double-counted opportunities and secondary metrics without an observed opportunity.
4. Emit a reproducible seed, input manifest, raw rows, summary, limitations, and PASS/FAIL.

## Acceptance criteria

- AC-E0C-1: valid pack reaches median ≤40m, p90 ≤45m, ≥14 eligible metrics, all factor/required-core minima, and one prescription-eligible path simultaneously.
- AC-E0C-2: slow, under-observed, double-counted, and prescription-ineligible fixtures fail for distinct reasons.
- AC-E0C-3: a failed simulation blocks Form A freeze without changing metric count.

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
