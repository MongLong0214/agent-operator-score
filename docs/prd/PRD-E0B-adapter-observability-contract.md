# PRD E0-B — Freeze vendor-neutral capability semantics and the exact information required from Codex and Claude Code adapters.

- Status: **PROPOSED — CEO GATE REQUIRED**
- Milestone: S0 · Name & Contracts
- Dependencies: D0, E0-A; ADR-0007
- Authority: `docs/north-star/agent-operator-score-ssot-v1.0.md`

## Goal

Freeze vendor-neutral capability semantics and the exact information required from Codex and Claude Code adapters.

## Non-goals

- No adapter process execution or guessed native-event support.

## Functional and contract requirements

1. Encode every SSOT §9.2 event group and REQUIRED/CONDITIONAL/DERIVED/BEST_EFFORT/UNAVAILABLE status.
2. Require source class, evidence locator, missing effect, redaction policy, runtime/version constraint, and derivation proof.
3. Specify controlled-wrapper versus imported-session classification.
4. Specify deterministic `aos doctor --capabilities` JSON and human output, exit semantics, and digest.

## Acceptance criteria

- AC-E0B-1: a matrix missing any event group or source/effect fails.
- AC-E0B-2: unsupported events remain UNAVAILABLE and cannot be silently promoted.
- AC-E0B-3: doctor golden fixtures cover complete, degraded, score-blocked, and imported-only adapters.

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
