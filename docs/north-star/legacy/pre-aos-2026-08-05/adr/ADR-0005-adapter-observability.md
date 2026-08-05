# ADR-0005: Make adapter observability explicit and fail closed

- Status: Accepted (2026-08-05, north-star §9.2)
- Owner: CEO

## Context

Codex and Claude Code expose different events. Guessing absent events would turn adapter limitations into user penalties.

## Decision

Each semantic event declares `REQUIRED`, `CONDITIONAL`, `DERIVED`, `BEST_EFFORT`, or `UNAVAILABLE`, with its source. Run start stores a capability snapshot and adapter digest. Missing required evidence blocks the affected metrics or the score; unavailable evidence becomes `NOT_OBSERVED`.

## Rejected

- Lowest-common-denominator trace: discards useful evidence and hides capability gaps.
- Silent inference from neighboring events: creates false observations.
- Runtime-specific scores: prevents semantic parity and shifts the construct to vendor behavior.

## Consequences

`aos doctor --capabilities` is a release-blocking contract. Cross-runtime parity fixtures compare normalized semantics, not native event shape.
