# F7 tickets — Form B and improvement

> PRD: `docs/prd/PRD-F7-form-b-and-improvement.md` · ADR: 0008, 0010 · Milestone: M3

## T-701 Build linked but non-reused Form B (L)

- **Ownership:** `suites/coding-core-v0/form-b/**`; `suites/coding-core-v0/linking.json`.
- **Preconditions/dependencies:** T-505, T-603.
- **Forbidden:** same repository/answers/traps as Form A, unblinded tuning to participant outcomes, exact growth score without linking, weaker safety opportunities.
- **RED:** exposure similarity checker accepts copied artifacts and task shortcuts.
- **Minimum GREEN:** same construct/opportunity profile, different surface/repository/traps, preregistered linking hypotheses, exposure-distance and leakage checks.
- **AC ↔ tests:** AC-F7-1 foundation ↔ duplicate artifact, semantic construct map, opportunity parity, hidden-oracle isolation, exposure ID.
- **Verification:** Form B conformance, contamination scan, reference timing, full/build; blind manual review without Form A answers.
- **Invalidation/stop/evidence:** Form A/B/scenario change invalidates linking evidence; stop on shared solution shortcut. Evidence includes construct map and similarity report.

## T-702 Implement seven-day sprint and exposure ledger (M)

- **Ownership:** `packages/runner/src/sprint.ts` — `createSprint`, `recordAdherence`; `packages/runner/src/exposure-ledger.ts`.
- **Preconditions/dependencies:** T-701.
- **Forbidden:** two active treatments, editable baseline digest, hidden telemetry, growth after repeated form, unrecorded deviation.
- **RED:** duplicate Form A and multi-treatment log still qualify for retest.
- **Minimum GREEN:** local treatment manifest, day/adherence/deviation/cost events, immutable baseline, explicit user-run retest, exposure uniqueness gate.
- **AC ↔ tests:** AC-F7-1/2 ↔ repeated form, second treatment, missed adherence, baseline drift, opt-in retest, local-only storage.
- **Verification:** focused sprint/ledger tests with fake clock; full/build; manual `.aos/` privacy census.
- **Invalidation/stop/evidence:** ledger/treatment/baseline change invalidates transfer claim; stop on incomplete exposure history. Evidence includes local manifest digest.

## T-703 Evaluate transfer signal and growth eligibility (L)

- **Ownership:** `packages/scorer/src/transfer.ts` — `evaluateTransfer`; `packages/reporter/src/transfer.ts`.
- **Preconditions/dependencies:** T-702, T-603.
- **Forbidden:** AOS-G P0 before linking, positive signal with M15–M17 degradation or S2+, causal claim from invalid adherence, hidden subgroup selection.
- **RED:** target metric improves while safety or verification degrades and result remains positive.
- **Minimum GREEN:** target, non-degradation, safety, cost/intervention, exposure, adherence, and linking gates; typed failure decomposition.
- **AC ↔ tests:** AC-F7-3 ↔ improvement-valid, verification-degraded, unsafe, cost-exceeded, exposure-invalid, treatment-deviation, no-linking.
- **Verification:** focused transfer tests; preregistered fixture matrix; full/build; independent recomputation of result table.
- **Invalidation/stop/evidence:** scorer/form/linking change invalidates transfer results; stop on post-hoc subset. Evidence includes all preregistered rows and decision trace.
