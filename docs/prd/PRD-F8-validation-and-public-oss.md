# PRD F8 — Human validation and public OSS readiness

- Milestone: M3 · Alpha and Form B / M4 · Public OSS Readiness · ADR: 0002, 0007, 0010

## Goal

Run the preregistered 20-person alpha path, publish limitations and intended use, close license/notices, provide reproducible demos, and obtain one independent fixture reproduction before public transition.

## Non-goals

No matched percentile, certification, hiring use, public personal leaderboard, third runtime, or permanent telemetry.

## User stories

- As an external reviewer, I can reproduce scorer fixtures and inspect negative validation outcomes.
- As a contributor, I have a safe path for adapters, scenarios, and conformance evidence.

## Requirements

1. Preregister alpha cohorts, counterbalance, hypotheses, exclusions, and stop rules.
2. Publish `VALIDATION.md`, `LIMITATIONS.md`, `INTENDED_USE.md`, judge reliability, and privacy threat boundaries.
3. Decide OSS license and third-party notices before public visibility.
4. Obtain and verify one external reproduction; keep telemetry off.

## Acceptance

- AC-F8-1: alpha report exposes all preregistered results and deviations.
- AC-F8-2: publication gate fails on missing license, notices, limitations, or reproduction.
- AC-F8-3: public materials contain no percentile, certification, hiring, or industry-standard claim.
