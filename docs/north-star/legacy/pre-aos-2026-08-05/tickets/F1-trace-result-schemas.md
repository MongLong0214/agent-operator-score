# F1 tickets — Trace and result schemas

> PRD: `docs/prd/PRD-F1-trace-result-schemas.md` · ADR: 0004, 0005, 0007 · Milestone: M1

## T-101 Define normalized trace schema (L)

- **Ownership:** `specs/aos-trace.schema.json`; `packages/schema/src/trace.ts` — `TraceEvent`, `validateTrace`.
- **Preconditions/dependencies:** T-001, T-002, T-003.
- **Forbidden:** hidden chain-of-thought, unbounded payload, secret value, vendor-native field in common scoring namespace, timestamp without timezone.
- **RED:** valid and hostile traces are indistinguishable because schema does not exist.
- **Minimum GREEN:** schema all standard event types, identity/correlation/digest/redaction fields, bounded payloads, event ordering constraints outside JSON Schema where required.
- **AC ↔ tests:** AC-F1-1 ↔ `trace-schema.test.ts` valid minimum/full plus missing run ID, oversized excerpt, secret, broken parent, and unknown event.
- **Verification:** `npm test -w @aos/schema -- trace-schema`; `npm run schema:check`; full/build; manual `LIVE_NA`.
- **Invalidation/stop/evidence:** schema change invalidates fixtures/adapters/scorer evidence; stop on vendor-specific leakage. Evidence includes schema digest and validator-version output.

## T-102 Define result and Opportunity Profile schemas (L)

- **Ownership:** `specs/aos-result.schema.json`, `specs/opportunity-profile.schema.json`; `packages/schema/src/result.ts` — `AosResult`, `OpportunityProfile`.
- **Preconditions/dependencies:** T-101.
- **Forbidden:** percentile without calibration eligibility, combined efficiency/safety field, score without coverage/status/provenance, raw secret or full prompt.
- **RED:** result missing identity or claiming percentile validates.
- **Minimum GREEN:** encode status union, optional score rules, factor rows, safety, coverage, human takeover, evidence links, exact versions/digests, and Opportunity Profile.
- **AC ↔ tests:** AC-F1-2 ↔ `result-schema.test.ts` `provisional-valid`, `percentile-blocked`, `coverage-missing`, `safety-separated`, `export-digest-required`.
- **Verification:** `npm test -w @aos/schema -- result-schema`; schema check; full/build; manual `LIVE_NA`.
- **Invalidation/stop/evidence:** result schema change invalidates report/export goldens; stop if a state permits contradictory score issuance. Evidence includes canonical examples and digests.

## T-103 Add schema conformance and compatibility gate (M)

- **Ownership:** `packages/schema/src/conformance.ts` — `checkCompatibility`; `conformance/schema/**`; `.github/workflows/ci.yml` schema job.
- **Preconditions/dependencies:** T-101, T-102.
- **Forbidden:** silent breaking change, network-dependent schema resolution, empty fixture set reported as PASS.
- **RED:** delete required provenance and CI remains green.
- **Minimum GREEN:** offline schema resolution, positive/negative census, semver compatibility verdict, and digest manifest; CI fails on zero fixtures or unclassified break.
- **AC ↔ tests:** AC-F1-3 ↔ `conformance.test.ts` `additive-minor`, `required-field-major`, `zero-fixture-fail`, `digest-drift`.
- **Verification:** `npm test -w @aos/schema -- conformance`; `npm run conformance`; full/build; inspect GitHub CI exact head.
- **Invalidation/stop/evidence:** schema or resolver change invalidates conformance evidence; stop on `UNCHECKED`. Evidence includes fixture census and compatibility report.
