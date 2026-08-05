# PRD F6 — Reports, drill-down, diagnosis, and Snapshot

- Milestone: M2 · Runner, Adapters, Form A (2026-09-23) · ADR: 0004, 0006, 0008

## Goal

Render honest Markdown/JSON results with provenance, evidence drill-down, separate safety and efficiency, one deterministic lever, and a clearly distinct Snapshot estimate.

## Non-goals

No web dashboard, percentile, shame ranking, future-score promise, automatic public share, or central storage.

## User stories

- As an operator, I understand the cause, evidence, limitation, and next test.
- As an auditor, every displayed number resolves to metric, event, and artifact evidence.

## Requirements

1. Render score version/digest, Opportunity Profile, coverage, factors, safety, trace, lever, retest, and limitations.
2. Keep F6 Efficiency and Safety on separate rows.
3. Resolve one registered lever or `MANUAL_REVIEW_REQUIRED`.
4. Watermark every Snapshot output `ESTIMATE` and state it is not a performed assessment.

## Acceptance

- AC-F6-1: golden reports match canonical JSON and contain no prohibited claim.
- AC-F6-2: broken event/artifact links fail rendering.
- AC-F6-3: Snapshot cannot emit `PROVISIONAL`, percentile, or safety-clear language.

