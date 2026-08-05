# ADR-0007: Declare adapter observability and separate controlled from imported sessions

- Status: **PROPOSED — MAINTAINER GATE REQUIRED**
- Date: 2026-08-05
- Authority: `docs/north-star/agent-operator-score-ssot-v1.0.md`

## Context

Codex and Claude Code do not guarantee one complete, stable native trace export.

## Decision

- Each adapter declares REQUIRED, CONDITIONAL, DERIVED, BEST_EFFORT, or UNAVAILABLE per event group with source and missing-evidence effect.
- `aos doctor --capabilities --runtime <runtime>` emits the exact capability snapshot and adapter digest.
- Codex v0 primary source is app-server stdio JSON-RPC plus the exact installed generated schema/digest. Experimental websocket, private database, and undocumented logs are forbidden sources.
- Claude Code v0 primary source is official TypeScript SDK `query()`/`SDKMessage`, `stream-json`, and official permission/tool surfaces. A bounded wrapper/workspace artifact is secondary; internal transcript, cache, and log sources are forbidden.
- Every adapter digest contains `runtime_version`, `protocol_or_schema_version`, `adapter_version`, `source_class`, `supported_event_groups`, and `known_missing_events`.
- Only sessions wrapped from start to finish by AOS can issue `AOS-Coding P0`.
- Imported sessions are diagnostic only; native gaps are never silently guessed.

## Rejected alternatives

- Treating absent events as successful behavior.
- Scoring imported history as equivalent to a controlled run.

## Consequences

- Codex is implemented and conformed before scenario expansion; Claude Code follows the full Form A core.
- Parity means semantic normalized equivalence, not identical native logs.

## Implementation gate

No product code may rely on ADR-0007 until a Maintainer Gate records an explicit accepted verdict for the exact file digest. A material edit returns the ADR to PROPOSED.
