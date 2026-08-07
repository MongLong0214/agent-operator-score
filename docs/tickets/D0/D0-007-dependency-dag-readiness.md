# D0-007 · Dependency-DAG readiness and deterministic merge order

- Status: **BLOCKED — ADR + PRD + TICKET MAINTAINER GATES REQUIRED**
- Epic: D0
- Milestone: S0 · Name & Contracts
- Owning PRD: [D0G](../../prd/PRD-D0G-governance-simplification.md)
- Size: L
- Dependencies: D0-006

## Goal

Make the dependency DAG executable and enforce lane readiness before any implementation lane may start. The normalized ticket catalog's `dependencies` field becomes the sole canonical dependency source; the roadmap's ordering, and ADR-0009's reference projection, are non-authoritative projections of it. Once this ticket is verified, the remaining backlog opens in parallel on the DAG instead of one ticket at a time — this ticket is the throughput gate the binding CEO decision requires, not a scheduling convenience.

## Exact ownership

- `scripts/resolve-lane-readiness.mjs` — the normalized-catalog generator, the `READY` predicate, the deterministic topological merge-order function, and the cycle detector.
- `tests/planning/lane-readiness.test.mjs` — the complete D0-007 test module.
- `docs/tickets/dependency-catalog.json` — the generated, machine-readable normalized ticket catalog (`id`, `path`, `dependencies`, `owned_paths`, `owned_symbols` per ticket), produced from the existing per-ticket `- Dependencies:` and `## Exact ownership` headers under `docs/tickets/**/*.md`. This file is a derived artifact regenerated from ticket headers, never hand-edited, and never a second source of dependency authority.
- **Sequential coordinated overlap with D0-004.** This ticket does not compute `NONE` against D0-004: it declares an explicit, bounded, sequential overlap on exactly two D0-004-owned files, permitted only because D0-004 is post-merge verified before this lane opens. The overlap is limited to these literals and no others:
  - `scripts/validate-planning.mjs` — symbol `controlPlaneAllowlist` only: add exactly the two entries `scripts/resolve-lane-readiness.mjs` and `tests/planning/lane-readiness.test.mjs`. No other symbol, statement, or line in this file.
  - `tests/planning-contract.test.mjs` — symbols `acceptedValidatorOutput` and `pendingValidatorOutput` only: in **both** literals, increment **both** `control_plane_code_files` and `control_plane_allowlist` by exactly 2, from `9` to `11` at this ticket's base SHA. Registering two allowlisted control-plane files moves both counters, not just the file count; updating only one leaves the census inconsistent and the canonical checks RED. No other symbol or assertion in this file.
  - Mirrors the D0-001 precedent for the same file pair. Requires D0-004 post-merge verification as a precondition, and same-PR sign-off against this ticket's exact head from the maintainer holding D0-004 gate authority. Absent that sign-off, stop.
- Except the exact literals enumerated immediately above, no other file or symbol may be edited without a replacement ticket and renewed gate. In particular this ticket does not touch `.github/workflows/ci.yml` or `scripts/resolve-execution-state.mjs` (D0-005-owned), the gate-registry unification, execution-packet definition, or Gate Administration event/invalidation fields (D0-006-owned), or any other portion of `scripts/validate-planning.mjs` or `tests/planning-contract.test.mjs`.

## Preconditions

1. ADR-0009 and ADR-0012, and the owning PRD (PRD-D0G), are explicitly accepted at their exact digests.
2. This exact ticket is explicitly accepted and an execution packet pins the base SHA.
3. D0-006 is verified complete on the target branch; active or partial work does not count.
4. PR #150 has resolved its own CI and ticket gates and completed merge and post-merge verification; no governance change from PRD-D0G, including this ticket, reaches `dev` before that.
5. Worktree is clean or unrelated owner changes are identified and protected.

## Forbidden scope

- Relaxing any existing fail-closed behaviour, including `scripts/validate-planning.mjs`'s existing dependency-cycle error and ADR-0012's exact-head evidence requirements.
- Opening any parallel lane on the DAG before this ticket's own readiness/DAG resolver is itself verified GREEN and merged.
- Changing PR #150's head, branch, or worktree in any way.
- Treating `docs/planning/AOS-EXECUTION-ROADMAP.md` or ADR-0009's reference projection as an ordering authority; both remain read-only projections of the catalog this ticket generates.
- Updating the hardcoded ADR/PRD/ticket census literals in `scripts/validate-planning.mjs` (`adrFiles.length !== 12`, `prdFiles.length !== 19`, `ticketFiles.length !== 65`), or registering this ticket in `docs/tickets/BOARD.md`, `docs/GITHUB-ISSUE-MAP.md`, or `docs/issues.json`; that registration is Gate Administration's acceptance-time responsibility, not this ticket's implementation scope.
- Product source; package publish; GitHub mutation; self-approval; permissive fallback on an unparseable ownership clause, a missing worktree descriptor, or a malformed catalog entry.
- No edits to another ticket's owned files, no dependency upgrade unless owned here, and no public claim.

## RED contract

- Test file: `tests/planning/lane-readiness.test.mjs`
- Focused command: `npm test -- tests/planning/lane-readiness.test.mjs`
- Expected pre-GREEN failure: after first adding the named test module, case `dependency-cycle-fails-closed` fails with `ERR_MODULE_NOT_FOUND` identifying `scripts/resolve-lane-readiness.mjs` before any catalog, readiness, or ordering logic can run.
- Capture the exact failing test name and message before editing `scripts/resolve-lane-readiness.mjs`, `docs/tickets/dependency-catalog.json`, or the coordinated D0-004-owned literals. If the failure differs, stop; the ticket precondition is stale or wrong.
- Until the coordinated allowlist/literal amendment lands in the same PR, `npm test` (full) and `npm run docs:check` separately fail with an unallowlisted-product-code reason naming the two new files; this is an expected, coordinated companion failure, not a broadening of RED scope, and must not be worked around by omitting the allowlist entries.

## Minimum GREEN

- Generate `docs/tickets/dependency-catalog.json` from the existing per-ticket `- Dependencies:` and `## Exact ownership` headers. Each entry carries `id`, `path`, `dependencies` (exact match to the ticket's own declared field), `owned_paths` (backtick-quoted path literals extracted from the ownership section), and `owned_symbols` (backtick-quoted identifier literals declared alongside an owned path; a path literal with no adjacent symbol literal owns the whole file for overlap purposes). A ticket header that cannot be reduced to explicit literals fails closed: emit a named parse error for that ticket and block readiness for every lane that would depend on or overlap it — never a silent guess, never a partial parse treated as complete.
- Implement a `READY` predicate over the catalog and a caller-supplied candidate (ticket id, worktree descriptor, current active-lane set) requiring all four, none optional and none substitutable: (a) every declared dependency for the candidate is present in a caller-supplied verified-complete set — active or partial work never counts; (b) the candidate's `owned_paths` and `owned_symbols` are pairwise disjoint from every other currently active lane's `owned_paths`/`owned_symbols`; (c) no active lane declares an overlapping claim on a shared manifest, lockfile, or control-plane surface (`package.json`, `package-lock.json`, `scripts/validate-planning.mjs`'s `controlPlaneAllowlist`, the gate registry); (d) the candidate's worktree descriptor names a linked worktree per `git worktree list --porcelain`, is not the primary worktree, and its recorded base matches the execution packet's pinned exact base SHA bit-for-bit.
- Implement a deterministic topological merge-order function over the set of currently READY lanes: order by dependency edges, and when two or more candidates have no ordering edge between them, break the tie by ascending lexicographic ticket id — never iteration/insertion order, never a random or time-based tiebreak. The same READY set produces the identical order on every repeated invocation.
- Detect a dependency cycle before computing any order: on cycle, fail closed with a named `DEPENDENCY_CYCLE` error identifying every ticket id on the cycle; never deadlock, never silently drop an edge, never fall back to insertion order.
- Land the coordinated D0-004-owned amendment in the same PR with the required sign-off: the two `controlPlaneAllowlist` entries, and **both** `control_plane_code_files` and `control_plane_allowlist` moved `9` → `11` in **both** `acceptedValidatorOutput` and `pendingValidatorOutput`. Four literal updates in total across the two symbols; updating only the file count leaves the census inconsistent. Absent the sign-off, stop rather than land without the allowlist entries.
- Change only the owned symbols and files above.

## Acceptance ↔ tests

- AC-D0-007-1 ↔ `tests/planning/lane-readiness.test.mjs` case `dependency-not-verified-blocks-readiness`: a candidate with an active-only or partial dependency is rejected as not READY.
- AC-D0-007-2 ↔ `tests/planning/lane-readiness.test.mjs` case `overlapping-owned-paths-blocks-readiness`: two concurrently active lanes sharing an owned path are both rejected.
- AC-D0-007-3 ↔ `tests/planning/lane-readiness.test.mjs` case `overlapping-owned-symbols-blocks-readiness`: two concurrently active lanes sharing an owned symbol within a distinct owned path are both rejected.
- AC-D0-007-4 ↔ `tests/planning/lane-readiness.test.mjs` case `shared-manifest-lockfile-conflict-blocks-readiness`: two lanes both claiming `package.json`, the lockfile, or a control-plane surface are rejected.
- AC-D0-007-5 ↔ `tests/planning/lane-readiness.test.mjs` case `non-isolated-or-wrong-base-worktree-blocks-readiness`: a candidate on the primary worktree, an unlisted worktree, or a worktree whose base does not match the pinned exact base SHA is rejected.
- AC-D0-007-6 ↔ `tests/planning/lane-readiness.test.mjs` case `deterministic-topological-order-across-repeated-runs`: the same READY set produces byte-identical order across repeated invocations, including a tie broken by ascending lexicographic ticket id.
- AC-D0-007-7 ↔ `tests/planning/lane-readiness.test.mjs` case `dependency-cycle-fails-closed`: a fixture with a dependency cycle yields the named `DEPENDENCY_CYCLE` error identifying every ticket on the cycle, never a deadlock or a silently picked order.
- AC-D0-007-8 ↔ `tests/planning/lane-readiness.test.mjs` case `roadmap-order-mutation-does-not-change-resolver-order`: mutating the roadmap document or ADR-0009's reference projection without mutating any ticket's `- Dependencies:` field produces no change in the resolver's emitted order.

## Verification

1. Focused: `npm test -- tests/planning/lane-readiness.test.mjs`; every named case above passes.
2. Full: `npm test`; zero failure and no unregistered skip.
3. Build/package: `npm run build`; `docs/tickets/dependency-catalog.json` regenerates byte-identical across two consecutive runs against the same head.
4. Manual/live: `LIVE_NA`.
5. Ownership: inspect `git diff --name-only <base>...<head>` and reject every path that is neither owned nor part of the declared coordinated overlap; then diff `scripts/validate-planning.mjs` and confirm the only change is the two `controlPlaneAllowlist` entries, and diff `tests/planning-contract.test.mjs` and confirm the only changes are `control_plane_code_files` and `control_plane_allowlist` moving `9` → `11` in both `acceptedValidatorOutput` and `pendingValidatorOutput`. Confirm the D0-004 sign-off is recorded against this exact head.

## Stop and escalation

- Stop on ambiguity, wrong target, any ownership overlap other than the declared sequential coordinated overlap on the two D0-004 literals above, an unparseable ticket ownership clause, D0-004 not post-merge verified, missing D0-004 sign-off against this exact head, a census update touching only one of the two counters, missing required observability, unsafe permission, secret exposure, silent fallback, timeout without a registered terminal state, partial state, nondeterminism in the emitted order, or evidence not tied to exact head.
- Stop and escalate if satisfying disjoint-ownership detection would require inferring an owned path or symbol the ticket text does not state as an explicit literal; do not broaden this ticket into a prose-ownership parser.
- A dependency or contract defect is escalated to its owning ADR/PRD/ticket; do not broaden this ticket.

## Completion evidence

- Exact base/head SHA and diff manifest, including the coordinated `scripts/validate-planning.mjs`/`tests/planning-contract.test.mjs` amendment lines and the D0-004 sign-off record.
- RED receipt with the expected missing-resolver reason; GREEN focused/full/build receipts.
- Acceptance-to-test result table for AC-D0-007-1 through AC-D0-007-8; the emitted `docs/tickets/dependency-catalog.json` digest; two consecutive deterministic-order receipts over the same READY set; and `LIVE_NA` rationale.
- Security/privacy/fail-closed/wrong-target/timeout/partial-state review and stale-evidence invalidation statement.
- Exact-head cumulative reviewer verdict and CI receipt before merge eligibility.

## Invalidation

Any change to this ticket, its ADR/PRD dependencies, any ticket's `- Dependencies:` or `## Exact ownership` header under `docs/tickets/`, `scripts/resolve-lane-readiness.mjs`, `tests/planning/lane-readiness.test.mjs`, `docs/tickets/dependency-catalog.json`, the package lock, runtime identity, or candidate head invalidates the affected RED/GREEN, focused, full, build, review, and CI evidence and returns the lane to the earliest changed gate.
