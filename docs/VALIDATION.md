# Validation

This document is not a human-calibration result. G4 publication is not cleared.

The n=20 feasibility alpha has not been executed here. The executable analysis is a
deterministic function over conserved alpha rows; it is not a report of a study result.
G1 remains unresolved until such rows are analyzed under the frozen protocol. G2 and G3
remain unresolved: they require their deferred facet- and transfer-validation studies and
cannot be closed by this alpha. Nothing in this file authorizes a performance, reliability,
fairness, attribution, or treatment-transfer claim.

## What can be verified now

Public schema and schema-fixture verification is one command:

```bash
node scripts/schema-conformance.mjs
```

That command checks the frozen schema documents, their digest manifest, and the in-script positive and negative fixture corpus. It does not score an operator and does not publish a package.

Scorer and published fixture-pack verification:

```bash
node --test packages/scorer/test/score.test.ts
```

The published formula vector pack is `fixtures/scoring/vectors.json`.

The alpha-analysis mechanism is checked separately:

```bash
npm test -w @aos/scorer -- validation
```

`analyzeAlpha` reads the frozen manifest embedded in
`docs/validation/ALPHA-PREREGISTRATION.md`. It accounts for the enrolled rows,
reference-run range, median duration, and required blinded review before it considers
person signal against task/session noise. It also reports known-group means,
automatic/blind-expert agreement, profile effects, transfer observations, missingness,
and deviations. These are observations for a future feasibility analysis, not evidence
that any participant, cohort, or intervention produced a result.

The feasibility result can only be one of the protocol manifest's allowed values. The
mechanism requires a pivot for incomplete accounting, an out-of-range reference-run
count, excessive median duration, or missing required blind review; otherwise it
continues only when person signal exceeds task/session noise, and withholds a continue
decision when that comparison does not hold. An allowed output is not emitted for a
protocol that does not register it.

The same commands are documented in [examples/README.md](../examples/README.md).

## What this does not verify

- end-to-end assessment
- the planned `aos` CLI
- independent external reproduction (E14-003)
- contributor-term acceptance
- npm publication
