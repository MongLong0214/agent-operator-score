# F6 tickets — Reports and Snapshot

> PRD: `docs/prd/PRD-F6-report-and-snapshot.md` · ADR: 0004, 0006, 0008 · Milestone: M2

## T-601 Render canonical Markdown and JSON reports (L)

- **Ownership:** `packages/reporter/src/render-json.ts` — `renderJson`; `render-markdown.ts` — `renderMarkdown`; `fixtures/reports/**`.
- **Preconditions/dependencies:** T-505, T-203.
- **Forbidden:** recompute score in reporter, percentile, combined safety/efficiency cell, missing limitation, nondeterministic ordering/time.
- **RED:** result with separated safety/efficiency renders ambiguous output or golden bytes drift.
- **Minimum GREEN:** consume validated result only; render required contract fields, known limitations, status-specific score omission, canonical JSON and stable Markdown.
- **AC ↔ tests:** AC-F6-1 ↔ provisional, insufficient, unsafe, invalid, factor separation, no-percentile, golden-byte cases.
- **Verification:** focused reporter goldens twice; full/build; manual screen-reader/plain-terminal review.
- **Invalidation/stop/evidence:** result schema/template change invalidates all report goldens; stop on unresolvable required field. Evidence includes input/output digests.

## T-602 Add metric-to-event-to-artifact drill-down (M)

- **Ownership:** `packages/reporter/src/drilldown.ts` — `buildDrilldown`; `packages/reporter/src/links.ts`.
- **Preconditions/dependencies:** T-601.
- **Forbidden:** raw secret link, path outside run root, broken evidence treated as warning, stale revision link.
- **RED:** missing artifact or wrong digest still renders a successful link.
- **Minimum GREEN:** validate containment, digest, revision, redaction, and event ancestry; typed broken-link failure blocks report issuance.
- **AC ↔ tests:** AC-F6-2 ↔ valid chain, missing event, digest mismatch, traversal, stale revision, redacted excerpt.
- **Verification:** focused drilldown tests; full/build; manual click/path resolution in temp run.
- **Invalidation/stop/evidence:** evidence-linking change invalidates report auditability; stop on any mismatch. Evidence includes resolved-link census.

## T-603 Render deterministic diagnosis and one lever (M)

- **Ownership:** `packages/reporter/src/diagnosis.ts` — `renderDiagnosis`; consumes T-004 output only.
- **Preconditions/dependencies:** T-004, T-601.
- **Forbidden:** new recommendation text not in registry, multiple levers, predicted score, ordinary advice on S2/S3.
- **RED:** ambiguous input renders plausible free-form advice.
- **Minimum GREEN:** render constraint, authoritative trace, treatment ID, expected cost/benefit rule fields, application steps, and Form B condition; render manual review when selected.
- **AC ↔ tests:** AC-F6-1/3 diagnosis ↔ safety remediation, normal lever, manual review, cost tie, missing evidence.
- **Verification:** focused diagnosis goldens; full/build; manual trace-to-text audit.
- **Invalidation/stop/evidence:** lever registry or template change invalidates diagnosis and Form B protocol; stop instead of filling missing fields. Evidence includes selection trace.

## T-604 Implement Snapshot `ESTIMATE` output (M)

- **Ownership:** `packages/cli/src/commands/snapshot.ts` — `runSnapshot`; `packages/reporter/src/snapshot.ts`.
- **Preconditions/dependencies:** T-601.
- **Forbidden:** AOS-P0, `PROVISIONAL`, percentile, `SAFE`, performed-assessment wording, automatic share.
- **RED:** Snapshot fixture can emit verified-score language or omit watermark.
- **Minimum GREEN:** 3–5 minute estimate inputs, band/recommended family/next command only, mandatory watermark and disclaimer in every format.
- **AC ↔ tests:** AC-F6-3 ↔ JSON/Markdown/card watermark, forbidden vocabulary, no safety state, explicit next assessment.
- **Verification:** focused snapshot tests; prohibited-claim scanner; full/build; manual terminal output review.
- **Invalidation/stop/evidence:** template/input change invalidates snapshot claim audit; any verified-score language blocks release. Evidence includes scanner result and goldens.
