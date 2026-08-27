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
- No other file or symbol may be edited without a replacement ticket and renewed gate.

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
