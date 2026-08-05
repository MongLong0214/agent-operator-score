# PRD E9 — Implement Claude Code controlled-wrapper support and prove semantic parity with Codex for shared events.

- Status: **PROPOSED — CEO GATE REQUIRED**
- Milestone: S3 · Full Form A & Second Runtime
- Dependencies: E8, E0-B; ADR-0007
- Authority: `docs/north-star/agent-operator-score-ssot-v1.0.md`

## Goal

Implement Claude Code controlled-wrapper support and prove semantic parity with Codex for shared events.

## Non-goals

- No third runtime, silent fallback, chain-of-thought capture, or guessed delegation joins.

## Functional and contract requirements

1. Implement capability discovery, wrapper/hook/derived sources, normalization, redaction, identity limits, and lifecycle.
2. Emit explicit UNAVAILABLE/BEST_EFFORT where native evidence is missing.
3. Run shared semantic parity fixtures with adapter-specific native inputs.
4. Prove profile mismatch and imported-session restrictions remain visible.

## Acceptance criteria

- AC-E9-1: doctor reports every capability row with source/effect/digest.
- AC-E9-2: shared semantic events canonicalize equivalently across adapters.
- AC-E9-3: meaningful runtime differences are retained, not erased.
- AC-E9-4: missing required events block issuance.

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
