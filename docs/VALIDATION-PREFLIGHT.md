# Validation preflight — pack simulation inputs

Authority: `docs/north-star/agent-operator-score-ssot-v1.0.md` §5.3.
Contract: `specs/pack-simulation.v0.json`.
Assumptions: `fixtures/simulation/assumptions.v0.json`.

This document preregisters the pack-simulation inputs. It does not freeze Form A
and does not claim human calibration.

## Seed policy

Every simulation input carries a required integer seed. There is no implicit
default. The same seed and the same input are the identity later simulation
must reproduce.

## Thresholds

The pack is not eligible to freeze while any of these fail:

- median 40 minutes or less
- p90 45 minutes or less
- 14 eligible metrics pack-wide
- at most four primary opportunities per scenario

## Family budgets and transition overhead

The six family target times and primary-opportunity caps are the §5.3 table.
Transition, load, and report overhead is at most five minutes.

## Policy classes and distributions

The only registered policy classes are `reference_operator` and
`scripted_policy`. Duration uncertainty is a triangular distribution with
`low_minutes`, `mode_minutes`, and `high_minutes`.

## Opportunity independence

Every `opportunity_id` is independent. A repeated identifier is a double
count and is refused. Secondary metrics are not invented here to fill the
14 eligible floor.

## What this ticket does not do

E0C-002 owns the seeded simulator. E0C-003 owns the PASS/FAIL preflight
report. A failing later simulation must block Form A freeze without deleting
a metric.
