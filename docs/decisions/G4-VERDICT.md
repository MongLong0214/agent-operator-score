# G4 publication gate verdict — E14-003

The G4 gate accepts a signed environment and toolchain manifest and output
digests from an independent run, compares those digests to the G0 pin for the
public schema, fixture, and scorer bytes, runs the live G0–G4 blockers, and
emits PASS or FAIL.

This document is the tree-resident record the live executable reads. The
`Live reproduction` block is the well-known independent-run slot. The
`Trusted principals` block is the out-of-band allowlist; a public key that
lives only inside a signed body is not a principal. Caller-supplied
publication arrays, G1–G3 maps, and G0 stubs cannot mint a pass.
MIT is the outbound copyright grant. It is not contributor terms, and it is not a publication clearance.
Contributor terms and formal publication review remain unresolved.
No public package has been approved.

The root package.json does not own a `verify:release` script. The executable
surface is:

```bash
node scripts/verify-release.mjs
node scripts/verify-release.mjs <reproduction-manifest.json>
node --test conformance/external/external-reproduction.test.ts
```

## How a verdict is derived

The live run fails closed when any of these is true: the tree-resident or
CLI-path reproduction is missing, self-attested, unsigned, signed by a key
that is not in Trusted principals, recorded against a digest other than the
G0 pin, or recorded against a stale head; G0 fixture truth fails; G1, G2, or
G3 is not the E12 token `PASS_TO_CONTINUE` in
`docs/decisions/FEASIBILITY-VERDICT.md`; or any required E14 publication id in
`docs/decisions/PUBLICATION-CLEARANCE.md` is not RESOLVED. Extra or duplicate
digest paths fail. An unreadable gated file is `UNREADABLE` or G0
`STALE_DIGEST`, not an exception. The only passing verdict token is
`G4_PASS`. The live tree does not emit it. E12 is contracted to emit exactly
`PASS_TO_CONTINUE`, `INCONCLUSIVE`, or `PIVOT_REQUIRED`; `INCONCLUSIVE`,
`PIVOT_REQUIRED`, and the G4-local token `RESOLVED` do not close G1–G3.

## Live reproduction

```json
{
  "independent_reproduction": false,
  "reason": "No signed independent environment/toolchain manifest is recorded against this head. A self-attested result is refused."
}
```

## Trusted principals

```json
{
  "principals": []
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
evaluation or a package release. G1–G3 remain open because
`docs/decisions/FEASIBILITY-VERDICT.md` is absent; the n=20 feasibility alpha
has not been executed here. When that record exists, G4 compares each of
G1, G2, and G3 to `PASS_TO_CONTINUE` and maps a match onto this document's
`RESOLVED` blocker slot. Publication requirements are read from the E14
ledger, not from a caller-supplied array.

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
