# PRD F5 — Six-family Form A assessment

- Milestone: M2 · Runner, Adapters, Form A (2026-09-23) · ADR: 0005, 0008, 0010

## Goal

Build a sealed six-family Form A pack that creates valid opportunities across the construct, keeps hidden oracles inaccessible, and completes within the reference time budget.

## Non-goals

No public answer keys, single-scenario ability claim, Form B reuse, or scenario metric inflation.

## User stories

- As an operator, I complete realistic tasks instead of a survey or prompt quiz.
- As a measurement reviewer, I can trace every metric eligibility decision to a sealed opportunity contract.

## Requirements

1. Register one scenario per family with 2–4 primary metric opportunities.
2. Mix direct-execution, orchestration, retrieval/no-retrieval, failure, safety, and stale-evidence traps.
3. Achieve pack-level ≥14 eligible metrics without double-counting one behavior.
4. Demonstrate median ≤40 minutes and p90 ≤45 minutes on preregistered reference policies.

## Acceptance

- AC-F5-1: worker access to hidden oracle always fails.
- AC-F5-2: eligibility audit shows metric, opportunity, evidence, and non-duplication.
- AC-F5-3: reference timing and opportunity thresholds pass simultaneously or Form A remains unfrozen.

