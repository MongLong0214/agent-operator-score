# F2 tickets — Deterministic scorer and fixtures

> PRD: `docs/prd/PRD-F2-scorer-and-fixtures.md` · ADR: 0004, 0006, 0010 · Milestone: M1

## T-201 Implement eligibility and metric aggregation (L)

- **Ownership:** `packages/scorer/src/eligibility.ts` — `deriveEligibility`; `packages/scorer/src/aggregate.ts` — `aggregateMetric`.
- **Preconditions/dependencies:** T-001, T-103.
- **Forbidden:** no-opportunity as zero, duplicate evidence credit, secondary metric without sealed opportunity, adapter-missing evidence as operator failure.
- **RED:** absent and duplicated opportunities alter scores incorrectly.
- **Minimum GREEN:** derive denominators from sealed opportunities, enforce authoritative evidence, deduplicate correlation IDs, emit `NOT_OBSERVED` with reason.
- **AC ↔ tests:** AC-F2-1 foundation ↔ `eligibility.test.ts` no-opportunity, duplicate, secondary-without-opportunity, adapter-unavailable, confidence threshold.
- **Verification:** focused scorer test; conformance; full/build; manual `LIVE_NA`.
- **Invalidation/stop/evidence:** eligibility change invalidates every scorer/report fixture; stop on ambiguous opportunity ownership. Evidence includes per-metric numerator/denominator trace.

## T-202 Implement AOS-P0 and factor scoring (L)

- **Ownership:** `packages/scorer/src/score.ts` — `scoreAosP0`, `scoreFactors`; `packages/scorer/src/canonical-json.ts`.
- **Preconditions/dependencies:** T-201.
- **Forbidden:** weight drift, floating nondeterminism, M19 average, percentile, hidden rounding changes.
- **RED:** known vector does not match independently calculated formula or output bytes vary.
- **Minimum GREEN:** exact frozen weights, harmonic mean zero semantics, factor mapping, integer display rounding with unrounded internal values, canonical JSON.
- **AC ↔ tests:** AC-F2-1 ↔ `score.test.ts` published vectors, O/P zero, NOT_OBSERVED denominator, factor separation, repeated-byte identity.
- **Verification:** focused scorer test repeated 100 times and SHA comparison; full/build; independent short implementation cross-check.
- **Invalidation/stop/evidence:** formula/rounding change invalidates all score fixtures and requires new scorer version. Evidence includes independent vector comparison.

## T-203 Implement safety and evidence issuance gate (L)

- **Ownership:** `packages/scorer/src/issuance.ts` — `decideIssuance`; `packages/scorer/src/safety.ts` — `classifySafety`.
- **Preconditions/dependencies:** T-202.
- **Forbidden:** S2/S3 score, coverage<0.70 score, missing required identity, judge override, unsafe remediation mixed with performance advice.
- **RED:** high-quality S2 trace issues a score; stale evidence remains valid.
- **Minimum GREEN:** ordered gates for tamper/identity, safety, integrity, coverage, then score; typed reasons and safety-only remediation.
- **AC ↔ tests:** AC-F2-2 safety cases ↔ `issuance.test.ts` S0/S1/S2/S3, low coverage, stale evidence, missing identity, tamper.
- **Verification:** focused test plus mutation cases that remove each gate; full/build; manual `LIVE_NA`.
- **Invalidation/stop/evidence:** gate order change invalidates scorer/report/safety evidence; any false negative is release-blocking. Evidence includes mutation detection report.

## T-204 Build six conformance fixture families (L)

- **Ownership:** `fixtures/reference-pass`, `reference-fail`, `false-completion`, `stale-evidence`, `duplicate-run`, `unsafe-action`; `conformance/manifest.json`.
- **Preconditions/dependencies:** T-203.
- **Forbidden:** scored-task answer leakage, external network, nondeterministic timestamps, live-looking secrets, fixture with no unique failure reason.
- **RED:** each intended failure is not detected before its fixture and assertion exist.
- **Minimum GREEN:** canonical inputs/outputs, fixed clock/IDs, unique reason, manifest digests, bit-repro runner; include deterministic-verdict-over-judge case.
- **AC ↔ tests:** AC-F2-2/3 ↔ one named test per fixture family plus cross-platform canonical-byte test.
- **Verification:** `npm run fixtures:verify` twice on Node 20/24; diff outputs; full/build; mutation one invariant per family and prove detection.
- **Invalidation/stop/evidence:** scorer/schema/fixture bytes invalidate G0; stop on a fixture that passes for a second unintended reason. Evidence includes all digests and mutation census.
