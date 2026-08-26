# Alpha preregistration protocol

## Purpose and boundary

This document freezes a non-clinical, n=20 feasibility alpha. It is limited to deciding whether the planned measurement, attribution, and prescription observations justify continued investigation. It does not authorize participant collection before the protocol and its data dictionary are frozen.

The alpha must not be described as calibration, certification, a population-performance result, or a percentile/rank result. It cannot establish a validated personal score, precise reliability, runtime fairness, or a generalized treatment effect.

## Population, sample, and forms

The population is consenting adult software practitioners. Exactly 20 participants are enrolled: seven novice, seven intermediate, and six expert practitioners. Forms A and B are counterbalanced at ten participants each. The allocation is fixed before enrollment; neither cohort nor form is rebalanced after observed outcomes.

Each participant is represented by a pseudonymous identifier only. A consent record is required before an assessment row is used. Direct identifiers, free-text notes that can identify a person, and raw consent material are outside the alpha row.

## Reference runs and hypotheses

There are 48–96 reference/scripted policy runs. Every run has a reference-run identifier and remains in the analysis record. The alpha records the following preregistered hypotheses; it does not add a primary subset or new hypothesis after data inspection.

- H1 — person signal exceeds task/session noise.
- H2 — the preregistered cohorts show known-group separation.
- H3 — automated and blind expert assessments agree at the preregistered analysis level.
- H4 — median assessment duration is feasible.
- H5 — profile effects are estimated rather than hidden.
- H6 — the transfer observation is reported.

## Exclusions, missingness, and deviations

Every enrolled participant keeps one row, including withdrawals and unavailable reviews. Missing observations are stored as `null` with exactly one recorded reason: withdrawal, technical failure, or review unavailable. No row is deleted for missingness.

Only `NO_CONSENT`, `INELIGIBLE`, and `PRE_ASSESSMENT_WITHDRAWAL` are exclusion codes. A row carrying an exclusion code retains that code and its deviation record; no post-hoc primary subset is allowed. Every protocol deviation receives a deviation identifier and is reported with the row accounting.

## Blind expert review

Two independent expert reviewers assess each eligible row while blinded to participant identifier, cohort, form, and automated score. Disagreement is adjudicated by a third blinded expert. The adjudication is recorded without exposing participant identity.

## Analysis and deterministic stops

`ANALYSIS-PLAN.md` contains an analysis for every hypothesis above, and no analysis may be introduced for an undeclared hypothesis. The analysis uses all enrolled rows and reports exclusions, missingness, and deviations rather than silently filtering them.

The deterministic feasibility verdict is evaluated in this order:

1. Emit `PIVOT_REQUIRED` if row accounting is incomplete, reference runs are outside 48–96 inclusive, median duration exceeds 45 minutes, or the required blind review is absent.
2. Otherwise emit `PASS_TO_CONTINUE` when person signal exceeds task/session noise.
3. Otherwise emit `INCONCLUSIVE`.

These are the only verdicts. A calendar date, a favorable subset, or an unregistered analysis never converts an inconclusive or failed condition into a pass.

## Immutable alpha row data dictionary

The following fields, and no others, comprise one alpha row. Their machine-readable schema is `specs/alpha-row.schema.json`.

<!-- alpha-row-fields:start -->
| Field | Immutable meaning |
| --- | --- |
| `participant_id` | Pseudonymous enrollment identifier; never a direct identifier. |
| `consent_recorded` | Whether required consent was recorded before the row was used. |
| `cohort` | Preregistered novice, intermediate, or expert cohort. |
| `form` | Counterbalanced Form A or Form B. |
| `enrollment_status` | Enrollment and assessment state retained for every enrolled participant. |
| `exclusion_reason` | Registered exclusion code or `null`. |
| `reference_run_id` | Linked reference/scripted policy run identifier or `null`. |
| `task_id` | Preregistered task identifier. |
| `session_id` | Pseudonymous assessment-session identifier. |
| `reviewer_a` | Pseudonymous first blinded reviewer identifier or `null`. |
| `reviewer_b` | Pseudonymous second blinded reviewer identifier or `null`. |
| `review_adjudication` | Third-blinded-expert adjudication state or `null`. |
| `duration_minutes` | Observed duration in minutes or `null`. |
| `automated_score` | Automated assessment value or `null`. |
| `expert_review` | Blinded expert assessment value or `null`. |
| `missing_reason` | Registered missingness reason or `null`. |
| `deviation_id` | Registered protocol-deviation identifier or `null`. |
| `transfer_outcome` | Preregistered transfer observation or `null`. |
<!-- alpha-row-fields:end -->

## Immutable protocol manifest

The manifest below is the compact, machine-checked form of the frozen rules stated above. Its values are not defaults and may change only through a renewed preregistration.

<!-- alpha-protocol-manifest:start -->
population=consenting_adult_software_practitioners
enrollment_n=20
cohort_novice=7
cohort_intermediate=7
cohort_expert=6
form_a=10
form_b=10
hypotheses=H1,H2,H3,H4,H5,H6
row_accounting=all_enrolled_rows
missing_value=null
missing_reasons=withdrawn,technical_failure,review_unavailable
delete_rows=false
exclusion_codes=NO_CONSENT,INELIGIBLE,PRE_ASSESSMENT_WITHDRAWAL
posthoc_primary_subset=false
reviewer_count=2
blinded_fields=participant_id,cohort,form,automated_score
adjudication=third_blinded_expert
allowed_verdicts=PASS_TO_CONTINUE,INCONCLUSIVE,PIVOT_REQUIRED
stop_participants=20
stop_reference_runs_min=48
stop_reference_runs_max=96
stop_median_duration_minutes_max=45
stop_blind_review_required=true
stop_signal_rule=person_signal_exceeds_task_session_noise
prohibited_claims=calibration,certification,population-performance,percentile
<!-- alpha-protocol-manifest:end -->
