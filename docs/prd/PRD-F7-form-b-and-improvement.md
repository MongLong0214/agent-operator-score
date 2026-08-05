# PRD F7 — Form B, sprint protocol, and transfer signal

- Milestone: M3 · Alpha and Form B (2026-10-21) · ADR: 0008, 0010

## Goal

Apply exactly one treatment for seven days and measure whether improvement transfers to a different but linked Form B without degrading outcome integrity or safety.

## Non-goals

No multi-treatment bundle, same-form retest, exact growth score before linking, or causal claim from an uncontrolled run.

## User stories

- As an operator, I can test whether the recommended change works beyond the original task.
- As a researcher, I can separate diagnosis, selection, execution, and linking failures.

## Requirements

1. Track form exposure and prohibit growth claims on repeated forms.
2. Record treatment version, adherence, cost, permissions, and deviations.
3. Require target improvement, M15–M17 non-degradation, M19 safety, and cost bounds.
4. Emit a transfer signal until linking supports AOS-G P0.

## Acceptance

- AC-F7-1: repeated Form A yields no growth result.
- AC-F7-2: two simultaneous treatments invalidate causal interpretation.
- AC-F7-3: unsafe or degraded verification withholds a positive transfer signal.

