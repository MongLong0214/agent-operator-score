# Validation

This document is not a human-calibration result. G4 publication is not cleared.

G0–G3 human-signal, facet, and transfer gates are not closed by this surface. The n=20 feasibility alpha has not been executed here. Nothing in this file authorizes a performance, reliability, fairness, or treatment-transfer claim.

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

The same commands are documented in [examples/README.md](../examples/README.md).

## What this does not verify

- end-to-end assessment
- the planned `aos` CLI
- independent external reproduction (E14-003)
- contributor-term acceptance
- npm publication
