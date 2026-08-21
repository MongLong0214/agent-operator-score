# ADR-0003: Use strict TypeScript, Node.js, npm workspaces, and local CLI distribution

- Status: **PROPOSED — MAINTAINER GATE REQUIRED**
- Date: 2026-08-05
- Authority: `docs/north-star/agent-operator-score-ssot-v1.0.md`

## Context

The product needs cross-platform schemas, deterministic scoring, subprocess control, and adapters for CLI coding agents.

## Decision

- Use strict TypeScript with Node.js 22.18 as the runtime floor and Node.js 22/24 CI lanes; engines remain `>=22.18 <25`. Node.js 20 is excluded because it cannot execute TypeScript: its test runner does not discover a `.ts` test file, so the schema package's cases were silently skipped there rather than failing. Unflagged type stripping starts at 22.18.0.
- Use npm workspaces for exactly the six internal workspaces at `packages/{schema,scorer,runner,reporter}` and `adapters/{codex,claude-code}`. `suites/`, `fixtures/`, and `conformance/` are repository surfaces, not npm workspaces. Every internal `@aos/*` workspace is `private: true`.
- Only root `agent-operator-score` is the future publish candidate with binary `aos`; it remains non-publishable until E14/G4.
- No dependency enters production without engine, license, and third-party notice review.

## Rejected alternatives

- Python-first: conflicts with the fixed npx distribution surface.
- Rust-first: adds premature contributor and adapter complexity.

## Consequences

- D0 establishes the workspace skeleton only; feature code waits for its ticket gate.
- Engine warnings and unresolved licenses fail closed.

## Implementation gate

No product code may rely on ADR-0003 until a Maintainer Gate records an explicit accepted verdict for the exact file digest. A material edit returns the ADR to PROPOSED.
