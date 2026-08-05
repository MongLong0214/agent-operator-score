# ADR-0003: Use strict TypeScript, Node.js, npm workspaces, and local CLI distribution

- Status: **PROPOSED — CEO GATE REQUIRED**
- Date: 2026-08-05
- Authority: `docs/north-star/agent-operator-score-ssot-v1.0.md`

## Context

The product needs cross-platform schemas, deterministic scoring, subprocess control, and adapters for CLI coding agents.

## Decision

- Use strict TypeScript with Node.js 20 as the runtime floor and Node.js 20/24 CI lanes.
- Use npm workspaces for schema, scorer, runner, reporter, adapters, suites, fixtures, and conformance.
- Publish candidate package `agent-operator-score` with binary `aos`; publishing remains blocked until G4.
- No dependency enters production without engine, license, and third-party notice review.

## Rejected alternatives

- Python-first: conflicts with the fixed npx distribution surface.
- Rust-first: adds premature contributor and adapter complexity.

## Consequences

- D0 establishes the workspace skeleton only; feature code waits for its ticket gate.
- Engine warnings and unresolved licenses fail closed.

## Implementation gate

No product code may rely on ADR-0003 until the CEO records an explicit accepted verdict for the exact file digest. A material edit returns the ADR to PROPOSED.
