# F0 tickets — Preflight measurement contracts

> PRD: `docs/prd/PRD-F0-preflight-contracts.md` · ADR: 0005, 0006, 0008, 0010 · Milestone: M0

## T-001 Freeze M01–M20 registry (M)

- **Ownership:** `specs/metrics.v0.json`; `packages/schema/src/metric-registry.ts` — `MetricDefinition`, `validateMetricRegistry`.
- **Preconditions/dependencies:** accepted ADRs; none.
- **Forbidden:** metric 21; scoring code; weights not present in the north-star; dead field without a consumer route.
- **RED:** registry fixture with M21 and one missing evidence consumer passes because no validator exists; expected failure after test is introduced.
- **Minimum GREEN:** encode exactly M01–M20, factor, opportunity, authoritative evidence, gaming guard, treatment ID, and consumer route; reject additions/duplicates/gaps.
- **AC ↔ tests:** AC-F0-1 ↔ `metric-registry.test.ts` cases `exact-20`, `reject-M21`, `reject-gap`, `reject-dead-route`.
- **Verification:** `npm test -w @aos/schema -- metric-registry`; then `npm test && npm run build`; expected 4/4 focused and full zero failures. Manual: `LIVE_NA`—pure contract.
- **Invalidation/stop/evidence:** changes to registry or validator invalidate schema/scorer downstream; stop on any semantic ambiguity and escalate to ADR, not code. Evidence includes canonical registry SHA-256.

## T-002 Freeze adapter observability matrix (M)

- **Ownership:** `specs/adapter-capabilities.v0.json`; `packages/schema/src/capability.ts` — `CapabilityStatus`, `validateCapabilityMatrix`.
- **Preconditions/dependencies:** T-001.
- **Forbidden:** silent inference, unknown status, REQUIRED group without source/effect, vendor-only field used directly by scorer.
- **RED:** matrix with missing REQUIRED source and inferred event is accepted; expected validator failure.
- **Minimum GREEN:** encode every north-star event group with status, source class, score-block effect, and runtime declaration constraints.
- **AC ↔ tests:** AC-F0-2 ↔ `capability.test.ts` cases for complete matrix, missing source, invalid status, and silent derived claim.
- **Verification:** `npm test -w @aos/schema -- capability`; `npm test && npm run build`; manual `LIVE_NA` until adapter tickets.
- **Invalidation/stop/evidence:** any matrix change invalidates adapter parity and affected scores; stop if either runtime cannot identify a REQUIRED source and record the score-block decision.

## T-003 Simulate pack time and opportunity eligibility (L)

- **Ownership:** `packages/scorer/src/simulation/pack-budget.ts` — `simulatePackBudget`; `fixtures/simulation/*.json`; `docs/VALIDATION-PREFLIGHT.md`.
- **Preconditions/dependencies:** T-001, T-002.
- **Forbidden:** post-hoc deletion of slow scenarios, fabricated human timing, treating one opportunity as two, changing metric count to make thresholds pass.
- **RED:** north-star upper-bound schedule reports PASS without p90 margin and without prescription-eligible metrics.
- **Minimum GREEN:** deterministic Monte Carlo/scripted-policy simulation with preregistered inputs, separate reference-operator assumption table, and simultaneous assertions: median ≤40, p90 ≤45, ≥14 eligible metrics, ≥1 authoritative two-opportunity prescription path.
- **AC ↔ tests:** AC-F0-3 ↔ `pack-budget.test.ts` cases `north-star-fragile`, `valid-pack`, `slow-pack`, `single-opportunity-no-prescription`, `double-count-rejected`.
- **Verification:** `npm test -w @aos/scorer -- pack-budget`; `npm run simulate:pack -- --seed 20260805`; full/build; manual review compares emitted assumptions with preregistration.
- **Invalidation/stop/evidence:** input distribution or simulation code change invalidates all timing/eligibility numbers; FAIL blocks Form A freeze. Evidence includes seed, manifest, exact head, raw results, and digest.

## T-004 Freeze deterministic lever registry (M)

- **Ownership:** `specs/treatments.v0.json`; `packages/scorer/src/diagnosis/select-lever.ts` — `selectPrimaryConstraint`.
- **Preconditions/dependencies:** T-001, T-003.
- **Forbidden:** generated advice, multiple treatments, candidate with confidence <0.70 or opportunities <2, safety remediation mixed with ordinary advice.
- **RED:** tie and insufficient-evidence inputs return arbitrary recommendations.
- **Minimum GREEN:** implement safety-first, eligibility filter, factor priority, metric minimum, treatment map, cost/permission tie-break, and `MANUAL_REVIEW_REQUIRED`.
- **AC ↔ tests:** AC-F0-4 ↔ `select-lever.test.ts` cases `S2-remediation`, `factor-priority`, `lower-cost`, `insufficient-opportunities`, `manual-review`.
- **Verification:** `npm test -w @aos/scorer -- select-lever`; full/build; manual `LIVE_NA`—deterministic contract.
- **Invalidation/stop/evidence:** treatment or priority change invalidates diagnosis golden files and Form B protocol; stop rather than inventing a tie-break. Evidence includes decision trace for every fixture.
