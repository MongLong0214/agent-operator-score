# ADR-0007: Declare adapter observability and separate controlled from imported sessions

- Status: **PROPOSED — CEO GATE REQUIRED**
- Date: 2026-08-05
- Authority: `docs/north-star/agent-operator-score-ssot-v1.0.md`

## Context

Codex and Claude Code do not guarantee one complete, stable native trace export.

## Decision

- Each adapter declares REQUIRED, CONDITIONAL, DERIVED, BEST_EFFORT, or UNAVAILABLE per event group with source and missing-evidence effect.
- `aos doctor --capabilities --runtime <runtime>` emits the exact capability snapshot and adapter digest.
- Only sessions wrapped from start to finish by AOS can issue `AOS-Coding P0`.
- Imported sessions are diagnostic only; native gaps are never silently guessed.

## Rejected alternatives

- Treating absent events as successful behavior.
- Scoring imported history as equivalent to a controlled run.

## Consequences

- Codex is implemented and conformed before scenario expansion; Claude Code follows the full Form A core.
- Parity means semantic normalized equivalence, not identical native logs.

## Implementation gate

No product code may rely on ADR-0007 until the CEO records an explicit accepted verdict for the exact file digest. A material edit returns the ADR to PROPOSED.
