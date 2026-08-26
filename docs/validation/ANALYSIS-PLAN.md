# Alpha analysis plan

## Analysis population and provenance

The analysis includes all enrolled rows defined by `ALPHA-PREREGISTRATION.md`. Exclusion codes, `null` observations with their registered missingness reason, and all deviation identifiers are retained in the accounting output. No complete-case-only analysis, post-hoc primary subset, or unregistered hypothesis can become the primary analysis.

Reference/scripted policy runs remain linked by `reference_run_id`. Participant, task, and session identifiers are pseudonymous. Outputs report aggregates and registered deviations; they do not publish direct identifiers or raw consent material.

## Preregistered analyses

<!-- alpha-analysis-hypotheses:start -->
H1=Estimate person, task, and session variation and determine whether person signal exceeds task/session noise.
H2=Estimate the preregistered novice, intermediate, and expert cohort contrasts as the known-group separation observation.
H3=Estimate agreement between the automated assessment and the two-reviewer blinded expert assessment, retaining third-reviewer adjudication.
H4=Calculate the median of non-null duration_minutes and compare it with the preregistered 45-minute feasibility boundary while reporting missing durations.
H5=Estimate preregistered profile effects with participant, task, and session terms; do not hide profile effects by subgroup selection.
H6=Report the preregistered transfer_outcome for every row where it is observed, including missingness and deviations.
<!-- alpha-analysis-hypotheses:end -->

## Feasibility verdict procedure

The analysis first checks complete enrolled-row accounting, 48–96 inclusive reference runs, a median duration no greater than 45 minutes, and completed blind review. Any failed prerequisite emits `PIVOT_REQUIRED`. If those prerequisites pass, H1 emits `PASS_TO_CONTINUE` only when person signal exceeds task/session noise; otherwise the result is `INCONCLUSIVE`.

The analysis emits only the three preregistered feasibility verdicts. It does not issue calibration, certification, population-performance, or percentile claims, and it cannot upgrade a result using a favorable subset, an unregistered metric, or a calendar target.
