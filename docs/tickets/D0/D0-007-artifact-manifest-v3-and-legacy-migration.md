# D0-007 · v3 artifact-manifest schema, validator, and legacy migration

- Status: **BLOCKED — OWNER-RATIFIED ONE-TIME GOVERNANCE REPAIR + CEO GATE REQUIRED**
- Epic: D0
- Milestone: S0 · Name & Contracts
- Owning PRD: [D0-GOV](../../prd/PRD-D0-GOV-authenticated-governance-repair.md)
- Size: L
- Dependencies: D0-006

## Goal

Create the v3 artifact-manifest schema and fail-closed validator, then migrate legacy v2 rows with immutable provenance only. The migration makes artifact identity inspectable; it grants neither acceptance, authorization, nor artifact freeze.

## Exact ownership

- `docs/decisions/maintainer-gate-artifact-manifest.schema.v3.json` keys `schema_version`, `manifest_id`, `artifacts`, `artifacts[].path`, `artifacts[].sha256`, `artifacts[].kind`, `artifacts[].source_record_id`, `artifacts[].source_record_sha256`, and `artifacts[].migration_provenance`; `docs/decisions/maintainer-gate-artifact-manifest.v3.json`; new `validateArtifactManifestV3` and `migrateLegacyRegistryToArtifactManifestV3` exports in `scripts/validate-artifact-manifest.mjs`; `tests/artifact-manifest-v3.test.mjs`; and `fixtures/governance/artifact-manifest-v3/**`.
- The only resolver integration is existing `collectLiveExecutionFacts` plus new `collectArtifactManifestV3Facts` and `validateArtifactManifestV3ForResolution` in `scripts/resolve-execution-state.mjs`; no other resolver symbol or behavior.
- The future D0-007 allowlist/census edit is exactly the `controlPlaneAllowlist` literal in `scripts/validate-planning.mjs`, adding only `scripts/validate-artifact-manifest.mjs` and `tests/artifact-manifest-v3.test.mjs`; and both `acceptedValidatorOutput` and `pendingValidatorOutput` literals in `tests/planning-contract.test.mjs`, changing `control_plane_code_files=11` and `control_plane_allowlist=11` to `13` in each literal.
- `docs/decisions/maintainer-gate-registry.v2.json` is read-only migration input and is not owned for edit.

## Preconditions

1. The owner-ratified one-time governance repair plus the CEO gate is the explicit authority basis for this exact packet. It authorizes bounded transitional planning-control-plane code and tests only; it conveys zero product-code authority, no readiness, no artifact acceptance, and no artifact freeze.
2. ADR-0013, D0-GOV, D0-005, D0-006, and this exact ticket carry that same basis at their exact candidate digests; advisory mode cannot accept them. D0-006 is verified on `dev` before this ticket's RED.
3. The execution packet records the v2 registry byte digest and the D0-006 effective-state report; each migrated entry must point to one of those exact source records.
4. No new manifest may be described as an approved gate or a freeze before D0-008 derives facts and D0-009 activates the mode.
5. The worktree is clean and no active branch owns a named path or integration symbol.

## Forbidden scope

- Editing, normalizing, or deleting v2 registry history; adding acceptance/approval state; copying a role string into an authenticated-actor field; or granting a legacy manifest freeze.
- Node 22.18 approval, GitHub branch/review mutation, activation, product code, unbounded artifact content capture, or a silent schema/migration fallback.

## RED contract

- Test file: `tests/artifact-manifest-v3.test.mjs`.
- Focused command: `node --test tests/artifact-manifest-v3.test.mjs`.
- Stage only the named test before GREEN. Case `manifest-v3-rejects-unbound-artifact` must fail with `ERR_MODULE_NOT_FOUND` for `scripts/validate-artifact-manifest.mjs`; case `legacy-registry-migrates-with-provenance-and-no-acceptance` then proves the absent v3 output cannot represent legacy provenance.
- Capture the exact command, exit code, named failures, and source-registry digest before creating schema, validator, manifest, fixtures, or integration. Any unrelated failure stops execution.

Expected pre-GREEN failure: `manifest-v3-rejects-unbound-artifact` fails with `ERR_MODULE_NOT_FOUND` for `scripts/validate-artifact-manifest.mjs`.

## Minimum GREEN

- Define v3 records with a schema version, unique manifest ID, safe artifact path, SHA-256 digest, artifact kind, exact source-record ID/digest, and migration timestamp-free provenance only. Reject duplicate, unbound, unsafe, malformed, ambiguous, or authored-effective-state artifact records.
- Produce a deterministic migration that maps every v2 legacy source record to provenance-bearing v3 records without an effective state. Preserve source bytes and do not copy original approval prose as authenticated identity.
- The validator emits identity/provenance and bounded failures only. Effective acceptance is derived later from external facts and is never stored in the manifest; reject attempts to treat a legacy migration as accepted, as `READY_FOR_RED`, or as a freeze.
- Model a changed Node 22.18 artifact as a distinct, unapproved manifest candidate, never as a continuation of a legacy digest.

## Acceptance ↔ tests

- AC-D0-007-1 ↔ `tests/artifact-manifest-v3.test.mjs` case `manifest-v3-rejects-unbound-artifact`.
- AC-D0-007-2 ↔ `tests/artifact-manifest-v3.test.mjs` case `legacy-registry-migrates-with-provenance-and-no-acceptance`.
- AC-D0-007-3 ↔ `tests/artifact-manifest-v3.test.mjs` cases `manifest-v3-rejects-authored-effective-state`, `manifest-v3-rejects-duplicate-artifact`, `manifest-v3-rejects-unsafe-artifact-path`, `manifest-v3-rejects-malformed-record`, `manifest-v3-rejects-ambiguous-provenance` and `manifest-v3-is-deterministic`.

## Verification

1. RED: `node --test tests/artifact-manifest-v3.test.mjs`; capture the named missing-validator failure before GREEN.
2. Focused: `node --test tests/artifact-manifest-v3.test.mjs`; `manifest-v3-rejects-unbound-artifact`, `legacy-registry-migrates-with-provenance-and-no-acceptance`, `manifest-v3-rejects-authored-effective-state`, `manifest-v3-rejects-duplicate-artifact`, `manifest-v3-rejects-unsafe-artifact-path`, `manifest-v3-rejects-malformed-record`, `manifest-v3-rejects-ambiguous-provenance`, and `manifest-v3-is-deterministic` all pass.
3. Full: `npm test`; zero failure and no unregistered skip.
4. Build/package: `npm run build` and `npm run docs:check`; both pass with deterministic manifest bytes on a second run.
5. Manual/live: verify the v2 registry SHA-256 is unchanged and inspect one legacy and one Node 22.18 candidate manifest; `LIVE_NA` for external mutation.
6. Ownership: `git diff --check <base>...<head>` passes and excludes the v2 registry.

## Stop and escalation

- Stop on missing source provenance, any mutable timestamp in canonical bytes, unsafe path, duplicate digest binding, historical rewrite, or a claim that migration authorizes work.
- Stop if the Node 22.18 candidate cannot be distinguished from a legacy digest. Escalate to the owning ADR/PRD; do not broaden the manifest.

## Completion evidence

- Exact base/head; v2 source digest; deterministic v3 schema/manifest digests; migration map; RED/focused/full/build/docs receipts; Node 22.18 distinct-candidate report; ownership audit; exact-head review and CI.

## Invalidation

Any source record, migration rule, schema, manifest, validator, integration symbol, Node 22.18 candidate, runtime identity, or candidate-head change invalidates affected evidence. A legacy record remains legacy even after a fresh manifest is added.
