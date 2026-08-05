# PRD E12 — Run a preregistered 20-person alpha to decide whether measurement, attribution, and prescription transfer exist.

- Status: **PROPOSED — CEO GATE REQUIRED**
- Milestone: S4 · Human Alpha & Retest
- Dependencies: E11; ADR-0011
- Authority: `docs/north-star/agent-operator-score-ssot-v1.0.md`

## Goal

Run a preregistered 20-person alpha to decide whether measurement, attribution, and prescription transfer exist.

## Non-goals

- No percentile/norm, post-hoc primary subset, hidden missingness, production certification, or calendar-driven PASS.

## Functional and contract requirements

1. Preregister population, novice/intermediate/expert balance, Form counterbalance, hypotheses, scorer/tasks, exclusion/invalid rules, missingness, analysis, and stopping.
2. Run 48–96 reference/scripted policy trials and n≥20 human assessments with blind expert review.
3. Estimate person/task/session signal, known-group separation, automatic/expert agreement, duration, profile effects, and transfer.
4. Publish `VALIDATION.md`, `LIMITATIONS.md`, `INTENDED_USE.md`, and G1/G2/G3 verdicts with deviations.

## Acceptance criteria

- AC-E12-1: every enrolled row and deviation is accounted for.
- AC-E12-2: median duration ≤45m and person signal exceeds task/session noise for G1.
- AC-E12-3: G2/G3 claims follow preregistered evidence or are reduced.
- AC-E12-4: failure activates the documented pivot, not metric shopping.

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
