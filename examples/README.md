# Public verification demo

This demo does not run an assessment and is not the aos CLI.

One-command schema and fixture verification:

```bash
node scripts/schema-conformance.mjs
```

Scorer and published fixture-pack verification:

```bash
node --test packages/scorer/test/score.test.ts
```

The published formula vector pack is `fixtures/scoring/vectors.json`.

Hidden task answers and gold solutions are not published on the public surface. This directory documents how to re-run public verification. It does not contain task keys, gold patches, or hidden answers.

See [VALIDATION.md](../docs/VALIDATION.md), [LIMITATIONS.md](../docs/LIMITATIONS.md), and [INTENDED_USE.md](../docs/INTENDED_USE.md).
