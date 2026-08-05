# PRD E4 — Implement and prove the Codex controlled-wrapper adapter before scenario expansion.

- Status: **PROPOSED — CEO GATE REQUIRED**
- Milestone: S2 · Runner & Differentiated Wedge
- Dependencies: E0-B, E3; ADR-0007
- Authority: `docs/north-star/agent-operator-score-ssot-v1.0.md`

## Goal

Implement and prove the Codex controlled-wrapper adapter before scenario expansion.

## Non-goals

- No Claude Code implementation, hidden reasoning capture, invented identity, or unsupported-event inference.

## Functional and contract requirements

1. Implement adapter lifecycle, exact/limited identity capture, capability snapshot, wrapper instrumentation, normalized events, redaction, and bounded payloads.
2. Emit required user/tool/evidence/approval/intervention/lifecycle events or block issuance explicitly.
3. Implement `aos doctor --capabilities --runtime codex` with source and missing effect.
4. Conform native/reference inputs to normalized semantic fixtures and persist adapter digest.

## Acceptance criteria

- AC-E4-1: complete/degraded/unsupported Codex profiles produce exact doctor verdicts.
- AC-E4-2: missing required identity/event blocks score issuance without blaming the operator.
- AC-E4-3: secret/canary and bounded-payload fixtures pass.
- AC-E4-4: controlled and imported sessions cannot be confused.

## Failure and stop semantics

- Missing prerequisite, ambiguous ownership, unsupported observability, unsafe permission, wrong target, silent fallback, stale evidence, timeout without a terminal state, or partial-state ambiguity is a hard stop.
- A failed acceptance criterion blocks this epic and every dependent epic; scope cannot be broadened to manufacture PASS.
- Any material edit after approval returns this PRD to PROPOSED and invalidates dependent ticket approval.

## Required completion evidence

- Exact base and exact candidate-head SHA.
- RED command, failing test name, and expected failure reason captured before GREEN.
- Focused, full, build/package, and required manual/live lane outputs tied to candidate head.
- Acceptance-to-test matrix with no orphan requirement or orphan test.
- Diff ownership audit, security/privacy/fail-closed review, and stale-evidence invalidation statement.
