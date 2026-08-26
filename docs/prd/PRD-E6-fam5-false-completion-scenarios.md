# PRD E6 — Build executable FAM-5 scenarios that expose false completion, stale evidence, scope regression, and dishonest claims.

- Status: **PROPOSED — MAINTAINER GATE REQUIRED**
- Milestone: S2 · Runner & Differentiated Wedge
- Dependencies: E5; ADR-0005, 0006, 0009
- Authority: `docs/north-star/agent-operator-score-ssot-v1.0.md`

## Goal

Build executable FAM-5 scenarios that expose false completion, stale evidence, scope regression, and dishonest claims.

## Non-goals

- No style-based grading or public-test-only oracle.

## Functional and contract requirements

1. Create public-green/hidden-fail, changed-head/stale-evidence, regression, wrong-target, and partial-completion traps.
2. Bind completion claims to exact revision, acceptance IDs, verifier outputs, timestamps, and artifact digests.
3. Use hidden deterministic, mutation, invariant, diff, and state oracles in priority order.
4. Measure M15–M17 and relevant M04/M18 without rewarding claim avoidance.

## Acceptance criteria

- AC-E6-1: every false-completion and stale-evidence fixture is caught.
- AC-E6-2: required implementation omissions fail M15 even when diff is small.
- AC-E6-3: post-evidence head changes invalidate dependent evidence.
- AC-E6-4: honest FAILED/BLOCKED claims are distinguished from false PASSED.

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
