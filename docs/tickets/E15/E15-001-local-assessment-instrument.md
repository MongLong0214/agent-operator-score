# E15-001 · Carry the self-contained local assessment instrument

- Status: **BLOCKED — ADR + PRD + TICKET MAINTAINER GATES REQUIRED**
- Epic: E15
- Milestone: S5 · Public OSS
- Owning PRD: [E15](../../prd/PRD-E15-local-assessment-instrument.md)
- Size: L
- Dependencies: None

## Goal

Carry the self-contained local assessment instrument. Deliver only the bounded contract below; do not infer adjacent scope.

## Exact ownership

- bin/aos.mjs — main; lib/cli.mjs — assess,report,session,agent,surface,verify
- lib/core.mjs — VERSION,runProcess,canonicalJson,sha256Value; lib/index.mjs — public re-exports
- lib/operator-plan.mjs — validateOperatorPlan,gradeOperatorPlan,operatorPlanTemplate; lib/report.mjs — renderMarkdown,renderHtml
- lib/scorer.mjs — scoreMetrics,perfectMetricInput; lib/store.mjs — createRun,appendEvent,writeTerminal
- lib/suite.mjs — FAMILIES,prepareScenario,gradeScenario,promptFor,suiteDigest
- tests/product/helpers.mjs — run,addAgent,makePlan; tests/product/fake-agent.mjs — controlled stand-in agent
- tests/product/cli.test.mjs — end-to-end command cases; tests/product/core.test.mjs — process and event cases
- tests/product/store.test.mjs — run store and terminal cases; tests/product/suite-grading.test.mjs — family grading cases
- tests/product/scorer-vectors.test.mjs — published vector agreement cases
- Registration carve-out, on the precedent the D0-004B and D0-004C carve-outs set: `scripts/validate-planning.mjs`: only the `prdFiles` and `ticketFiles` expected-count literals, the atomic-ticket README-census literal, and the README status-line and published-CLI pins; `tests/planning-contract.test.mjs`: only `acceptedValidatorOutput`, `pendingValidatorOutput`, the atomic-ticket README assertion, the manifest-length and unique-ID assertions, and the README status-line assertions; `README.md`: only the status line, the atomic implementation-ticket census line, the grader and not-built rows, the instrument usage section, and the published-CLI section heading; `docs/issues.json`: only the E15-001 static catalog record and the `epic:E15` label definition; `docs/GITHUB-ISSUE-MAP.md`: only the E15-001 mapping row; `docs/TRACEABILITY.md`: only the E15 PRD catalog entry, its planned-test entries, and the E15-001 acceptance bindings; `docs/tickets/BOARD.md`: only the generated E15-001 row; `docs/prd/INDEX.md`: only the E15 row; `package.json`: only the `description` field; `.gitignore`: only the agent-tooling ignore entry
- No other file or symbol may be edited without a replacement ticket and renewed gate.

## Ownership reconciliation

Registering an atomic ticket necessarily moves the census literals and static-catalog rows that D0-004 and D0-012 own, because those values are derived from the ticket set and a new ticket changes them by existing. The carve-out above is the narrowest set of fragments that admits this ticket, and it follows the precedent D0-004 set for itself in D0-004B and D0-004C: a pinned literal that a ticket's own declared deliverable makes stale is a consequence of that deliverable, not new scope.

The overlapping owners are D0-004 and D0-012 for the validator, the contract test and the static catalog; E14-002 for `README.md` and D0-013 for its atomic-ticket census line; and D0-002 and D0-004 for `package.json`, whose `scripts` block and workspace fields are untouched here. Each is named so the transfer is visible rather than silent.

It transfers nothing else. D0-004 keeps `scripts/validate-planning.mjs` and every other portion of `tests/planning-contract.test.mjs`, including the `control_plane_*` literals and the `gates=<status>` portion, which Gate Administration owns. D0-012 keeps its own `ticketFiles` adjustment, its issue-206 registration fragments, and the whole-census equality assertion in `tests/planning/workspace-skeleton.test.mjs`, which this ticket neither edits nor supersedes. E14-002 keeps every other part of `README.md`, and E14-001 keeps `docs/decisions/PUBLICATION-CLEARANCE.md`, which this ticket does not edit. No control-plane allowlist entry is added: this ticket's code is ticket-owned product code, not control plane.

Before RED, each overlapping owner must be confirmed at its exact digest and the transfer limited to the fragments enumerated above, so that active ownership facts stay disjoint.

## Preconditions

1. Required ADRs and owning PRD are explicitly accepted at their exact digests.
2. This exact ticket is explicitly accepted and an execution packet pins the base SHA.
3. Every dependency above is verified complete on the target branch; active/partial work does not count.
4. Worktree is clean or unrelated owner changes are identified and protected.

## Forbidden scope

- root manifest `bin`/`files`/`main`; npm publication; workspace manifest edits; edits to `packages/`, `adapters/`, `suites/`, `specs/`, or `fixtures/`
- No fallback that weakens evidence, identity, safety, privacy, or terminal-state semantics.
- No edits to another ticket's owned files, no dependency upgrade unless owned here, and no public claim.

## RED contract

- Test file: `tests/product/scorer-vectors.test.mjs`
- Focused command: `node --test tests/product/scorer-vectors.test.mjs`
- Expected pre-GREEN failure: the local scorer withholds a measured zero as insufficient evidence and disagrees with the published vector pack.
- Capture the exact failing test name and message before editing production-owned files. If the failure differs, stop; the ticket precondition is stale or wrong.

## Minimum GREEN

- run the six controlled families in isolated workspaces, refuse a vacuous operator plan, issue a measured zero, gate safety on seeded secret escape, and report the manifest version.
- Change only the owned symbols and the minimum supporting types explicitly listed in ownership.

## Acceptance ↔ tests

- AC-E15-001-1 ↔ `tests/product/cli.test.mjs` case `one agent can complete a controlled assessment`.
- AC-E15-001-2 ↔ `tests/product/cli.test.mjs` case `official assessment requires a non-vacuous operator plan`.
- AC-E15-001-3 ↔ `tests/product/scorer-vectors.test.mjs` case `the local scorer matches the published vector pack`.
- AC-E15-001-4 ↔ `tests/product/scorer-vectors.test.mjs` case `a measured zero is issued as zero, not withheld as missing evidence`.
- AC-E15-001-5 ↔ `tests/product/suite-grading.test.mjs` case `naming the rejected credential path is safe, copying the key is not`.
- AC-E15-001-6 ↔ `tests/product/suite-grading.test.mjs` case `sources grade the same whether cited by path or by file name`.
- AC-E15-001-7 ↔ `tests/product/cli.test.mjs` case `self verification and package version`.

## Verification

1. Focused: `node --test tests/product/scorer-vectors.test.mjs`; every named case above passes.
2. Full: `npm test`; zero failure, skip only when preregistered by this ticket.
3. Build/package: `npm run build`; zero warning promoted by policy and deterministic artifact manifest where applicable.
4. Manual/live: run `node bin/aos.mjs assess --plan <plan>` against registered local agent commands and preserve the run directory as the controlled protocol record.
5. Ownership: inspect `git diff --name-only <base>...<head>` and reject every unowned path.

## Stop and escalation

- Stop on ambiguity, wrong target, ownership overlap, missing required observability, unsafe permission, secret exposure, silent fallback, timeout without a registered terminal state, partial state, nondeterminism, or evidence not tied to exact head.
- A dependency or contract defect is escalated to its owning ADR/PRD/ticket; do not broaden this ticket.

## Completion evidence

- Exact base/head SHA and diff manifest.
- RED receipt with expected reason; GREEN focused/full/build receipts.
- Acceptance-to-test result table, artifact/schema/scorer digests where produced, and manual/LIVE_NA rationale.
- Security/privacy/fail-closed/wrong-target/timeout/partial-state review and stale-evidence invalidation statement.
- Exact-head cumulative reviewer verdict and CI receipt before merge eligibility.

## Invalidation

Any change to this ticket, its PRD/ADR dependencies, owned sources, test oracle, fixture manifest, package lock, runtime identity, or candidate head invalidates the affected evidence and returns the lane to the earliest changed gate.
