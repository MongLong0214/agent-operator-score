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

The verdict is `CLEARED` when every **source** requirement is `RESOLVED`, and `BLOCKED` otherwise.
A claim requirement is scored here but never blocks that verdict: `formal_publication_review` gates
what may be claimed about the metric, not whether MIT-licensed source may ship, so an open claim row
leaves the source verdict `CLEARED` and is carried in the claim blockers instead.
`permits_publication`, `permits_redistribution` and `permits_external_contribution_acceptance`
follow the verdict. `permits_npm_publication` is false on every verdict, because npm publication is
a separate decision this ledger never grants. A `BLOCKED` verdict is not a G4
publication release, an npm publication, or an acceptance of external contributions. MIT is the
outbound copyright grant and remains in force independently of that verdict. The verdict is not
written by hand: it is derived from the ledger, and `tests/publication/clearance.test.mjs`
re-derives it and fails if the recorded verdict differs from the one the ledger implies.

The D0 minimum name clearance is a separate canonical-identity decision. It is an input here,
cited by reference, and is neither repeated nor substituted.

## Requirement ledger

```json
{
  "version": 1,
  "decided_at": "2026-08-19T07:15:00Z",
  "name_clearance_reference": "docs/clearance/MINIMUM-NAME-CLEARANCE.md",
  "requirements": [
    {
      "id": "license",
      "title": "Outbound license",
      "status": "RESOLVED",
      "artifact": "LICENSE",
      "evidence": "Outbound license selection",
      "reason": "The repository owner and sole maintainer, MongLong0214, selected MIT as the outbound license. LICENSE carries the standard MIT text with the copyright line already used in this repository."
    },
    {
      "id": "contributor_terms",
      "title": "Contribution acceptance terms",
      "status": "RESOLVED",
      "artifact": "CONTRIBUTING.md",
      "evidence": "Contribution acceptance terms",
      "reason": "Inbound contributions are accepted under the Developer Certificate of Origin 1.1, certified per commit with a Signed-off-by line, and are licensed inbound on the same MIT terms this repository ships outbound. Chosen by the repository owner and sole maintainer, MongLong0214. A DCO needs no signature collection, no separate agreement and no copyright assignment; it is a per-commit certification of origin by the contributor. CONTRIBUTING.md carries the terms and the sign-off requirement."
    },
    {
      "id": "redistribution",
      "title": "Redistribution conditions",
      "status": "RESOLVED",
      "artifact": "docs/decisions/PUBLICATION-CLEARANCE.md",
      "evidence": "Redistribution conditions review",
      "reason": "MIT is the outbound grant. It permits use, copy, modification, publication, distribution, sublicensing, and sale, on the condition that the copyright notice and permission notice are included in all copies or substantial portions. That grant and that condition are in LICENSE, selected by the owner. This requirement does not authorize npm publication, a visibility change, or external contribution acceptance."
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
      "reason": "No qualified reviewer has examined this repository, and this lane cannot supply one. Required before any published claim about what the metric measures; not required to ship MIT-licensed source, which the owner decision covers instead."
    },
    {
      "id": "owner_publication_decision",
      "title": "Owner decision to publish source",
      "status": "RESOLVED",
      "artifact": "docs/decisions/PUBLICATION-CLEARANCE.md",
      "evidence": "Owner publication decision",
      "reason": "The repository owner and sole maintainer decided to publish this tree as source-visible MIT. The decision covers the source only. It is a maintainer decision, not a legal review, and it is recorded as such: no qualified reviewer has examined this repository, and the claim set records that separately."
    }
  ]
}
```

## Redistribution conditions

```json
{
  "granted": true,
  "conditions": [
    "The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software."
  ],
  "permits": {
    "redistribution": true,
    "external_contribution_acceptance": true,
    "npm_publication": false,
    "public_visibility_change": false
  }
}
```

## Derived verdict

```json
{
  "verdict": "CLEARED",
  "blocked_by": [],
  "permits_npm_publication": false,
  "permits_publication": true,
  "permits_redistribution": true,
  "permits_external_contribution_acceptance": true
}
```

## What this decision does not do

It does not change repository visibility, publish a package, or authorize either. It states no
opinion on trademark, license compatibility, or the legal identity of the copyright holder. It
does not repeat or replace the D0 minimum name clearance. Six of its seven requirements are
`RESOLVED`: outbound license, contribution acceptance terms, redistribution, third-party notices,
security disclosure policy, and the owner decision to publish source. The seventh,
`formal_publication_review`, is `UNRESOLVED` — no qualified reviewer has examined this repository.
It is a claim requirement, so it does not hold the source verdict at `BLOCKED`; it holds every
published claim about what the metric measures, and `docs/decisions/G4-VERDICT.md` carries it in
`claim_blockers`.
