# F5 tickets — Form A assessment

> PRD: `docs/prd/PRD-F5-form-a-assessment.md` · ADR: 0005, 0008, 0010 · Milestone: M2

## T-501 Implement sealed scenario registry (L)

- **Ownership:** `packages/runner/src/scenario-registry.ts` — `ScenarioContract`, `loadScenario`; `suites/coding-core-v0/registry.json`.
- **Preconditions/dependencies:** T-003, T-303, T-404.
- **Forbidden:** worker-readable oracle, scenario without primary-opportunity cap, metric opportunity created after observing behavior, shared Form A/B answer artifact.
- **RED:** registry accepts missing oracle digest, five primary metrics, or worker-visible answer path.
- **Minimum GREEN:** sealed contract with family/form/version, budgets, gold/decoy, primary/conditional opportunities, faults, oracle/policy, exposure ID, and worker visibility denylist.
- **AC ↔ tests:** AC-F5-1/2 foundation ↔ schema, cap, path isolation, late-opportunity rejection, exposure uniqueness.
- **Verification:** focused registry tests; oracle-access probe; full/build; manual registry-to-files census.
- **Invalidation/stop/evidence:** scenario/registry/oracle change invalidates timing and score evidence; stop on hidden-data leakage. Evidence includes sealed digests and access-denial log.

## T-502 Build FAM-1 and FAM-2 scenarios (L)

- **Ownership:** `suites/coding-core-v0/form-a/fam-1/**`, `fam-2/**`; no scorer/runner edits.
- **Preconditions/dependencies:** T-501.
- **Forbidden:** solution-path prescription, decoy identifiable by filename alone, forced retrieval, more than four primary opportunities per scenario.
- **RED:** baseline policies pass hidden outcomes while ignoring contract/decoy/injection distinctions.
- **Minimum GREEN:** FAM-1 hidden outcome/non-goal/ask-no-ask; FAM-2 gold/decoy/stale/injection/no-retrieval; deterministic oracles and sealed metric maps.
- **AC ↔ tests:** AC-F5-1/2 ↔ one positive, trap, oracle-denial, and opportunity-census test for each family.
- **Verification:** scenario conformance; scripted policies; full pack smoke; manual adversarial review of obvious cues.
- **Invalidation/stop/evidence:** any task/oracle/fixture change invalidates family timing/eligibility; stop if a shortcut bypasses the construct. Evidence includes policy transcripts and oracle digests.

## T-503 Build FAM-3 and FAM-4 scenarios (L)

- **Ownership:** `suites/coding-core-v0/form-a/fam-3/**`, `fam-4/**`; no shared runner edits.
- **Preconditions/dependencies:** T-501.
- **Forbidden:** mandatory multi-agent route, artificial task count reward, collision without recoverable path, session-loss simulation that reveals expected state.
- **RED:** direct-only or over-parallel policies pass without dependency/join/state integrity.
- **Minimum GREEN:** false-parallel/shared-file/specialist routing scenario and session-loss/reviewer-fail/duplicate-retry/stall scenario with deterministic state/oracle.
- **AC ↔ tests:** AC-F5-1/2 ↔ gold DAG, collision, handoff adoption, resume, duplicate, stall termination, oracle-denial tests.
- **Verification:** scenario conformance; direct and orchestration reference policies; full pack smoke; manual collision/state trace review.
- **Invalidation/stop/evidence:** task/oracle change invalidates eligibility/timing; stop if only one route can pass by construction. Evidence includes counterfactual policy outcomes.

## T-504 Build FAM-5 and FAM-6 scenarios (L)

- **Ownership:** `suites/coding-core-v0/form-a/fam-5/**`, `fam-6/**`; no shared runner edits.
- **Preconditions/dependencies:** T-501.
- **Forbidden:** public test equals hidden oracle, live credential, irreversible external action, cost-only scoring without quality constraint.
- **RED:** public-green/hidden-fail, stale claim, unsafe action, and fallback drift are not distinguished.
- **Minimum GREEN:** false completion/mutation/stale evidence scenario and timeout/rate-limit/secret/permission/fallback/efficiency scenario with safe simulated effects.
- **AC ↔ tests:** AC-F5-1/2 ↔ hidden fail, stale invalidation, S2/S3, wrong target, fallback drift, Pareto comparison, oracle-denial.
- **Verification:** scenario conformance; safe fault policy; full pack smoke; manual secret scanner and no-external-action audit.
- **Invalidation/stop/evidence:** task/oracle/policy change invalidates safety and timing evidence; any real external effect blocks release. Evidence includes canary and effect-ledger census.

## T-505 Compose and freeze Form A pack (L)

- **Ownership:** `suites/coding-core-v0/form-a/pack.json`; `packages/runner/src/assess.ts` — `runAssessmentPack`; `docs/VALIDATION-PREFLIGHT.md` timing section.
- **Preconditions/dependencies:** T-502, T-503, T-504, T-003.
- **Forbidden:** post-hoc scenario exclusion, duplicate behavior credit, reference policy chosen after result, median-only acceptance, freeze with <14 eligible metrics.
- **RED:** current pack either exceeds p90 or cannot produce 14 eligible metrics and a valid lever path.
- **Minimum GREEN:** preregistered policy set, ordered transitions, overhead measurement, eligibility census, simultaneous median/p90/coverage/prescription assertions.
- **AC ↔ tests:** AC-F5-3 ↔ pack composition, no-duplication, eligibility, median/p90, terminal-state, and repeatability tests.
- **Verification:** `npm run assess:reference -- --manifest ...` from frozen head; repeat full matrix; full/build; manual transcript sample. Expected median≤40, p90≤45, eligible≥14.
- **Invalidation/stop/evidence:** any pack/scenario/runner/adapter change invalidates timing and eligibility; FAIL blocks report claims and alpha. Evidence includes preregistration, raw rows, summary, exact head, and artifact hashes.
