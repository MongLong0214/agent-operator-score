# Atomic Ticket Board

**STATIC DAG VIEW — NOT OPERATIONAL AUTHORITY**

Current static rows are authored from the exact ticket contracts and static sequencing in [`../planning/AOS-EXECUTION-ROADMAP.md`](../planning/AOS-EXECUTION-ROADMAP.md). `docs/issues.json` remains a legacy issue-creation template until D0-004A normalizes it into the canonical static catalog and D0-004C begins rendering this board from that catalog. After D0-004 is verified, current state comes only from `npm run ops:status -- --strict`; until then use the interim direct-fact rule in `AGENTS.md`.

This board owns only ticket IDs, milestone placement, size, and dependency edges. It contains no current ready ticket or blocker verdict. An open or closed GitHub issue is not implementation authorization.

| Ticket | Epic | Milestone | Size | Dependencies |
|---|---|---|---:|---|
| [D0-001](D0/D0-001-canonical-identifier-registry.md) | D0 | S0 · Name & Contracts | S | None |
| [D0-002](D0/D0-002-repository-and-npm-workspace-skeleton.md) | D0 | S0 · Name & Contracts | M | D0-001 |
| [D0-003](D0/D0-003-active-documentation-and-legacy-boundary-migration.md) | D0 | S0 · Name & Contracts | M | D0-001 |
| [D0-004](D0/D0-004-planning-contract-validator-and-governance-gate.md) | D0 | S0 · Name & Contracts | L | D0-002 |
| [D0-005](D0/D0-005-governance-mode-contract-and-advisory-boundary.md) | D0 | S0 · Name & Contracts | M | None |
| [D0-006](D0/D0-006-effective-state-quarantine-and-legacy-reclassification.md) | D0 | S0 · Name & Contracts | M | D0-005 |
| [D0-007](D0/D0-007-artifact-manifest-v3-and-legacy-migration.md) | D0 | S0 · Name & Contracts | L | D0-006 |
| [D0-008](D0/D0-008-github-review-acceptance-derivation-inactive.md) | D0 | S0 · Name & Contracts | L | D0-007 |
| [D0-009](D0/D0-009-authenticated-review-activation.md) | D0 | S0 · Name & Contracts | L | D0-008 |
| [D0-010](D0/D0-010-gate-batch-scope-and-renewal.md) | D0 | S0 · Name & Contracts | M | D0-002 |
| [E0A-001](E0-A/E0A-001-freeze-m01-m20-metric-registry.md) | E0-A | S0 · Name & Contracts | M | D0-004 |
| [E0A-002](E0-A/E0A-002-freeze-eligibility-and-score-issuance-predicate.md) | E0-A | S0 · Name & Contracts | L | E0A-001 |
| [E0A-003](E0-A/E0A-003-freeze-formula-factor-safety-and-display-precision-contract.md) | E0-A | S0 · Name & Contracts | M | E0A-002 |
| [E0B-001](E0-B/E0B-001-define-adapter-capability-schema-and-complete-event-matrix.md) | E0-B | S0 · Name & Contracts | L | None |
| [E0B-002](E0-B/E0B-002-define-controlled-and-imported-session-classification.md) | E0-B | S0 · Name & Contracts | M | E0B-001 |
| [E0B-003](E0-B/E0B-003-specify-capability-doctor-output-and-verdict-fixtures.md) | E0-B | S0 · Name & Contracts | M | E0B-001,E0B-002 |
| [E0C-001](E0-C/E0C-001-preregister-pack-simulation-inputs-and-invariants.md) | E0-C | S0 · Name & Contracts | M | None |
| [E0C-002](E0-C/E0C-002-implement-deterministic-pack-budget-and-eligibility-simulator.md) | E0-C | S0 · Name & Contracts | L | E0C-001 |
| [E0C-003](E0-C/E0C-003-emit-preflight-decision-report-and-freeze-gate.md) | E0-C | S0 · Name & Contracts | S | E0C-002 |
| [E0D-001](E0-D/E0D-001-define-prescription-input-formulas-and-missing-rules.md) | E0-D | S0 · Name & Contracts | L | None |
| [E0D-002](E0-D/E0D-002-freeze-treatment-registry-and-safety-remediation.md) | E0-D | S0 · Name & Contracts | M | E0D-001 |
| [E0D-003](E0-D/E0D-003-implement-deterministic-one-lever-selector-contract.md) | E0-D | S0 · Name & Contracts | M | E0D-001,E0D-002 |
| [E1-001](E1/E1-001-define-aos-trace-schema-and-canonical-event-registry.md) | E1 | S1 · G0 Scorer Truth | L | None |
| [E1-002](E1/E1-002-define-aos-result-and-opportunity-profile-schemas.md) | E1 | S1 · G0 Scorer Truth | L | E1-001 |
| [E1-003](E1/E1-003-add-schema-conformance-compatibility-and-digest-gate.md) | E1 | S1 · G0 Scorer Truth | M | E1-001,E1-002 |
| [E2-001](E2/E2-001-implement-opportunity-eligibility-and-evidence-deduplication.md) | E2 | S1 · G0 Scorer Truth | L | E1-003 |
| [E2-002](E2/E2-002-implement-metric-factor-o-p-and-aos-coding-p0-scoring.md) | E2 | S1 · G0 Scorer Truth | L | E2-001 |
| [E2-003](E2/E2-003-implement-ordered-integrity-safety-and-issuance-gate.md) | E2 | S1 · G0 Scorer Truth | L | E2-002 |
| [E2-004](E2/E2-004-build-complete-scorer-conformance-fixture-corpus.md) | E2 | S1 · G0 Scorer Truth | L | E2-003 |
| [E2-005](E2/E2-005-close-g0-scorer-truth-reproducibility-gate.md) | E2 | S1 · G0 Scorer Truth | M | E2-004 |
| [E3-001](E3/E3-001-implement-explicit-root-fresh-workspace-lifecycle.md) | E3 | S2 · Runner & Differentiated Wedge | L | E2-005 |
| [E3-002](E3/E3-002-separate-worker-oracle-secrets-descriptors-and-ipc.md) | E3 | S2 · Runner & Differentiated Wedge | L | E3-001 |
| [E3-003](E3/E3-003-implement-atomic-budgets-approvals-and-seeded-fault-replay.md) | E3 | S2 · Runner & Differentiated Wedge | L | E3-002 |
| [E3-004](E3/E3-004-implement-watchdog-process-reconciliation-and-one-terminal-state.md) | E3 | S2 · Runner & Differentiated Wedge | L | E3-003 |
| [E4-001](E4/E4-001-define-runtime-adapter-interface-and-controlled-wrapper-lifecycle.md) | E4 | S2 · Runner & Differentiated Wedge | L | E3-004 |
| [E4-002](E4/E4-002-implement-codex-identity-and-capability-discovery.md) | E4 | S2 · Runner & Differentiated Wedge | L | E4-001 |
| [E4-003](E4/E4-003-normalize-codex-controlled-events-with-bounded-redaction.md) | E4 | S2 · Runner & Differentiated Wedge | L | E4-002 |
| [E4-004](E4/E4-004-prove-codex-doctor-conformance-and-session-classification.md) | E4 | S2 · Runner & Differentiated Wedge | M | E4-003 |
| [E5-001](E5/E5-001-define-sealed-scenario-registry-and-opportunity-audit.md) | E5 | S2 · Runner & Differentiated Wedge | L | E4-004 |
| [E5-002](E5/E5-002-build-fam-4-continuity-and-resume-scenario.md) | E5 | S2 · Runner & Differentiated Wedge | L | E5-001 |
| [E5-003](E5/E5-003-build-fam-4-retry-transition-and-idempotency-scenario.md) | E5 | S2 · Runner & Differentiated Wedge | L | E5-001 |
| [E5-004](E5/E5-004-build-fam-4-stall-termination-and-budget-scenario.md) | E5 | S2 · Runner & Differentiated Wedge | L | E5-002,E5-003 |
| [E6-001](E6/E6-001-build-fam-5-public-green-hidden-fail-scenario.md) | E6 | S2 · Runner & Differentiated Wedge | L | E5-004 |
| [E6-002](E6/E6-002-build-fam-5-stale-evidence-and-exact-revision-scenario.md) | E6 | S2 · Runner & Differentiated Wedge | L | E6-001 |
| [E6-003](E6/E6-003-build-fam-5-scope-regression-and-wrong-target-scenario.md) | E6 | S2 · Runner & Differentiated Wedge | L | E6-001 |
| [E6-004](E6/E6-004-compose-fam-5-claim-evidence-conformance-gate.md) | E6 | S2 · Runner & Differentiated Wedge | M | E6-001,E6-002,E6-003 |
| [E7-001](E7/E7-001-build-fam-6-failure-diagnosis-and-minimum-recovery-scenario.md) | E7 | S2 · Runner & Differentiated Wedge | L | E6-004 |
| [E7-002](E7/E7-002-build-fam-6-least-privilege-and-safety-scenario.md) | E7 | S2 · Runner & Differentiated Wedge | L | E7-001 |
| [E7-003](E7/E7-003-build-fam-6-quality-constrained-efficiency-scenario.md) | E7 | S2 · Runner & Differentiated Wedge | L | E7-001,E7-002 |
| [E7-004](E7/E7-004-close-differentiated-wedge-and-g0-demo-candidate.md) | E7 | S2 · Runner & Differentiated Wedge | M | E7-001,E7-002,E7-003 |
| [E8-001](E8/E8-001-build-fam-1-intent-and-contracting-scenario.md) | E8 | S3 · Full Form A & Second Runtime | L | None |
| [E8-002](E8/E8-002-build-fam-2-context-rag-and-decoy-scenario.md) | E8 | S3 · Full Form A & Second Runtime | L | None |
| [E8-003](E8/E8-003-build-fam-3-graph-orchestration-and-join-scenario.md) | E8 | S3 · Full Form A & Second Runtime | L | None |
| [E8-004](E8/E8-004-compose-and-freeze-six-family-form-a.md) | E8 | S3 · Full Form A & Second Runtime | L | E8-001,E8-002,E8-003 |
| [E9-001](E9/E9-001-implement-claude-code-identity-capability-and-wrapper-lifecycle.md) | E9 | S3 · Full Form A & Second Runtime | L | E8-004 |
| [E9-002](E9/E9-002-normalize-claude-code-events-with-bounded-redaction.md) | E9 | S3 · Full Form A & Second Runtime | L | E9-001 |
| [E9-003](E9/E9-003-prove-codex-claude-semantic-parity-and-declared-differences.md) | E9 | S3 · Full Form A & Second Runtime | L | E9-002 |
| [E10-001](E10/E10-001-render-canonical-json-and-markdown-reports.md) | E10 | S3 · Full Form A & Second Runtime | L | E9-003,E8-004 |
| [E10-002](E10/E10-002-implement-metric-event-artifact-evidence-drill-down.md) | E10 | S3 · Full Form A & Second Runtime | M | E10-001 |
| [E10-003](E10/E10-003-render-deterministic-primary-constraint-and-one-lever.md) | E10 | S3 · Full Form A & Second Runtime | M | E10-001,E10-002 |
| [E11-001](E11/E11-001-build-linked-non-reused-form-b-and-exposure-gate.md) | E11 | S4 · Human Alpha & Retest | L | E10-003 |
| [E11-002](E11/E11-002-implement-one-lever-seven-day-sprint-ledger.md) | E11 | S4 · Human Alpha & Retest | M | E11-001 |
| [E11-003](E11/E11-003-classify-retest-attribution-and-transfer-signal.md) | E11 | S4 · Human Alpha & Retest | L | E11-002 |
| [E12-001](E12/E12-001-freeze-alpha-preregistration-protocol-and-data-dictionary.md) | E12 | S4 · Human Alpha & Retest | L | E11-003 |
| [E12-002](E12/E12-002-execute-reference-and-20-person-alpha-with-immutable-provenance.md) | E12 | S4 · Human Alpha & Retest | L | E12-001 |
| [E12-003](E12/E12-003-analyze-alpha-and-publish-g1-g2-g3-verdicts.md) | E12 | S4 · Human Alpha & Retest | L | E12-002 |
| [E13-001](E13/E13-001-define-and-render-snapshot-estimate-output.md) | E13 | S5 · Public OSS | M | None |
| [E13-002](E13/E13-002-implement-explicit-privacy-allowlisted-snapshot-share-artifact.md) | E13 | S5 · Public OSS | M | E13-001 |
| [E14-001](E14/E14-001-complete-name-license-notices-and-security-clearance.md) | E14 | S5 · Public OSS | L | E13-002 |
| [E14-002](E14/E14-002-build-public-documentation-demo-and-contributor-conformance-surface.md) | E14 | S5 · Public OSS | L | E14-001 |
| [E14-003](E14/E14-003-obtain-independent-reproduction-and-close-g4-publication-gate.md) | E14 | S5 · Public OSS | L | E14-002 |

## Gate invariant

`SSOT final → Maintainer accepts ADR → Maintainer accepts PRD → Maintainer accepts exact ticket → RED → minimum GREEN → focused/full/build/manual → cumulative exact-head review → exact-head CI → merge authorization`.

A head, contract, fixture, oracle, lockfile, runtime identity, or permission-profile change invalidates the affected evidence. A blocked ticket blocks every dependent ticket.
