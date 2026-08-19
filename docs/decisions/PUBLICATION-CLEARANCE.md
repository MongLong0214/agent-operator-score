# Publication clearance decision — E14/G4

The E14/G4 decision on license, contribution acceptance, redistribution, third-party notices,
security disclosure, and formal publication review. The observations this decision rests on are
in [PUBLICATION-LEGAL-CLEARANCE.md](../clearance/PUBLICATION-LEGAL-CLEARANCE.md); each
requirement below cites one of them by heading, and the two must agree.

## How a verdict is derived

Each requirement carries `RESOLVED`, `UNRESOLVED`, or `CONFLICT`.

A requirement is `RESOLVED` only when it rests on something this repository carries and that can
be re-derived from it. A requirement whose answer depends on a maintainer judgement or a legal
opinion that no artifact here records is `UNRESOLVED`, however obvious its likely answer.
`CONFLICT` is for a requirement whose evidence contradicts itself and needs correction rather
than completion.

The verdict is `CLEARED` when every requirement is `RESOLVED`, and `BLOCKED` otherwise. A
`BLOCKED` verdict refuses publication, redistribution, and external contribution acceptance
together; there is no partial release. The verdict is not written by hand: it is derived from the
ledger, and `tests/publication/clearance.test.mjs` re-derives it and fails if the recorded
verdict differs from the one the ledger implies.

The D0 minimum name clearance is a separate canonical-identity decision. It is an input here,
cited by reference, and is neither repeated nor substituted.

## Requirement ledger

```json
{
  "version": 1,
  "decided_at": "2026-08-19T06:20:42Z",
  "name_clearance_reference": "docs/clearance/MINIMUM-NAME-CLEARANCE.md",
  "requirements": [
    {
      "id": "license",
      "title": "Outbound license",
      "status": "UNRESOLVED",
      "artifact": "LICENSE",
      "evidence": "Outbound license selection",
      "reason": "No outbound open-source license has been selected. LICENSE states the reserved-rights default and points here. Selecting one is a reviewed maintainer decision that E14-001 forbids this lane from making."
    },
    {
      "id": "contributor_terms",
      "title": "Contribution acceptance terms",
      "status": "UNRESOLVED",
      "artifact": "CONTRIBUTING.md",
      "evidence": "Contribution acceptance terms",
      "reason": "The tree defines no inbound license, contributor license agreement, or developer certificate of origin. CONTRIBUTING.md refuses external contribution acceptance until this gate clears, which is a refusal and not a term."
    },
    {
      "id": "redistribution",
      "title": "Redistribution conditions",
      "status": "UNRESOLVED",
      "artifact": "docs/decisions/PUBLICATION-CLEARANCE.md",
      "evidence": "Redistribution conditions review",
      "reason": "The conditions are stated below as conditions still to be met. None of them is met, and no grant permits redistribution."
    },
    {
      "id": "third_party_notices",
      "title": "Third-party notices",
      "status": "RESOLVED",
      "artifact": "THIRD_PARTY_NOTICES.md",
      "evidence": "Declared package dependencies",
      "reason": "The set of redistributed third-party packages is empty, derived from package-lock.json, and re-derived by the test lane. The external runtime requirement is named with its declared range and marked as not redistributed."
    },
    {
      "id": "security_policy",
      "title": "Security disclosure policy",
      "status": "RESOLVED",
      "artifact": "SECURITY.md",
      "evidence": "Security disclosure policy",
      "reason": "A disclosure policy is in force and states a private reporting channel with a fallback, a coordinated-disclosure expectation, its covered surface, and the bound of its own claim. Whether the platform reporting form is enabled is recorded as an unverified limit, not as an assurance."
    },
    {
      "id": "formal_publication_review",
      "title": "Formal publication and legal review",
      "status": "UNRESOLVED",
      "artifact": "docs/clearance/PUBLICATION-LEGAL-CLEARANCE.md",
      "evidence": "Formal publication and legal review",
      "reason": "The review PRD E14 requires has not taken place. No record of a qualified reviewer exists in the tree, and this lane cannot supply one."
    }
  ]
}
```

## Redistribution conditions

```json
{
  "granted": false,
  "conditions": [
    "An outbound license is selected in a reviewed maintainer decision and its full text is placed in LICENSE.",
    "Inbound contribution terms are fixed and stated in CONTRIBUTING.md.",
    "THIRD_PARTY_NOTICES.md enumerates every redistributed third-party component at the exact head being published.",
    "SECURITY.md names a reporting channel that has been confirmed to accept a report.",
    "A formal publication and legal review is completed and recorded in docs/clearance/PUBLICATION-LEGAL-CLEARANCE.md.",
    "The D0 minimum name clearance reports no status that blocks public canonical-brand adoption.",
    "The G4 fail-closed checklist named by PRD E14 is run at the exact head being published."
  ],
  "permits": {
    "redistribution": false,
    "external_contribution_acceptance": false,
    "npm_publication": false,
    "public_visibility_change": false
  }
}
```

## Derived verdict

```json
{
  "verdict": "BLOCKED",
  "blocked_by": [
    "contributor_terms",
    "formal_publication_review",
    "license",
    "redistribution"
  ],
  "permits_publication": false,
  "permits_redistribution": false,
  "permits_external_contribution_acceptance": false
}
```

## What this decision does not do

It does not change repository visibility, publish a package, or authorize either. It states no
opinion on trademark, license compatibility, or the legal identity of the copyright holder. It
does not repeat or replace the D0 minimum name clearance. Two of its six requirements are
`RESOLVED` on facts this repository carries; the other four are open, and each one of them is
enough on its own to hold the verdict at `BLOCKED`.
