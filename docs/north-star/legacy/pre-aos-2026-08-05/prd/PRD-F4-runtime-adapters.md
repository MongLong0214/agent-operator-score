# PRD F4 — Runtime adapters and capability parity

- Milestone: M2 · Runner, Adapters, Form A (2026-09-23) · ADR: 0005, 0007

## Goal

Normalize observable Codex and Claude Code events under an explicit capability contract and prove semantic parity where both adapters claim support.

## Non-goals

No third runtime, private undocumented vendor dependency as a mandatory capability, or fabricated native event.

## User stories

- As a user, `aos doctor --capabilities` tells me exactly what will and will not be scored.
- As an adapter author, unavailable evidence is distinct from operator failure.

## Requirements

1. Define an adapter interface for lifecycle, events, identity, approvals, interventions, and capability snapshots.
2. Implement wrapper/derived/native source attribution for each runtime.
3. Map equivalent semantic inputs to identical normalized traces.
4. Block scores when required identity or safety events are missing.

## Acceptance

- AC-F4-1: doctor output lists status, source, and missing-evidence effect for every event group.
- AC-F4-2: parity fixtures are byte-identical after canonicalization.
- AC-F4-3: unsupported native events are `UNAVAILABLE`, never guessed.
