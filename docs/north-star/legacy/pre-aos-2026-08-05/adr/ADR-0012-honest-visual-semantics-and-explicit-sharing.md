# ADR-0012: Make visual status honest and sharing explicit

- Status: Accepted (2026-08-05, PRD F9)
- Owner: CEO

## Context

A premium score card can be mistaken for a certification, percentile, model leaderboard, or hiring credential. It can also leak model IDs, paths, prompts, or evidence when shared without a separate privacy boundary.

## Decision

- Every visual surface shows assessment status, suite/form version, Opportunity summary, and safety state when the underlying assessment is allowed to issue one.
- F6 is the M20 Efficiency & Value number. M19 safety remains a separate text-and-icon state and is never averaged into a finish or factor.
- `S2`, `S3`, `UNSAFE`, and `INVALID` use the `Void` presentation and suppress the overall score. No finish may visually override a safety gate.
- Snapshot remains `ESTIMATE`: no AOS-P0 number, no `PROVISIONAL`, no safety-clear language, a required watermark, and a maximum cosmetic finish of `Stable`.
- Verified finishes (`Draft`, `Stable`, `Reliable`, `Sharp`, `Elite`) are cosmetic provisional bands, not global ranks. `Elite` requires an issuable S0/S1 result and always carries “provisional band, not global rank.”
- Archetypes are deterministic descriptions of factor shape. Copy must be non-shaming, must not imply identity or employability, and must always accompany the one evidence-backed lever.
- Export is an explicit local action. The share projection allowlists scores, redacted Opportunity classes, suite/form, presentation labels, and lever title; it excludes prompts, paths, secrets, raw evidence, run identifiers, and exact model ID by default.
- Hosted share pages, automatic posting, accounts, telemetry, and public leaderboards remain outside v0.1. Any later hosted surface requires a new ADR covering consent, deletion, expiry, abuse control, and threat modeling.

## Rejected

- Percentile, top-percent, certification, or hiring copy before calibration: unsupported and prohibited by the north-star.
- Color-only safety: inaccessible and easy to misread.
- Automatic public sharing after assessment: violates the private-by-default result contract.
- Full Opportunity Profile in a share image: exposes unnecessary identity and configuration detail.

## Consequences

Claim, privacy, accessibility, and unsafe-state mutation tests are release gates. A missing status, hidden safety state, leaked disallowed field, or score shown for a withheld result blocks export.
