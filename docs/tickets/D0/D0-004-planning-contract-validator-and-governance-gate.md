# D0-004 · Semantic planning validator v2 and governance gate

- Status: **BLOCKED — ADR + PRD + TICKET MAINTAINER GATES REQUIRED**
- Epic: D0
- Milestone: S0 · Name & Contracts
- Owning PRD: [D0](../../prd/PRD-D0-name-migration-and-repository-skeleton.md)
- Size: M
- Dependencies: D0-002

## Goal

Replace the structural planning validator with semantic planning validator v2. It must prove the required authority, traceability, gate, identity, issue-map, and product-code contracts instead of reporting an unverified scaffold claim.

## Exact ownership

- `scripts/validate-planning.mjs`; every portion of `tests/planning-contract.test.mjs` except the numeric `control_plane_code_files` literal in `acceptedValidatorOutput` and `pendingValidatorOutput`, which D0-001 owns solely for its completed `4` to `6` adjustment caused by `scripts/validate-identity.mjs` and `tests/planning/identity.test.mjs`, the temporary D0-002 post-primary-RED staged-file insertion of `tests/planning/workspace-skeleton.test.mjs` into `scripts/validate-planning.mjs` `controlPlaneAllowlist` and its four expected `6` to `7` `acceptedValidatorOutput` and `pendingValidatorOutput` planning-census literals, the isolated fixture setup/teardown and canonical-validator preservation regression for the existing D0 identity allowlist test, the `gates=<status>` portion, which Gate Administration owns for lifecycle truth, and the compatibility migration's exact delegation test case/plumbing; `docs/TRACEABILITY.md`; historical v1 boundary only: `docs/decisions/maintainer-gate-registry.v1.json` is not an active control-plane ownership grant and must not be restored.
- No other file or symbol may be edited without a replacement ticket and renewed gate.

## Preconditions

1. Required ADRs and owning PRD are explicitly accepted at their exact digests.
2. This exact ticket is explicitly accepted and an execution packet pins the base SHA.
3. D0-002 is complete and D0-003 is verified superseded by PR #53.
4. Worktree is clean or unrelated owner changes are identified and protected.

## Forbidden scope

- Marking any gate accepted; product source; GitHub mutation; self-approval; permissive fallback on malformed traceability, registry, digest, or source census.

## RED contract

- Test file: `tests/planning-contract.test.mjs`
- Focused command: `npm test -- tests/planning-contract.test.mjs`
- Expected pre-GREEN failure: a fixture that removes a PRD requirement/AC edge, ticket AC/test-case edge, gate digest, issue-map record, identity value, or product-code allowlist entry is currently not rejected by the structural validator.
- Capture each named mutant and its unexpected PASS before editing the validator. If a mutant already fails for an unrelated reason, stop and correct the mutant rather than claiming RED.

## Minimum GREEN

- validate the graph `SSOT → owning ADR/PRD → PRD requirement → PRD AC → ticket → ticket AC → test file → named test case`, with orphan count zero and exact owning ADR/PRD links.
- validate issue-map and `docs/issues.json` agreement, dependency DAG, current gate-registry schema/data, exact digest bindings, and digest invalidation after a material edit.
- compute the actual product-code census from an explicit control-plane allowlist; emit the paths and count, never a fixed `product_code=0` literal.
- validate canonical identity consistency across the registry, root manifest, README, and active planning surfaces; reject legacy/path exceptions and unresolved/malformed inputs fail closed.
- use `fileURLToPath()` for repository paths and preserve encoded/space-containing paths with a focused regression.

## Acceptance ↔ tests

- AC-D0-004-1 ↔ `tests/planning-contract.test.mjs` case `semantic-traceability-graph`.
- AC-D0-004-2 ↔ `tests/planning-contract.test.mjs` case `orphan-requirement-ac-ticket-test-mutants`.
- AC-D0-004-3 ↔ `tests/planning-contract.test.mjs` case `issue-map-and-manifest-agreement`.
- AC-D0-004-4 ↔ `tests/planning-contract.test.mjs` case `maintainer-gate-digest-invalidation`.
- AC-D0-004-5 ↔ `tests/planning-contract.test.mjs` case `computed-product-code-census`.
- AC-D0-004-6 ↔ `tests/planning-contract.test.mjs` case `identity-consistency-and-no-exception`.
- AC-D0-004-7 ↔ `tests/planning-contract.test.mjs` case `encoded-path-root-resolution`.

## Verification

1. Focused: `npm test -- tests/planning-contract.test.mjs`; each semantic mutant fails for its expected reason and canonical corpus passes.
2. Full: `npm test`; zero failure and no unregistered skip.
3. Build/package: `npm run build`; emitted census/digests match disk.
4. Manual/live: `LIVE_NA`.
5. Ownership: inspect `git diff --name-only <base>...<head>` and reject every unowned path.

## Stop and escalation

- Stop on ambiguous authority, missing ownership, malformed gate registry, stale digest, wrong target, unallowlisted product code, unsafe path handling, timeout without a terminal state, or partial state.

## Completion evidence

- Exact base/head SHA, mutant RED receipts, canonical focused/full/build receipts, computed census, gate-registry/digest report, and exact-head review/CI evidence.

## Invalidation

Any change to the SSOT, ADR/PRD/ticket graph, gate registry, identity source, control-plane allowlist, runtime identity, or candidate head invalidates affected semantic evidence and returns this lane to RED.
