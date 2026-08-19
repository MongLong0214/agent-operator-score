# Publication legal clearance

Point-in-time observations behind the E14/G4 publication decision. Each record states what was
looked at, what came back, what the look could not reach, and a status of `RESOLVED`,
`UNRESOLVED`, or `CONFLICT`. The decision that consumes these records, and the verdict it
derives, are in [PUBLICATION-CLEARANCE.md](../decisions/PUBLICATION-CLEARANCE.md).

An observation is `RESOLVED` only when it rests on a fact this repository carries and that can be
re-derived from it. Anything resting on a judgement no artifact here records — a license
selection, an inbound contribution term, a legal opinion — is `UNRESOLVED`, whatever its likely
answer. This file records absence as absence.

This record does not repeat the D0 minimum name clearance and does not substitute for it. That clearance is a separate canonical-identity decision, cited below by reference.

## Declared package dependencies

```json
{
  "source": "package-lock.json and every workspace manifest in this repository",
  "query": "classify each entry of package-lock.json .packages as the root manifest, a local workspace, or a link to a local workspace, and collect anything left over",
  "reviewed_at": "2026-08-19T06:20:42Z",
  "result": "RESOLVED: thirteen entries, all accounted for. One root manifest, six local workspaces each carrying its own package.json, and six link entries whose resolved paths are those workspaces. Nothing is left over, so the external package set is empty and no inbound package license applies.",
  "limits": "Declared package dependencies only. Material vendored into the tree without a manifest, or pasted into a source file, would not appear in the lockfile and was not separately searched for. The three GitHub Actions used by CI run in the CI environment and are not redistributed here. This is a statement of what is declared, not a license-compatibility opinion.",
  "status": "RESOLVED"
}
```

## Declared license metadata

```json
{
  "source": "package.json and the six workspace manifests under packages/ and adapters/",
  "query": "any declared outbound license: a license or licenses field in any manifest, or an SPDX identifier anywhere in the tree",
  "reviewed_at": "2026-08-19T06:20:42Z",
  "result": "RESOLVED: no manifest declares a license or licenses field, and the tree contains no SPDX identifier. The absence is consistent across all seven manifests; there is no partial or conflicting declaration to reconcile.",
  "limits": "Establishes only that nothing is declared. It does not establish what should be declared, and it is not a selection.",
  "status": "RESOLVED"
}
```

## Outbound license selection

```json
{
  "source": "docs/decisions/ and docs/clearance/ in this repository",
  "query": "an accepted maintainer decision selecting an outbound open-source license for this repository",
  "reviewed_at": "2026-08-19T06:20:42Z",
  "result": "UNRESOLVED: no such decision exists. E14-001 forbids choosing a license without review, so this lane records the absence and writes the reserved-rights default into LICENSE rather than making the selection itself.",
  "limits": "A selection needs a maintainer decision and, for anything beyond the default, a review this repository cannot perform on its own behalf. Nothing here should be read as a recommendation of any particular license.",
  "status": "UNRESOLVED"
}
```

## Contribution acceptance terms

```json
{
  "source": "CONTRIBUTING.md, .github/, and docs/decisions/ in this repository",
  "query": "inbound contribution terms: a contributor license agreement, a developer certificate of origin, or any stated inbound license",
  "reviewed_at": "2026-08-19T06:20:42Z",
  "result": "UNRESOLVED: none of the three exists in the tree. CONTRIBUTING.md refuses external contribution acceptance until this gate clears, which is a refusal rather than a term.",
  "limits": "Covers terms written into this repository. Terms agreed elsewhere, if any exist, are not observable from the tree.",
  "status": "UNRESOLVED"
}
```

## Redistribution conditions review

```json
{
  "source": "docs/decisions/PUBLICATION-CLEARANCE.md and LICENSE",
  "query": "whether any grant permits redistribution of this work, and on what conditions",
  "reviewed_at": "2026-08-19T06:20:42Z",
  "result": "UNRESOLVED: no grant exists. LICENSE reserves all rights, and the conditions recorded in the decision are conditions still to be met, not conditions already satisfied. Redistribution is refused.",
  "limits": "Records the state of the conditions. Whether the conditions are the right ones is a maintainer judgement, and meeting them is not this lane's work.",
  "status": "UNRESOLVED"
}
```

## Security disclosure policy

```json
{
  "source": "SECURITY.md in this repository",
  "query": "whether a disclosure policy is in force, and whether it states a reporting channel, a disclosure expectation, a covered surface, and the bound of its own claim",
  "reviewed_at": "2026-08-19T06:20:42Z",
  "result": "RESOLVED: SECURITY.md is present and states all four. It names a private reporting channel and a fallback, refuses a public issue as the reporting path, gives the in-scope and out-of-scope surfaces, and states that it is not an assurance, an audit result, or a certification.",
  "limits": "Records that a policy exists and what it says. Whether GitHub private vulnerability reporting is enabled on the repository is a platform setting that is not observable from the tree and was not verified. No audit, scan, or penetration test was performed, and none is implied by this status.",
  "status": "RESOLVED"
}
```

## Formal publication and legal review

```json
{
  "source": "the whole repository at the reviewed commit",
  "query": "a completed formal publication and legal review, as PRD E14 requires, recorded anywhere in the tree",
  "reviewed_at": "2026-08-19T06:20:42Z",
  "result": "UNRESOLVED: this review was not performed. The repository holds no record of a review by a qualified reviewer, and this lane did not carry one out and could not. The item stays open.",
  "limits": "Absence of a record is what was observed. It is not evidence that publication would be unsafe, and it is not evidence that it would be safe.",
  "status": "UNRESOLVED"
}
```

## Canonical name clearance by reference

```json
{
  "source": "docs/clearance/MINIMUM-NAME-CLEARANCE.md",
  "query": "the recorded status of the D0 minimum name clearance, read as an input to this decision",
  "reviewed_at": "2026-08-19T06:20:42Z",
  "result": "UNRESOLVED: the D0 record carries four checks, three recorded CLEAR and the basic trademark check recorded UNRESOLVED. An UNRESOLVED status there blocks public canonical-brand adoption and public publication, so it blocks here too.",
  "limits": "Cited, not re-performed and not substituted; repeating it is outside E14-001. The D0 record is point-in-time and states that it establishes no legal or trademark clearance.",
  "status": "UNRESOLVED"
}
```
