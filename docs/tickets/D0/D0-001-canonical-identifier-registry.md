# D0-001 · Canonical identifier registry

- Status: **BLOCKED — ADR + PRD + TICKET CEO GATES REQUIRED**
- Epic: D0
- Milestone: S0 · Name & Contracts
- Owning PRD: [D0](../../prd/PRD-D0-name-migration-and-repository-skeleton.md)
- Size: S
- Dependencies: None

## Goal

Create the single, versioned identity registry and fail-closed active-tree validator that future D0 work must use. Deliver only the bounded contract below; do not infer adjacent scope.

## Exact ownership

- `specs/identity.v1.json` — the complete version-1 registry document.
- `scripts/validate-identity.mjs` — the exported `validateIdentity` function and its direct CLI entry point only.
- `tests/planning/identity.test.mjs` — the complete D0-001 test module.
- `package.json` — the `scripts.test` value only; it must be `node --test` so plain `npm test` discovers this ticket's test and future Node test modules, while `npm test -- tests/planning/identity.test.mjs` remains focused.
- No other file or symbol may be edited without a replacement ticket and renewed gate. In particular, D0-002 retains all `package.json` ownership other than `scripts.test`.

## Preconditions

1. ADR-0001, ADR-0003, ADR-0012, and the owning PRD are explicitly accepted at their exact digests.
2. This exact ticket is explicitly accepted and an execution packet pins the base SHA.
3. Every dependency above is verified complete on the target branch; active/partial work does not count.
4. Worktree is clean or unrelated owner changes are identified and protected.
5. The owner-authorized removal of live historical planning material remains in force: Git history is the sole recovery boundary and the active tree has no legacy-root or legacy-allowlist exception.

## Forbidden scope

- Package publish; product behavior; workspace/package-manifest changes other than `package.json` `scripts.test`; edits to the planning validator owned by D0-004.
- Any legacy root, allowed-legacy-root, allowlist, path exception, environment override, alternate registry, default-target fallback, or silent success after an invalid target/registry.
- No fallback that weakens evidence, identity, safety, privacy, or terminal-state semantics.
- No edits to another ticket's owned files, no dependency upgrade unless owned here, and no public claim.

## RED contract

- Test file: `tests/planning/identity.test.mjs`
- Focused command: `npm test -- tests/planning/identity.test.mjs`
- Expected pre-GREEN failure: after first adding the named test module, the command fails because `scripts/validate-identity.mjs` and `specs/identity.v1.json` do not exist; the receipt must identify the missing validator/registry path. It must not use the obsolete claim that historical identifiers currently pass.
- Capture the exact failing test name and message before editing `specs/identity.v1.json`, `scripts/validate-identity.mjs`, or `package.json`. If the failure is not missing registry/validator behavior, stop; the ticket precondition is stale or wrong.

## Minimum GREEN

- Add `specs/identity.v1.json` with `version: 1` and these exact canonical values from SSOT §0.6: product name `Agent Operator Score`; abbreviation `AOS`; instrument `AOS-Coding`; provisional score `AOS-Coding P0`; package `agent-operator-score`; CLI `aos`; state root `.aos/`; trace schema `aos-trace`; result schema `aos-result`.
- The registry's forbidden corpus is exactly six historical identifiers represented as source-safe ordered `parts` arrays, never as a literal active-tree identifier: `["Agent", "Ops Score"]`, `["agent", "ops-score"]`, `["Agent ", "Leverage Index"]`, `["A", "LI"]`, `["a", "li", "-", "bench"]`, and `["AOS", "-", "P0"]`. Each entry declares case-insensitive matching and whether a word boundary is required; rejoining `parts` is permitted only to construct the deny matcher. This representation is a deny corpus, not an exception to active-tree scanning.
- Implement `validateIdentity({ root })` as a deterministic, explicit-root validator. It reads only `<root>/specs/identity.v1.json`, validates the version, canonical fields, and six-entry deny corpus, then scans every active textual file below that exact root, including the registry itself. It may exclude only Git metadata and dependency/install directories; it must not exclude historical paths, legacy tokens, or caller-selected files.
- The CLI requires one explicit `--root <path>` and returns a nonzero, target-specific failure for a missing, non-directory, malformed, or wrong registry target. It must never substitute its own repository root, the current working directory, an ancestor, an environment value, or another registry path.
- Replace only `package.json` `scripts.test` with `node --test`. No dependencies, package name, engines, build script, or other manifest field changes.
- Change only the owned symbols and files above.

## Acceptance ↔ tests

- AC-D0-001-1 ↔ `tests/planning/identity.test.mjs` case `canonical-pass`: the registry has every canonical SSOT §0.6 value and a canonical active tree validates with zero hits.
- AC-D0-001-2 ↔ `tests/planning/identity.test.mjs` case `each-forbidden-token`: iterate all six reconstructed deny entries; a fixture containing each one is rejected and reports that entry's stable identifier.
- AC-D0-001-3 ↔ `tests/planning/identity.test.mjs` case `no-active-tree-exception`: a forbidden token in a generated documentation path is rejected; the registry has no allowlist/root fields and the validator has no historical-path exclusion.
- AC-D0-001-4 ↔ `tests/planning/identity.test.mjs` case `case-word-boundary-variants`: mixed-case forms of every denied identifier are rejected; boundary-required abbreviations reject whole-token forms but do not flag a longer benign word that merely contains the abbreviation.
- AC-D0-001-5 ↔ `tests/planning/identity.test.mjs` case `wrong-target-no-silent-fallback`: missing/non-directory roots and roots without the exact registry produce a nonzero target error; a supplied sibling fixture is validated as that fixture, never as the repository or current directory.
- AC-D0-001-6 ↔ `tests/planning/identity.test.mjs` case `npm-test-discovers-identity`: `package.json` `scripts.test` is exactly `node --test`, and plain `npm test` runs the D0-001 module once.

## Verification

1. RED: run `npm test -- tests/planning/identity.test.mjs` after writing the test and before every GREEN-owned production/supporting edit; capture the named missing-registry/validator failure.
2. Focused: `npm test -- tests/planning/identity.test.mjs`; every named case above passes.
3. Full: `npm test`; zero failure, the identity module runs exactly once, and no skip is introduced.
4. Build/package: `npm run build`; zero warning promoted by policy and deterministic artifact manifest where applicable.
5. Manual/live: `LIVE_NA` — this ticket owns no runtime, scenario, external target, or publication surface.
6. Ownership: inspect `git diff --name-only <base>...<head>` and `git diff -- package.json`; reject every unowned path or any `package.json` change outside `scripts.test`.

## Stop and escalation

- Stop on ambiguity, wrong target, ownership overlap, missing required observability, unsafe permission, secret exposure, silent fallback, timeout without a registered terminal state, partial state, nondeterminism, or evidence not tied to exact head.
- Stop and escalate to D0-003 if satisfying the no-active-tree-exception contract requires restoring, retaining, or exempting historical material. Do not broaden this ticket.
- A dependency or contract defect is escalated to its owning ADR/PRD/ticket; do not broaden this ticket.

## Completion evidence

- Exact base/head SHA and diff manifest.
- RED receipt with the expected missing registry/validator reason; GREEN focused/full/build receipts.
- Acceptance-to-test result table for AC-D0-001-1 through AC-D0-001-6; registry digest; package-script assertion; and `LIVE_NA` rationale.
- Security/privacy/fail-closed/wrong-target/timeout/partial-state review and stale-evidence invalidation statement.
- Exact-head cumulative reviewer verdict and CI receipt before merge eligibility.

## Invalidation

Any change to this ticket, its PRD/ADR dependencies, `specs/identity.v1.json`, `scripts/validate-identity.mjs`, `tests/planning/identity.test.mjs`, `package.json` `scripts.test`, the package lock, runtime identity, or candidate head invalidates the affected RED/GREEN, focused, full, build, review, and CI evidence and returns the lane to the earliest changed gate.
