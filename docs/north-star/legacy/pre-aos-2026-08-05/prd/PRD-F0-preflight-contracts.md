# PRD F0 — Preflight measurement contracts

- Milestone: M0 · Freeze (2026-08-12) · ADR: 0005, 0006, 0008, 0010

## Goal

Turn the north-star's 20 metrics, adapter observability, 45-minute budget, and one-lever rule into versioned machine-readable contracts before schemas or scenarios freeze.

## Non-goals

No scorer, runner, adapter implementation, human score, or new metric.

## User stories

- As a maintainer, I can prove every metric has evidence, opportunity, failure, and treatment semantics.
- As an operator, I am not penalized for an adapter's missing observability.

## Requirements

1. Pin M01–M20 without additions.
2. Pin runtime capability states and missing-evidence effects.
3. Simulate pack duration and opportunity eligibility before Form A design.
4. Resolve one treatment deterministically or return `MANUAL_REVIEW_REQUIRED`.

## Acceptance

- AC-F0-1: registry validation rejects the 21st metric and missing consumer routes.
- AC-F0-2: matrix validation rejects silent inference and missing REQUIRED sources.
- AC-F0-3: simulation reports median, p90, eligible metrics, and prescription eligibility; failing hypotheses block freeze.
- AC-F0-4: lever fixtures cover safety-first, tie-break, lower-cost, and abstention paths.
