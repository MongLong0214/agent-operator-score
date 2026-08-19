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

## Freeze gate

`renderPreflightReport` in `packages/reporter/src/preflight-report.ts` turns a
`{spec, assumptions, simulation}` record into one deterministic text report
carrying `verdict: PASS|FAIL` and `form_a_freeze: ELIGIBLE|BLOCKED`. Any reason
at all makes the verdict FAIL and the freeze BLOCKED. There is no path that
summarises a failing simulation without a blocking verdict.

### What is frozen against what

Three digests bind the decision to exact bytes:

- `input_digest` — sha256 over the canonical `{spec, assumptions}` pair. This is
  the identity of the contract plus the preregistered assumptions.
- `manifest_digest` — echoed from the simulation record, and recomputed here as
  `manifest_digest_recomputed` over the simulator's own preimage: seed, spec,
  assumptions, median, p90, eligible count, reasons, raw rows.
- `output_digest` — sha256 over the canonical decision this report renders.

A change to either frozen document after the run leaves the recorded
`manifest_digest` intact while the recomputed one moves, and the gate refuses
with `DIGEST_MISMATCH`. This is the case the gate exists for: a threshold, a
distribution, a seed, or a transition-overhead value edited after the fact is
otherwise invisible to a report that only reads the recorded summary. A tampered
result is caught from the same side — rewritten raw rows against an untouched
recorded digest also mismatch.

### Every threshold is evaluated here

All four thresholds are rendered on every path with their limit, observed value
and status, whether or not they held. The contract copy in
`specs/pack-simulation.v0.json` is the authority; an assumptions file that
disagrees is reported as `THRESHOLD_DISAGREEMENT` rather than obeyed.

`primary_opportunities_per_scenario_max` matters most here because the simulator
does not police it at all. A scenario carrying five primary opportunities makes
`simulatePackBudget` return `ok: true` with no reason, so a gate that merely
echoed the simulator's verdict would freeze it. This gate measures the cap from
the assumptions directly and blocks.

### The median is analytic

The gate reports the analytic median and states so in the report's
`median_source` line. All six families are symmetric triangulars, so the exact
median of their sum is the sum of the per-family centres — 5+6+8+7+7+7 — and
lands on exactly 40. The seeded empirical p50 of the same thousand rows is
40.0346, about +0.87 SE above the centre, which is sampling noise; taking it
would read the median 40 threshold as breached and refuse a pack the contract
admits. The exactness is conditional on symmetry, so a family whose triangular
stops being symmetric raises `ASYMMETRIC_DISTRIBUTION` and blocks rather than
letting the analytic claim go stale.

### Reasons

`SEED_POLICY`, `DIGEST_MISMATCH`, `NO_RAW_ROWS`, `METRIC_DELETION`,
`MALFORMED_SCENARIO`, `DISTRIBUTION_KIND`, `ASYMMETRIC_DISTRIBUTION`,
`THRESHOLD_MISSING`, `THRESHOLD_DISAGREEMENT`, `THRESHOLD <key>`,
`SIMULATION <code>`, `SIMULATION_MALFORMED`, `SIMULATION_SELF_CONTRADICTION`.
Every reason the simulator itself raised is carried through under
`SIMULATION <code>` rather than restated or dropped.

### Nothing is hidden and nothing is claimed about people

The report renders the seed, the policy class, every declared threshold, every
scenario with its distribution, every opportunity identifier, and every raw row
with its per-family breakdown. `declared_metrics` is rendered on the failing path
too, and a spec declaring fewer than the twenty registry metrics raises
`METRIC_DELETION`: a blocked freeze is not resolved by narrowing the pack. The
report carries the line `human_data: none; this report does not claim human
calibration.`

## What this ticket does not do

E0C-002 owns the seeded simulator. E0C-003 owns the PASS/FAIL preflight report
above. It decides freeze eligibility for Form A; composing and freezing Form A
itself belongs to E8-004. A failing later simulation must block Form A freeze
without deleting a metric.
