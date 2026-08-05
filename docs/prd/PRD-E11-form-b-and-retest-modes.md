# PRD E11 — Implement linked but non-reused Form B, one-lever sprint records, and explicit retest attribution modes.

- Status: **PROPOSED — CEO GATE REQUIRED**
- Milestone: S4 · Human Alpha & Retest
- Dependencies: E10; ADR-0009, 0010
- Authority: `docs/north-star/agent-operator-score-ssot-v1.0.md`

## Goal

Implement linked but non-reused Form B, one-lever sprint records, and explicit retest attribution modes.

## Non-goals

- No AOS-G, exact growth score, repeated Form A growth claim, or mixed-change operator attribution.

## Functional and contract requirements

1. Create Form B with different repository, surface request, traps, and exposure digest but matched constructs/opportunity policy.
2. Record one treatment, adherence, deviations, costs, immutable baseline, and form exposure locally.
3. Classify retest as Operator, Environment, or Combined from signed change manifest.
4. Evaluate target improvement, M15–M17 non-degradation, M19 safety, cost/intervention bounds, and leakage.

## Acceptance criteria

- AC-E11-1: repeated/exposed form cannot yield transfer signal.
- AC-E11-2: two treatments or unclassified environment change blocks causal interpretation.
- AC-E11-3: unsafe or degraded verification blocks positive signal.
- AC-E11-4: each retest label matches its change manifest.

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
