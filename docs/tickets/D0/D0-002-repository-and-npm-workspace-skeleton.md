# D0-002 · Repository and npm-workspace skeleton

- Status: **BLOCKED — ADR + PRD + TICKET MAINTAINER GATES REQUIRED**
- Epic: D0
- Milestone: S0 · Name & Contracts
- Owning PRD: [D0](../../prd/PRD-D0-name-migration-and-repository-skeleton.md)
- Size: M
- Dependencies: D0-001

## Goal

Create the real zero-product-code npm workspace skeleton required by SSOT §9.4. Deliver only manifests, deterministic lockfile changes, ownership markers, minimum-name-clearance evidence, and deterministic planning tests; do not infer a CLI, package behavior, or publication authorization.

## Exact ownership

- `package.json` except `scripts.test`, which remains D0-001-owned and byte-for-byte unchanged; only the deterministic `package-lock.json` subset for the root plus the exact six declared workspaces and their generated link records, as produced by the execution-packet-pinned npm; no dependency edge or unrelated record; `packages/{schema,scorer,runner,reporter}/package.json`; `adapters/{codex,claude-code}/package.json`; `packages/{schema,scorer,runner,reporter}/OWNERS.md`; `adapters/{codex,claude-code}/OWNERS.md`; `suites/coding-core-v0/OWNERS.md`; `fixtures/OWNERS.md`; `conformance/OWNERS.md`; `docs/clearance/MINIMUM-NAME-CLEARANCE.md`; `tests/planning/workspace-skeleton.test.mjs`.
- Narrow D0-004 carve-out only, and only after the required RED receipt: in `scripts/validate-planning.mjs`, insert only `tests/planning/workspace-skeleton.test.mjs` into `controlPlaneAllowlist`; in `tests/planning-contract.test.mjs`, change only the `control_plane_code_files` and `control_plane_allowlist` literals in both `acceptedValidatorOutput` and `pendingValidatorOutput`, each from `6` to `7`. No other symbol, fixture, setup/teardown, assertion, or file is granted by this carve-out.
- No other file or symbol may be edited without a replacement ticket and renewed gate.

## Preconditions

1. ADR-0001, ADR-0003, ADR-0012, the owning PRD, and this exact ticket are explicitly accepted at their exact digests.
2. D0-001 is verified complete on the target branch with a post-merge receipt; active, partial, merged-without-post-CI, or stale-head work does not count.
3. The execution packet pins a freshly fetched `origin/dev` SHA, branch, clean isolated worktree, Node/npm identity, permission profile, and every owned path and symbol above.
4. No open PR, active branch, or worktree owns a path or symbol in **Exact ownership**. Any overlap is a hard stop.

## Forbidden scope

- feature implementation; package entrypoints; runnable `bin`; dependencies; npm publication; build artifacts; public claim
- root script changes, including `scripts.test`; product source; manifests outside the named six workspaces; lockfile dependency edges; and any D0-004 validator/test change outside the narrow carve-out
- fabricated search, result, clearance, legal, license, contribution, redistribution, or publication claim
- No fallback that weakens evidence, identity, safety, privacy, ownership, or terminal-state semantics.

## RED contract

1. From the execution-packet base, add only `tests/planning/workspace-skeleton.test.mjs` before every GREEN-owned edit. At this stage it contains only case `workspace-census`, whose primary assertion message is exactly `missing required workspace manifest: packages/schema/package.json`.
2. Run the canonical focused command: `npm test -- tests/planning/workspace-skeleton.test.mjs`. It must use normal test discovery; do not run a reduced suite or exclude the planning-contract tests.
3. Capture the primary failure, `workspace-census`, with that exact missing-path message. The only permitted companions are deterministic planning-contract consequences of the staged file: the planner's unallowlisted `tests/planning/workspace-skeleton.test.mjs` report, followed after the one allowlist insertion by only the dependent `acceptedValidatorOutput` and `pendingValidatorOutput` `control_plane_code_files` and `control_plane_allowlist` `6`-to-`7` census mismatches. They are required staging companions, never alternate RED evidence.
4. Capture the exact command, exit code, failing test names, and messages before editing manifests, markers, clearance evidence, the lockfile, or D0-004-carve-out symbols. Any failure outside the primary missing-manifest signal and these deterministic planner allowlist/census companions stops execution.

Expected pre-GREEN failure: `workspace-census` reports `missing required workspace manifest: packages/schema/package.json`.

## Minimum GREEN

- Change root `package.json` `name` exactly to `agent-operator-score`; retain `private: true`, engines `>=20 <25`, and every root script exactly as at the execution base. Add only the ordered workspace paths `packages/schema`, `packages/scorer`, `packages/runner`, `packages/reporter`, `adapters/codex`, and `adapters/claude-code`. The root is the sole future publish candidate and remains non-publishable until E14/G4.
- Regenerate only the owned deterministic `package-lock.json` subset with the packet-pinned npm version. It remains lockfile v3 and contains the root record, the exact six workspace package records, and their exact six generated link records: `packages/schema` / `node_modules/@aos/schema`; `packages/scorer` / `node_modules/@aos/scorer`; `packages/runner` / `node_modules/@aos/runner`; `packages/reporter` / `node_modules/@aos/reporter`; `adapters/codex` / `node_modules/@aos/adapter-codex`; and `adapters/claude-code` / `node_modules/@aos/adapter-claude-code`. The root record carries the matching root name; each workspace record carries its exact declared `@aos/*` name; each generated link points only to its matching workspace. No dependency edge or record outside this deterministic subset may change.
- Create only these six internal manifests, each with `version: "0.0.0"`, `private: true`, no executable entrypoint, no dependencies, no scripts, and no product source: `packages/schema/package.json` as `@aos/schema`; `packages/scorer/package.json` as `@aos/scorer`; `packages/runner/package.json` as `@aos/runner`; `packages/reporter/package.json` as `@aos/reporter`; `adapters/codex/package.json` as `@aos/adapter-codex`; and `adapters/claude-code/package.json` as `@aos/adapter-claude-code`.
- Add each of the nine owned markers with exactly one ticket owner `D0-002` and one PRD owner `PRD-D0-name-migration-and-repository-skeleton`; a missing, duplicate, or additional owner is invalid.
- Reserve `aos` only as documentation for a future CLI; do not create a runnable command, bin, entrypoint, or invocation surface.
- In `docs/clearance/MINIMUM-NAME-CLEARANCE.md`, create one record each for GitHub, npm, domain, and basic trademark. Every record has exactly these fields: `source`, `query`, `searched_at`, `result`, `limits`, and `status`. `status` is one of `CLEAR`, `UNRESOLVED`, or `CONFLICT`; every non-`CLEAR` status blocks canonical-name adoption and D0 exit. The evidence and its limits are factual records, not legal, license, contribution, redistribution, or publication clearance. Do not fabricate a source, query, date, result, or status.
- After the RED receipt, make only the narrow D0-004 carve-out changes declared in **Exact ownership**; both planner census fields and both allowlist fields change from `6` to `7`, and nothing else in those files changes.
- Change only the owned paths and symbols above.

## Acceptance ↔ tests

- AC-D0-002-1 ↔ `tests/planning/workspace-skeleton.test.mjs` case `workspace-census`: exact root/internal workspace paths and names exist; the staged RED observes the primary missing `packages/schema/package.json` path.
- AC-D0-002-2 ↔ `tests/planning/workspace-skeleton.test.mjs` case `internal-workspaces-private`: every exact internal package is `private: true`; only root is the future publish candidate.
- AC-D0-002-3 ↔ `tests/planning/workspace-skeleton.test.mjs` case `one-owner-per-path`: each of the nine exact marker paths has exactly the one ticket/one PRD owner pair.
- AC-D0-002-4 ↔ `tests/planning/workspace-skeleton.test.mjs` case `product-code-zero`: manifest/source census rejects product code, a dependency, runnable bin, entrypoint, or script.
- AC-D0-002-5 ↔ `tests/planning/workspace-skeleton.test.mjs` case `engine-matrix`: root engines remain `>=20 <25` and CI declares Node 20/22/24.
- AC-D0-002-6 ↔ `tests/planning/workspace-skeleton.test.mjs` case `minimum-name-clearance`: each named record contains exactly `source`, `query`, `searched_at`, `result`, `limits`, and `status`; every non-`CLEAR` status blocks canonical-name adoption without asserting formal legal, LICENSE, contribution, redistribution, or publication clearance.
- AC-D0-002-7 ↔ `tests/planning/workspace-skeleton.test.mjs` case `workspace-lock-consistency`: the root manifest and lockfile root record are both named `agent-operator-score`; lockfile v3 contains exactly the six declared workspace records with their exact `@aos/*` names and the six generated links to those matching workspaces; the test rejects an extra or stale record, name, or link and every dependency edge; and `npm ci` accepts the committed lock.

## Verification

1. RED: run the canonical command in **RED contract** before GREEN; retain the primary and only permitted companion failures as that candidate's RED receipt.
2. Install/lock: `npm ci` succeeds with the workspace lock consistent with the root manifest.
3. Focused: `npm test -- tests/planning/workspace-skeleton.test.mjs`; every named case above passes.
4. Full: `npm test`; zero failure, skip only when preregistered by this ticket.
5. Build/package: `npm run build`; zero warning promoted by policy and deterministic artifact manifest where applicable.
6. Manual/live: `LIVE_NA`; this ticket owns no runtime, scenario, network, or production target.
7. Ownership: `git diff --check <base>...<head>` passes and `git diff --name-only <base>...<head>` lists only owned paths/symbols, including exactly the narrow D0-004 carve-out where applicable.

## Stop and escalation

- Stop on a wrong target, extra workspace, missing or duplicate owner, stale lockfile, runnable surface, dependency, product source, partial directory state, unowned path, ownership overlap, ambiguous or fabricated clearance, missing required observability, unsafe permission, secret exposure, silent fallback, timeout without a registered terminal state, partial state, nondeterminism, or evidence not tied to exact head.
- A dependency or contract defect is escalated to its owning ADR/PRD/ticket; do not broaden this ticket.

## Completion evidence

- Exact base/head SHA and diff manifest.
- RED receipt with expected reason; GREEN focused/full/build receipts.
- Acceptance-to-test result table, artifact/schema/scorer digests where produced, and manual/LIVE_NA rationale.
- Security/privacy/fail-closed/wrong-target/timeout/partial-state review and stale-evidence invalidation statement.
- Exact-head cumulative reviewer verdict and CI receipt before merge eligibility.

## Invalidation

Any change to this ticket, its PRD/ADR dependencies, owned sources, test oracle, fixture manifest, package lock, runtime identity, or candidate head invalidates the affected evidence and returns the lane to the earliest changed gate.
