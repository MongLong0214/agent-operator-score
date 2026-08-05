# Product Requirement Documents

Status: **PROPOSED — each PRD requires a separate CEO gate before its ticket set can be approved.**

The execution order is fixed: D0 → E0-A → E0-B → E0-C → E0-D → E1 → E2 → E3 → E4 → E5 → E6 → E7 → G0 → E8 → E9 → E10 → E11 → E12 → E13 → E14/G4.

| PRD | Milestone | Goal |
|---|---|---|
| [D0](PRD-D0-name-migration-and-repository-skeleton.md) | S0 · Name & Contracts | Migrate every active surface to Agent Operator Score and establish a planning-valid repository skeleton without product behavior. |
| [E0-A](PRD-E0A-metric-and-score-issuance-contract.md) | S0 · Name & Contracts | Encode the frozen M01–M20 registry and the complete score-issuance predicate before scoring code. |
| [E0-B](PRD-E0B-adapter-observability-contract.md) | S0 · Name & Contracts | Freeze vendor-neutral capability semantics and the exact information required from Codex and Claude Code adapters. |
| [E0-C](PRD-E0C-pack-time-and-eligibility-simulation.md) | S0 · Name & Contracts | Prove the 35–45 minute pack and required metric opportunities can coexist before building scenarios. |
| [E0-D](PRD-E0D-deterministic-prescription-input-contract.md) | S0 · Name & Contracts | Make every input and tie-break in deterministic one-lever selection executable and fixture-backed. |
| [E1](PRD-E1-trace-and-result-schemas.md) | S1 · G0 Scorer Truth | Publish versioned, strict, runtime-neutral contracts for AOS traces, results, Opportunity Profiles, evidence, and provenance. |
| [E2](PRD-E2-deterministic-scorer-and-conformance.md) | S1 · G0 Scorer Truth | Establish G0 scorer truth with deterministic aggregation, issuance, safety, and conformance fixtures. |
| [E3](PRD-E3-isolated-controlled-runner.md) | S2 · Runner & Differentiated Wedge | Run controlled tasks locally with fresh workspaces, oracle/secret separation, versioned faults, budgets, and exact terminal state. |
| [E4](PRD-E4-codex-adapter.md) | S2 · Runner & Differentiated Wedge | Implement and prove the Codex controlled-wrapper adapter before scenario expansion. |
| [E5](PRD-E5-fam4-loop-state-scenarios.md) | S2 · Runner & Differentiated Wedge | Build executable FAM-4 scenarios for continuity, transition, retry/idempotency, and stall handling. |
| [E6](PRD-E6-fam5-false-completion-scenarios.md) | S2 · Runner & Differentiated Wedge | Build executable FAM-5 scenarios that expose false completion, stale evidence, scope regression, and dishonest claims. |
| [E7](PRD-E7-fam6-recovery-safety-efficiency-and-g0.md) | S2 · Runner & Differentiated Wedge | Build FAM-6 recovery/safety/efficiency scenarios and close the G0 public demo candidate. |
| [E8](PRD-E8-fam1-3-and-form-a.md) | S3 · Full Form A & Second Runtime | Add FAM-1 Intent, FAM-2 Context, FAM-3 Graph and freeze a complete Form A only when timing and eligibility pass. |
| [E9](PRD-E9-claude-code-adapter-and-parity.md) | S3 · Full Form A & Second Runtime | Implement Claude Code controlled-wrapper support and prove semantic parity with Codex for shared events. |
| [E10](PRD-E10-report-and-one-lever.md) | S3 · Full Form A & Second Runtime | Render canonical Markdown/JSON reports with evidence drill-down and one deterministic improvement lever. |
| [E11](PRD-E11-form-b-and-retest-modes.md) | S4 · Human Alpha & Retest | Implement linked but non-reused Form B, one-lever sprint records, and explicit retest attribution modes. |
| [E12](PRD-E12-human-alpha-and-validation.md) | S4 · Human Alpha & Retest | Run a preregistered 20-person alpha to decide whether measurement, attribution, and prescription transfer exist. |
| [E13](PRD-E13-snapshot-estimate.md) | S5 · Public OSS | Implement a clearly non-verified 3–5 minute Snapshot that routes users to the full assessment without impersonating it. |
| [E14](PRD-E14-public-oss-and-g4.md) | S5 · Public OSS | Open the OSS surface only after identity, legal, documentation, reproducibility, and external-reproduction gates pass. |
