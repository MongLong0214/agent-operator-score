# ADR-0001: Freeze Agent Operator Score identity and isolate legacy names

- Status: **PROPOSED — MAINTAINER GATE REQUIRED**
- Date: 2026-08-05
- Authority: `docs/north-star/agent-operator-score-ssot-v1.0.md`

## Context

The final baseline replaces all earlier product identities. Mixed identifiers would corrupt package provenance, links, CLI help, score labels, and contributor instructions.

## Decision

- Canonical product name is **Agent Operator Score (AOS)**.
- Repository and package identifier is `agent-operator-score`; executable is `aos`; local state root is `.aos/`.
- The scored instrument is `AOS-Coding`; the provisional score is `AOS-Coding P0`.
- Earlier product identifiers are forbidden anywhere in the active tree.
- D0 records minimum GitHub/npm/domain/basic-trademark name-clearance evidence and its limits; an unresolved result blocks canonical-name adoption. LICENSE, contribution acceptance, redistribution, and publication are separate E14/G4 decisions.

## Rejected alternatives

- Keeping the old repository slug and changing display copy only: provenance remains ambiguous.
- Reusing an obsolete provisional label: it hides the domain boundary required by the final baseline.

## Consequences

- D0 owns migration and a legacy-string lint.
- Any legacy identifier hit in the active tree blocks build and publication.

## Implementation gate

No product code may rely on ADR-0001 until the Maintainer records an explicit accepted verdict for the exact file digest. A material edit returns the ADR to PROPOSED.
