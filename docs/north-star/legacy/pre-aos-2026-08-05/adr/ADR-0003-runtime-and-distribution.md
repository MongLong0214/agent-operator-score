# ADR-0003: Use TypeScript on Node.js with npm distribution

- Status: Accepted (2026-08-05, architecture decision)
- Owner: CEO

## Context

AOS needs a cross-platform CLI, JSON Schema tooling, deterministic scoring, process isolation, and adapters for command-line coding agents.

## Decision

- Language: strict TypeScript; runtime floor Node.js 20; CI exercises Node.js 20 and 24.
- Repository: npm workspaces with independently testable schema, scorer, runner, reporter, and adapter modules.
- Distribution: public package `agentops-score`, executable `aos`, but publishing remains outside factory scope.
- No production dependency is added without license and Node-floor checks.

## Rejected

- Python: strong measurement ecosystem, but weaker fit for the planned npm/npx install contract and single-package CLI.
- Rust-first: attractive isolation and binary distribution, but increases adapter and contributor friction before measurement validity exists.
- Node.js 24 floor: unnecessarily excludes supported environments; the floor must be exercised, not merely declared.

## Consequences

CI must fail on incompatible dependency engines and must never treat npm engine warnings as success.
