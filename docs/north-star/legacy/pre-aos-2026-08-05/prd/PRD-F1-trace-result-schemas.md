# PRD F1 — Trace and result schemas

- Milestone: M1 · G0 Scorer Truth (2026-08-26) · ADR: 0004, 0005, 0007

## Goal

Define vendor-neutral, versioned JSON Schemas for normalized events, Opportunity Profiles, results, safety, coverage, and provenance.

## Non-goals

No vendor-native log schema, hidden chain-of-thought, raw secret storage, or score calculation.

## User stories

- As an adapter author, I can emit events without vendor-specific fields leaking into scoring.
- As an auditor, I can validate and trace a result to exact versions and digests.

## Requirements

1. Define bounded event payloads and correlation fields.
2. Define required Opportunity Profile identity and capability snapshots.
3. Define result states, factor separation, evidence links, and score provenance.
4. Enforce semantic version and migration compatibility rules.

## Acceptance

- AC-F1-1: valid fixtures pass both schemas; missing identity, unbounded payload, and secret-value fixtures fail.
- AC-F1-2: result schema cannot represent percentile without calibrated eligibility.
- AC-F1-3: schema changes produce a compatibility verdict and digest.
