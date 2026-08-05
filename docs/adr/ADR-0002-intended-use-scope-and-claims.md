# ADR-0002: Limit AOS to local provisional coding-operator assessment

- Status: **PROPOSED — CEO GATE REQUIRED**
- Date: 2026-08-05
- Authority: `docs/north-star/agent-operator-score-ssot-v1.0.md`

## Context

AOS has measurement design but no human calibration evidence. Product language must not outrun evidence.

## Decision

- P0 is 100% OSS and local-first with no account, payment, central user database, default telemetry, SaaS, leaderboard, hiring, certification, or percentile.
- Verified output is `EXPERIMENTAL / PROVISIONAL`; Snapshot is `ESTIMATE`; imported sessions are `DIAGNOSTIC ONLY`.
- The allowed claim is conditional performance in the declared environment and task pack.
- G1 failure triggers claim reduction or a diagnostics/regression pivot.

## Rejected alternatives

- Commercial surfaces before measurement evidence.
- A latent personal ability or global rank claim before calibration.

## Consequences

- Copy scanners and result schemas make prohibited claims unrepresentable where possible.
- `INTENDED_USE.md` and `LIMITATIONS.md` are release gates.

## Implementation gate

No product code may rely on ADR-0002 until the CEO records an explicit accepted verdict for the exact file digest. A material edit returns the ADR to PROPOSED.
