# G4 publication gate verdict — E14-003

The G4 gate accepts a signed environment and toolchain manifest and output
digests from an independent run, compares those digests to the public schema,
fixture, and scorer bytes, runs the G0–G4 blockers, and emits PASS or FAIL.

This document records the live derivation. A protocol PASS produced by injecting
resolved blockers in the test lane is not a live publication clearance.
MIT is the outbound copyright grant. It is not contributor terms, and it is not a publication clearance.
Contributor terms and formal publication review remain unresolved.
No public package has been approved.

The root package.json does not own a `verify:release` script. The executable
surface is:

```bash
node scripts/verify-release.mjs
node --test conformance/external/external-reproduction.test.ts
```

## How a verdict is derived

The live run fails closed when any of these is true: the reproduction is missing,
self-attested, unsigned, wrongly digested, or recorded against a stale head; G0
fixture truth fails; G1, G2, or G3 is unresolved; or any E14 publication
requirement is not RESOLVED. The only passing verdict token is `G4_PASS`. The
live tree does not emit it.

## Live reproduction

```json
{
  "independent_reproduction": false,
  "reason": "No signed independent environment/toolchain manifest is recorded against this head. A self-attested result is refused."
}
```

## Gate blockers

```json
{
  "G0": "RESOLVED",
  "G1": "UNRESOLVED",
  "G2": "UNRESOLVED",
  "G3": "UNRESOLVED",
  "contributor_terms": "UNRESOLVED",
  "formal_publication_review": "UNRESOLVED"
}
```

G0 fixture truth is a scorer-byte result. It does not authorize public
evaluation or a package release. G1–G3 remain open because the n=20 feasibility
alpha has not been executed here.

## Derived verdict

```json
{
  "verdict": "FAIL",
  "blocked_by": [
    "independent_reproduction",
    "contributor_terms",
    "formal_publication_review",
    "G1",
    "G2",
    "G3"
  ],
  "permits_publication": false,
  "permits_npm_publication": false
}
```
