# PRD E13 — Implement a clearly non-verified 3–5 minute Snapshot that routes users to the full assessment without impersonating it.

- Status: **PROPOSED — CEO GATE REQUIRED**
- Milestone: S5 · Public OSS
- Dependencies: G1–G3 verdicts via E12; ADR-0002
- Authority: `docs/north-star/agent-operator-score-ssot-v1.0.md`

## Goal

Implement a clearly non-verified 3–5 minute Snapshot that routes users to the full assessment without impersonating it.

## Non-goals

- No AOS-Coding P0 number, PROVISIONAL label, safety-clear claim, percentile, or performed-assessment language.

## Functional and contract requirements

1. Emit estimate band, recommended family, next command, mandatory `ESTIMATE` watermark, input limitations, and version.
2. Keep Snapshot schema and renderer separate from verified results.
3. Allow explicit local share-card generation only from privacy-allowlisted fields and never by default.
4. Add copy and mutation tests preventing score/status/safety leakage.

## Acceptance criteria

- AC-E13-1: every output carries ESTIMATE and no prohibited verified fields.
- AC-E13-2: Snapshot cannot be parsed as a verified result.
- AC-E13-3: share projection rejects unknown/private fields and makes zero network calls.

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
