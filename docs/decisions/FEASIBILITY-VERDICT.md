# Feasibility verdict mechanism

No alpha study has been run and no conserved participant rows are present in this
repository. This is therefore not a study verdict or a claim that a feasibility condition
has passed, failed, or been measured. It records the deterministic mechanism that a future
protocol-conforming analysis uses and the current gate state.

## Registered decision procedure

`analyzeAlpha` reads the manifest in `docs/validation/ALPHA-PREREGISTRATION.md` with the
conserved rows and linked reference runs. It first checks complete enrolled-row accounting,
the manifest's inclusive reference-run range, a median duration no greater than the
manifest boundary, and required blinded review. Any failed prerequisite selects the
registered pivot result. If those prerequisites pass, person signal must exceed combined
task and session variance to select the registered continue result; otherwise it selects
the registered inconclusive result. Each result has a deterministic action: pivot to
diagnostics/regression work, continue preregistered investigation, or hold without a
performance claim, respectively.

Known-group means, automated/blind-expert agreement, profile effects, transfer
observations, missingness, and deviations remain visible analysis outputs. They do not
silently alter the preregistered G1 decision rule. In particular, this n=20 mechanism
cannot close G2 facet validation or G3 treatment-transfer validation.

The function refuses a candidate decision not listed by the frozen manifest. It cannot
substitute an unregistered outcome, fill absent records, or use a calendar target or
favorable subset to produce a continue result.

## Gate verdicts

```json
{
  "G1": "UNRESOLVED",
  "G2": "UNRESOLVED",
  "G3": "UNRESOLVED"
}
```

G1 is unresolved because no protocol-conforming alpha rows have been analyzed. G2 and G3
are unresolved because the SSOT reserves them for deferred facet and transfer studies.
These gate-state words are not feasibility-analysis outputs and do not report a study
finding.
