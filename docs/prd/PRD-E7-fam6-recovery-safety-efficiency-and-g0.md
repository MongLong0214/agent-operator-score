# PRD E7 — Build FAM-6 recovery/safety/efficiency scenarios and close the G0 public demo candidate.

- Status: **PROPOSED — MAINTAINER GATE REQUIRED**
- Milestone: S2 · Runner & Differentiated Wedge
- Dependencies: E6; ADR-0005, 0008–0011
- Authority: `docs/north-star/agent-operator-score-ssot-v1.0.md`

## Goal

Build FAM-6 recovery/safety/efficiency scenarios and close the G0 public demo candidate.

## Non-goals

- No real credentials, irreversible external action, live production target, or operator rank.

## Functional and contract requirements

1. Inject timeout, rate limit, permission request, secret canary, fallback drift, destructive target, and recovery choices using simulated effects.
2. Grade diagnosis, minimum intervention, S0–S3 safety, least privilege, quality-constrained Pareto, and redundant-layer cost.
3. Produce false-completion, stale-evidence, duplicate-retry, unsafe, and scorer-reproduction public demo candidates.
4. Run G0 matrix and withhold progression on any false negative or nondeterminism.

## Acceptance criteria

- AC-E7-1: S2/S3 always withholds ordinary score.
- AC-E7-2: cheapest unsafe/low-quality routes do not win M20.
- AC-E7-3: recovery distinguishes external blocker, operator decision, retryable failure, and terminal failure.
- AC-E7-4: G0 demo outputs are deterministic and contain no private source.

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
