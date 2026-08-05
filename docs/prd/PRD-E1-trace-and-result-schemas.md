# PRD E1 — Publish versioned, strict, runtime-neutral contracts for AOS traces, results, Opportunity Profiles, evidence, and provenance.

- Status: **PROPOSED — CEO GATE REQUIRED**
- Milestone: S1 · G0 Scorer Truth
- Dependencies: E0-A, E0-B, E0-C, E0-D; ADR-0004–0007
- Authority: `docs/north-star/agent-operator-score-ssot-v1.0.md`

## Goal

Publish versioned, strict, runtime-neutral contracts for AOS traces, results, Opportunity Profiles, evidence, and provenance.

## Non-goals

- No scorer decisions, adapter-native payload exposure, secret values, or hidden reasoning.

## Functional and contract requirements

1. Implement JSON Schemas for all standard events, common IDs, correlation, actors, bounded/redacted payloads, evidence/artifact digests, and timestamps.
2. Implement result states, optional score rules, factor/safety separation, coverage, takeover attribution, retest type, limitations, score/scorer/suite/adapter digests, and Opportunity Profile.
3. Make prohibited percentile/certification fields impossible before calibrated eligibility.
4. Provide canonical positive/negative fixtures and semver compatibility/digest tooling.

## Acceptance criteria

- AC-E1-1: valid fixtures pass on Node 20/24; missing identity, unbounded payload, unknown event, secret value, invalid score-state, and traversal fail.
- AC-E1-2: result cannot encode a score for insufficient/unsafe/invalid states or percentile for P0.
- AC-E1-3: repeated canonical serialization is byte-identical.

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
