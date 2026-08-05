# ADR-0001: Freeze Agent Operator Score identity and isolate legacy names

- Status: **PROPOSED — CEO GATE REQUIRED**
- Date: 2026-08-05
- Authority: `docs/north-star/agent-operator-score-ssot-v1.0.md`

## Context

The final baseline replaces AgentOps Score and all earlier ALI identities. Mixed identifiers would corrupt package provenance, links, CLI help, score labels, and contributor instructions.

## Decision

- Canonical product name is **Agent Operator Score (AOS)**.
- Repository and package identifier is `agent-operator-score`; executable is `aos`; local state root is `.aos/`.
- The scored instrument is `AOS-Coding`; the provisional score is `AOS-Coding P0`.
- `AgentOps Score`, `agentops-score`, `Agent Leverage Index`, `ALI`, and `ali-bench` are forbidden outside `docs/north-star/legacy/**` and explicit migration fixtures.
- Name clearance is a G4 publication gate, not an assumption.

## Rejected alternatives

- Keeping the old repository slug and changing display copy only: provenance remains ambiguous.
- Reusing `AOS-P0`: it hides the domain boundary required by the final baseline.

## Consequences

- D0 owns migration and a legacy-string lint.
- Any legacy hit outside the allowlist blocks build and publication.

## Implementation gate

No product code may rely on ADR-0001 until the CEO records an explicit accepted verdict for the exact file digest. A material edit returns the ADR to PROPOSED.
