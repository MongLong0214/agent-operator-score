# F8 tickets — Validation and public OSS

> PRD: `docs/prd/PRD-F8-validation-and-public-oss.md` · ADR: 0002, 0007, 0010 · Milestone: M3/M4

## T-801 Build README, demos, and contributor entry points (M)

- **Ownership:** `README.md`, `CONTRIBUTING.md`, `examples/**`, `docs/demo/**`, `.github/ISSUE_TEMPLATE/**`.
- **Preconditions/dependencies:** T-103; production claims wait for T-601 and T-204.
- **Forbidden:** command marked working before exact-head execution, generated-by attribution, percentile/certification/hiring claim, copied scored-task answer, automatic share.
- **RED:** documentation checker accepts a planned command as available or a missing linked file.
- **Minimum GREEN:** explicit current/planned boundaries, one-command fixture demo once real, false-completion demo, contribution paths, link/claim/example validation.
- **AC ↔ tests:** public-surface foundation ↔ link checker, command-status markers, prohibited claims, fixture-byte match, issue template fields.
- **Verification:** `npm run docs:check`; example commands where marked available; full/build; manual fresh-clone walkthrough.
- **Invalidation/stop/evidence:** docs/example/tool change invalidates walkthrough and claims; stop on any unverified command. Evidence includes fresh-clone transcript.

## T-802 Run preregistered 20-person alpha path (L)

- **Ownership:** `research/alpha/preregistration.md`, `research/alpha/manifest.schema.json`, `packages/analysis/src/alpha.ts` — `analyzeAlpha`; no scorer changes.
- **Preconditions/dependencies:** T-703, T-505.
- **Forbidden:** participant collection before consent/privacy review, post-hoc primary subset, percentile, file-pilot p-value, changing scorer during run, hiding failed runs.
- **RED:** synthetic variance cases cannot detect task/session dominance or missing preregistration fields.
- **Minimum GREEN:** balanced known groups, counterbalance, reference runs, blinded review sample, exact manifest/head, complete-case and missingness report, stop-rule evaluation.
- **AC ↔ tests:** AC-F8-1 ↔ preregistration schema, synthetic variance recovery, missingness, immutable scorer, all-row conservation, no-subset assertion.
- **Verification:** focused analysis tests cross-checked independently; frozen-head pilot then main run; raw-row/hash census; privacy/manual review.
- **Invalidation/stop/evidence:** scorer/task/form/analysis change during study invalidates human result; stop on consent/privacy or frozen-head breach. Evidence includes preregistration timestamp, manifest, row census, and independent stats comparison.

## T-803 Publish validation, limitations, intended use, and judge reliability (L)

- **Ownership:** `docs/VALIDATION.md`, `docs/LIMITATIONS.md`, `docs/INTENDED_USE.md`, `docs/JUDGE_RELIABILITY.md`.
- **Preconditions/dependencies:** T-802.
- **Forbidden:** omit negative result/deviation, certification/hiring/industry-standard claim, precise uncertainty unsupported by data, model-judge verdict presented as deterministic.
- **RED:** prohibited-claim and result-conservation checks accept a selective summary.
- **Minimum GREEN:** all preregistered outcomes, person/task/session evidence, duration, known groups, judge agreement/abstention, deviations, stop verdict, privacy/security limitations, misuse boundary.
- **AC ↔ tests:** AC-F8-1/3 ↔ result-row conservation, claim scanner, citation validator, judge swap/padding evidence links, limitation presence.
- **Verification:** docs checks; regenerate tables from frozen results; citation verification; full/build; blind editorial audit.
- **Invalidation/stop/evidence:** alpha data/analysis/doc table change invalidates publication review; stop on unmatched number or missing negative result. Evidence includes source-to-table manifest.

## T-804 Decide license/notices and enforce publication gate (M)

- **Ownership:** `LICENSE`, `THIRD_PARTY_NOTICES.md`, `docs/decisions/LICENSE.md`, `scripts/publication-gate.mjs` — `checkPublicationReadiness`.
- **Preconditions/dependencies:** T-803, T-906, owner legal/product decision.
- **Forbidden:** inferred license, incompatible dependency, public visibility change without owner gate, package publish, missing copyright/notice.
- **RED:** publication gate passes with no license/notices, incomplete T-906 UI conformance, or an incompatible fixture dependency.
- **Minimum GREEN:** recorded license decision, dependency/license inventory, notices, verified T-906 UI conformance, public-surface claim checks, explicit owner approval token consumed once.
- **AC ↔ tests:** AC-F8-2 ↔ missing license, incompatible license, missing notice, missing/stale UI conformance, no approval, stale approval, valid set.
- **Verification:** focused publication-gate mutations; dependency audit; full/build; manual legal/product review. Live external visibility change is a separate owner-authorized action.
- **Invalidation/stop/evidence:** dependency/license/public-doc change invalidates approval; stop without explicit decision. Evidence includes inventory digest and approval record.

## T-805 Obtain external fixture reproduction and first contribution (L)

- **Ownership:** `docs/reproductions/**`, `conformance/external/**`, contribution PR metadata; no scorer change unless a separate issue is approved.
- **Preconditions/dependencies:** T-804, public transition completed and verified.
- **Forbidden:** self-authored run called external, unverifiable screenshot-only evidence, hidden private path, contributor PII beyond consent, changing expected output to accept mismatch.
- **RED:** reproduction importer accepts wrong scorer/schema digest or incomplete environment.
- **Minimum GREEN:** independent fresh-clone commands, exact versions, fixture input/output digests, environment summary, discrepancy workflow, one accepted technical contribution.
- **AC ↔ tests:** G4 external reproduction ↔ digest mismatch, missing version, wrong fixture, valid bundle, privacy redaction.
- **Verification:** import bundle; rerun referenced fixture; compare canonical output; full/build; verify external URL/PR and public body after refresh.
- **Invalidation/stop/evidence:** scorer/schema/fixture change invalidates prior reproduction for G4; stop on unverifiable independence. Evidence includes external URL, bundle digest, rerun transcript, and accepted contribution record.
