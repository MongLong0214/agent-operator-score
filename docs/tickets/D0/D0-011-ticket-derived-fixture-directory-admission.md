# D0-011 · Ticket-derived fixture-directory admission

- Status: **BLOCKED — ADR + PRD + TICKET MAINTAINER GATES REQUIRED**
- Epic: D0
- Milestone: S0 · Name & Contracts
- Owning PRD: [D0](../../prd/PRD-D0-name-migration-and-repository-skeleton.md)
- Size: M
- Dependencies: D0-002,D0-004

## Goal

Replace the one-directory exception in the workspace skeleton with ticket-derived fixture-directory admission. A fixture directory is admitted only when the planning catalog identifies its declaring ticket, that ticket declares the fixture glob in its ownership scope, and the declared directory is safe and present on disk. The contract defines observable admission outcomes; the implementation must prove them in executable, mutation-tested behavior. D0-011 will supersede D0-004's narrow `fixtures/operational-state/**` carve-out over the `allowedSkeletonFiles` comparison only after this exact ticket is accepted.

This contract authorizes a later implementation candidate after its gates pass. It does not authorize an implementation edit in this packet.

## Exact ownership

- In `tests/planning/fixture-directory-admission.test.mjs`, and the `allowedSkeletonFiles` integration point at `tests/planning/workspace-skeleton.test.mjs:196`, exactly the existing `operationalStateFiles` declaration and its use in `allowedSkeletonFiles`; the ticket-derived fixture-directory admission behavior exercised by the named cases below; and the `allowedSkeletonFiles` comparison. `ticketOwnedSkeletonPaths`, `expectedWorkspaces`, `ownerPaths`, `expectedScripts`, `expectedScriptsText`, every focused-lane count, and every other symbol remain outside this ticket.
- The D0-011 `planned_tests` entry and D0-011 acceptance bindings in `docs/TRACEABILITY.md` are the sole catalog companions for the eighteen named cases, together with exactly two further catalog edges that the validator's orphan-ticket check requires and that are therefore declared rather than discovered later: `D0-011` is appended to the owning D0 PRD's `ticket_ids` and to `AC-D0-3.ticket_ids`. No other `docs/TRACEABILITY.md` symbol is touched. The D0-011 `dependencies` record in `docs/issues.json` and D0-011 row in `docs/tickets/BOARD.md` mirror only `D0-002,D0-004`.
- On acceptance of this exact ticket, this ownership supersedes D0-004's `fixtures/operational-state/**` grant over the `allowedSkeletonFiles` comparison. Until then, D0-004 remains operative. This is a prospective supersession, not merely a dependency; D0-004 is not edited by this ticket.
- No other file or symbol may be edited without a replacement ticket and renewed gate.

## Admission outcomes

Today's ticket corpus contains backtick-quoted and unquoted declarations. The corpus command below examines only `Exact ownership` sections and outputs the fixture-glob candidates with their source locations:

```sh
for ticketFile in $(rg --files docs/tickets -g '*.md' | sort); do
  awk -v ticketFile="$ticketFile" '
    /^## Exact ownership$/ { inExactOwnership = 1; next }
    /^## / { inExactOwnership = 0 }
    inExactOwnership && /fixtures\/[^` ;]*\*/ { print ticketFile ":" FNR ":" $0 }
  ' "$ticketFile"
done
```

At this exact base, it yields five distinct backtick-quoted declaration paths in D0-004 and D0-006 through D0-009, and eleven unquoted declaration occurrences: E0B-003 has one semicolon-delimited interior occurrence, E0D-003 has one final occurrence, and E2-004 has eight semicolon-delimited occurrences plus one final occurrence repeated in its one ownership bullet. D0-011's own mention of D0-004 is a reference, not a declaration. Both declaration forms and their final and repeated positions are part of the live corpus; the corpus is not rewritten to fit an implementation.

1. The live D0-004 declaration `fixtures/operational-state/**` admits its existing regular fixture files while that declaration remains present.
2. D0-011's reference to D0-004's grant is not a declaration: removing D0-004's declared source in the live-corpus overlay leaves no operational-state admission.
3. The existing E0B-003 declaration `fixtures/doctor/*.json` is admitted when its declared `fixtures/doctor` directory is safely present in the case census.
4. The existing D0-006 declaration `fixtures/governance/effective-state/**` is admitted when its declared directory is safely present in the case census.
5. The existing D0-007 declaration `fixtures/governance/artifact-manifest-v3/**` is admitted when its declared directory is safely present in the case census.
6. The existing D0-008 declaration `fixtures/governance/github-acceptance/**` is admitted when its declared directory is safely present in the case census.
7. The existing D0-009 declaration `fixtures/governance/authenticated-review-activation/**` is admitted when its declared directory is safely present in the case census.
8. A declared directory that is absent from disk contributes no admission.
9. A non-glob declaration, including bare `fixtures/operational-state`, contributes no admission.
10. A declaration containing `.` or `..` as any path segment is rejected before resolution or traversal. `fixtures/../etc/*` normalises to `etc/*` under the repository root rather than escaping it, so the escape is not what this rule turns on; the rule turns on the segment itself, because a multi-segment generalisation that resolves first would read a directory the declaration never legitimately names, and a declaration whose prefix is a symlink can leave the repository entirely. Rejection before resolution is observable, not merely inferred from the result: the case fails if the admission census resolves, reads, or stats any path derived from the rejected declaration.
11. A malformed catalog-listed ticket produces no admission and does not abort the census of other catalog-listed tickets. Its malformed state is explicit and observable rather than silently treated as a valid declaration: the census reports the malformed ticket's path and a stable reason code alongside the admitted set, and the case asserts that report. A bare `catch { continue }` that yields the same admitted set fails this criterion.
12. A fixture directory represented by a symlink that resolves outside the repository is not admitted.
13. The ticket corpus is exactly every file the planning catalog lists as a ticket path, and nothing else. A path that merely resembles a ticket but is absent from that catalog cannot contribute an admission.
14. Admission preserves the declaring file predicate. In particular, `fixtures/doctor/*.json` admits matching regular JSON files only; a non-matching regular file in that directory is refused, while a declaration ending in `**` admits the regular-file subtree.
15. An absolute fixture declaration, including `/tmp/fixtures/doctor/**`, is rejected before resolution or traversal, observed as in criterion 10.
16. A declaration outside `fixtures/`, including `packages/schema/**`, is rejected before resolution or traversal, observed as in criterion 10.
17. An unquoted declaration that is final in its ownership bullet is admitted when its safely materialized directory is present.
18. Repeated unquoted declarations in one ownership bullet are each admitted when their safely materialized directories are present.

## Preconditions

1. ADR-0001, ADR-0003, ADR-0012, the owning D0 PRD, and this exact ticket are explicitly accepted at their exact digests before RED.
2. D0-002 is verified on `dev` with a current post-merge receipt, because it owns the workspace skeleton file at file scope.
3. The execution packet pins a fresh `origin/dev` base SHA, branch, clean worktree, Node/npm identity, permission profile, and every path and symbol in **Exact ownership**.
4. D0-004 is verified on `dev` with a current post-merge receipt, and its narrow `fixtures/operational-state/**` carve-out remains operative until this ticket is accepted. This dependency does not replace the planned supersession: D0-004's grant is superseded only after D0-011's own acceptance. Neither a closed issue, a merged partial change, nor a status label substitutes for either ticket's required evidence.
5. GitHub issue [#182](https://github.com/MongLong0214/agent-operator-score/issues/182) remains the exact binding, with the verified title `D0-011 · Ticket-derived fixture-directory admission`, milestone `S0 · Name & Contracts`, and labels `epic:D0`, `phase:S0`, `size:M`, and `status:gate-required`. Issue identity alone does not establish readiness.
6. No open candidate owns the same `allowedSkeletonFiles` comparison or the new admission behavior. Ownership overlap, unavailable dependency evidence, or a wrong target stops execution.

## Forbidden scope

- Implementing the rule, changing `tests/planning/fixture-directory-admission.test.mjs`, or changing the current operational-state exception in this packet.
- Changing production or test source, with one bounded carve-out that this packet does exercise and therefore states rather than conceals: adding a ticket moves the planning census, so every assertion that pins the census count moves from 70 to 71 together. In `scripts/validate-planning.mjs` those are the ticket-count comparison and the README ticket-census string. In `tests/planning-contract.test.mjs` they are the `tickets=` field of the `acceptedValidatorOutput` and `pendingValidatorOutput` literals, the README `atomic implementation tickets` assertion, and both manifest census assertions on `issues.tickets.length` and its unique-id set. The same file's D0-005 through D0-009 issue-pin assertion additionally admits `D0-011` and orders the compared pairs, because the pinned list is an unordered set that a bare append would otherwise make order-dependent. No other symbol in either file may be touched, and no behaviour outside these census pins changes.
- A second bounded carve-out belongs to the future GREEN, not to this packet, and is stated here so it is not discovered as unowned scope later: staging the RED file `tests/planning/fixture-directory-admission.test.mjs` raises the ticket-owned source census from 13 to 14, so that implementation may change the `ticket_owned_code_files` literal in `scripts/validate-planning.mjs` and the matching expected-output literals in `tests/planning-contract.test.mjs`, and nothing else in either file.
- ADR-0001, ADR-0003, ADR-0012, PRD-D0, D0-002, D0-004, D0-005 through D0-010, and `docs/decisions/maintainer-gate-registry.v2.json`.
- A hardcoded fixture-directory list; an exception for `operational-state`; admission from a non-declaration reference; accepting a bare directory, a non-glob path, a path outside `fixtures/`, an absolute path, a traversal segment, or an outside-repository symlink.
- GitHub issue, label, body, pull-request, branch, registry, approval, or acceptance mutation; any `TBD-*` or other surrogate issue binding.
- Silent fallback on malformed declarations, malformed tickets, missing directories, ambiguity, unsafe path handling, timeout, partial state, or stale evidence.

## RED contract

- Test file: `tests/planning/fixture-directory-admission.test.mjs`.
- Focused command: `node --test tests/planning/fixture-directory-admission.test.mjs`.
- Stage only the eighteen named cases and their isolated overlays before the GREEN-owned admission behavior or `allowedSkeletonFiles` edit. The operational-state and reference cases must read the actual repository root and its complete live planning-catalog ticket corpus; an overlay may replace only the bytes read for the named ticket and must not write to the live repository root or copy a Git worktree.
- Capture all eighteen named failures, their exact messages, and the command exit code before GREEN. A case that already passes for the wrong reason, an unrelated failure, an in-place fixture mutation, or an unregistered skip stops execution.
- The required pre-GREEN failures are:
  - `ticket-declared-operational-state-fixture-directory-is-admitted` — `fixture declaration fixtures/operational-state/** is not ticket-derived`. This case reads the actual repository root and first proves that D0-004's live owned entry admits the existing regular operational-state fixtures. It then uses the same live corpus with only that D0-004 ownership fragment removed; `fixtures/operational-state` must be unadmitted while D0-011's unchanged reference remains present.
  - `fixture-reference-does-not-admit` — `ticketDeclaredFixtureDirectories is not exported; reference exclusion is unproven`. The same live-corpus overlay removes D0-004's owned entry and leaves D0-011's reference untouched; the census must return no operational-state admission.
  - `ticket-declared-doctor-fixture-directory-is-admitted` — `fixture declaration fixtures/doctor/*.json was not admitted`.
  - `ticket-declared-effective-state-fixture-directory-is-admitted` — `fixture declaration fixtures/governance/effective-state/** was not admitted`.
  - `ticket-declared-artifact-manifest-v3-fixture-directory-is-admitted` — `fixture declaration fixtures/governance/artifact-manifest-v3/** was not admitted`.
  - `ticket-declared-github-acceptance-fixture-directory-is-admitted` — `fixture declaration fixtures/governance/github-acceptance/** was not admitted`.
  - `ticket-declared-authenticated-review-activation-fixture-directory-is-admitted` — `fixture declaration fixtures/governance/authenticated-review-activation/** was not admitted`.
  - `ticket-declared-absent-fixture-directory-is-not-admitted` — `fixtureAdmissionGlob is not exported; absent-declaration rejection is unproven`. With no admission oracle, a missing declaration cannot be incorrectly admitted; this case therefore fails on the absent oracle rather than a message saying it was admitted.
  - `non-glob-fixture-declaration-is-not-admitted` — `non-glob fixture declaration fixtures/operational-state was admitted`.
  - `traversal-fixture-declaration-is-rejected` — `fixtureAdmissionSegment is not exported; traversal rejection is unproven`. With no admission oracle, traversal cannot be incorrectly admitted; this case therefore fails on the absent oracle rather than a message saying it was admitted.
  - `malformed-ticket-does-not-admit-or-abort-census` — `ticketDeclaredFixtureDirectories is not exported; malformed-ticket handling is unproven`.
  - `outside-repository-symlinked-fixture-directory-is-not-admitted` — `ticketDeclaredFixtureDirectories is not exported; outside-repository symlink rejection is unproven`.
  - `planning-catalog-ticket-corpus-is-exact` — `ticketDeclaredFixtureDirectories is not exported; planning-catalog ticket corpus is unproven`.
  - `declared-file-predicate-refuses-nonmatching-file` — `fixtureAdmissionGlob is not exported; file-predicate rejection is unproven`. The isolated doctor directory contains a declared `*.json` file and a regular non-matching `.txt` file; only the matching file may be admitted.
  - `absolute-fixture-declaration-is-rejected` — `fixtureAdmissionGlob is not exported; absolute-path rejection is unproven`.
  - `outside-fixtures-declaration-is-rejected` — `fixtureAdmissionGlob is not exported; fixtures-root rejection is unproven`.
  - `unquoted-final-fixture-declaration-is-admitted` — `fixture declaration fixtures/prescription/*.json was not admitted`. This uses E0D-003's final unquoted declaration.
  - `repeated-unquoted-fixture-declarations-are-admitted` — `repeated unquoted fixture declarations were not admitted`. This uses the repeated E2-004 ownership bullet and proves every safely materialized repeated declaration is considered rather than only its first entry.

Expected pre-GREEN failure: all eighteen named cases fail with exactly their pinned messages; the existing operational-state exception proves it is not ticket-derived, D0-011's reference cannot substitute for D0-004's live declaration, and the admission and rejection cases bind to a missing admission oracle whenever an incorrect result is impossible before GREEN.

## Minimum GREEN

- Implement deterministic ticket-derived fixture admission that proves every **Admission outcome** end-to-end. The implementation may choose its parsing structure, but it must handle both declaration forms and the final and repeated positions already present in the corpus and must remain mutation-tested against the named outcomes.
- Replace `operationalStateFiles` in `allowedSkeletonFiles` with exactly the ticket-derived census result; retain the existing workspace manifests, owner markers, and `ticketOwnedSkeletonPaths` inputs unchanged. There is no fallback to a hardcoded directory.
- Admit files only from existing declared directories within the repository. A trailing `*.json` predicate admits only matching regular files in its declared directory; `**` admits the declared directory's regular-file subtree. The comparison is deterministic and regular-file-only, and it fails closed for an absent directory, malformed catalog-listed ticket, an absolute declaration, a declaration outside `fixtures/`, traversal declaration, or directory resolving outside the repository.
- Determine candidate tickets solely from the planning catalog's ticket paths. The live-corpus reference case must show that a reference cannot become an admission merely because it mentions a fixture glob.
- Do not alter ticket source ownership, package scripts, fixture contents, or any catalog/gate state.

## Acceptance ↔ tests

- AC-D0-011-1 ↔ `tests/planning/fixture-directory-admission.test.mjs` case `ticket-declared-operational-state-fixture-directory-is-admitted`: the live D0-004 declaration `fixtures/operational-state/**` admits its existing regular fixture files.
- AC-D0-011-2 ↔ `tests/planning/fixture-directory-admission.test.mjs` case `fixture-reference-does-not-admit`: D0-011's reference cannot admit or retain operational-state files after the D0-004 declaration is removed from the live-corpus overlay.
- AC-D0-011-3 ↔ `tests/planning/fixture-directory-admission.test.mjs` case `ticket-declared-doctor-fixture-directory-is-admitted`: the existing unquoted E0B-003 declaration `fixtures/doctor/*.json` is admitted against its safely materialized declared directory.
- AC-D0-011-4 ↔ `tests/planning/fixture-directory-admission.test.mjs` case `ticket-declared-effective-state-fixture-directory-is-admitted`: `fixtures/governance/effective-state/**` is admitted against its safely materialized declared directory.
- AC-D0-011-5 ↔ `tests/planning/fixture-directory-admission.test.mjs` case `ticket-declared-artifact-manifest-v3-fixture-directory-is-admitted`: `fixtures/governance/artifact-manifest-v3/**` is admitted against its safely materialized declared directory.
- AC-D0-011-6 ↔ `tests/planning/fixture-directory-admission.test.mjs` case `ticket-declared-github-acceptance-fixture-directory-is-admitted`: `fixtures/governance/github-acceptance/**` is admitted against its safely materialized declared directory.
- AC-D0-011-7 ↔ `tests/planning/fixture-directory-admission.test.mjs` case `ticket-declared-authenticated-review-activation-fixture-directory-is-admitted`: `fixtures/governance/authenticated-review-activation/**` is admitted against its safely materialized declared directory.
- AC-D0-011-8 ↔ `tests/planning/fixture-directory-admission.test.mjs` case `ticket-declared-absent-fixture-directory-is-not-admitted`: an absent declared directory contributes no admission.
- AC-D0-011-9 ↔ `tests/planning/fixture-directory-admission.test.mjs` case `non-glob-fixture-declaration-is-not-admitted`: a bare `fixtures/operational-state` declaration and every other non-glob declaration contribute no admission.
- AC-D0-011-10 ↔ `tests/planning/fixture-directory-admission.test.mjs` case `traversal-fixture-declaration-is-rejected`: every declaration containing `.` or `..` as a path segment is rejected before resolution or traversal.
- AC-D0-011-11 ↔ `tests/planning/fixture-directory-admission.test.mjs` case `malformed-ticket-does-not-admit-or-abort-census`: a malformed catalog-listed ticket grants no admission and does not stop census of the remaining catalog-listed tickets.
- AC-D0-011-12 ↔ `tests/planning/fixture-directory-admission.test.mjs` case `outside-repository-symlinked-fixture-directory-is-not-admitted`: a symlinked fixture directory resolving outside the repository grants no admission.
- AC-D0-011-13 ↔ `tests/planning/fixture-directory-admission.test.mjs` case `planning-catalog-ticket-corpus-is-exact`: every and only planning-catalog ticket path is scanned.
- AC-D0-011-14 ↔ `tests/planning/fixture-directory-admission.test.mjs` case `declared-file-predicate-refuses-nonmatching-file`: `fixtures/doctor/*.json` admits the matching regular JSON file but refuses a regular non-matching `.txt` file in the same declared directory.
- AC-D0-011-15 ↔ `tests/planning/fixture-directory-admission.test.mjs` case `absolute-fixture-declaration-is-rejected`: an absolute fixture declaration grants no admission.
- AC-D0-011-16 ↔ `tests/planning/fixture-directory-admission.test.mjs` case `outside-fixtures-declaration-is-rejected`: a declaration outside `fixtures/` grants no admission.
- AC-D0-011-17 ↔ `tests/planning/fixture-directory-admission.test.mjs` case `unquoted-final-fixture-declaration-is-admitted`: E0D-003's final unquoted `fixtures/prescription/*.json` declaration is admitted against its safely materialized directory.
- AC-D0-011-18 ↔ `tests/planning/fixture-directory-admission.test.mjs` case `repeated-unquoted-fixture-declarations-are-admitted`: every safely materialized unquoted fixture declaration in E2-004's repeated ownership bullet is admitted.

## Verification


0. Mutation kill, before any lane is reported green: for each named case, disable the exact guard it protects, confirm that named case fails, restore the guard byte-identically, and confirm the suite returns to its baseline count. Attach the table. A guard whose mutation leaves the lane green is decorative and the ticket is not satisfied, regardless of every other lane passing.
1. RED: after staging only the named cases and isolated fixtures, run `node --test tests/planning/fixture-directory-admission.test.mjs`; capture all eighteen named failures and their pinned messages before GREEN.
2. Focused: `node --test tests/planning/fixture-directory-admission.test.mjs`; all eighteen named cases pass, with no skipped case and no hardcoded fixture-directory exception.
3. Full: `npm test`; zero failures and no unregistered skip.
4. Build/package: `npm run build`; the planning census matches disk.
5. Documentation gate: `npm run docs:check`; the ticket and catalog census agree without weakening a gate.
6. Manual/live: `LIVE_NA` — the rule is deterministic, repository-local, and fixture-backed; no network or write API is authorized.
7. Ownership: `git diff --check <base>...<head>` passes, `git diff --name-only <base>...<head>` is restricted to the accepted implementation candidate's owned symbols, and the frozen documents remain unchanged (this ticket's own RED file `tests/planning/fixture-directory-admission.test.mjs` is expected to change; it is staged by the RED step) by this packet.

## Stop and escalation

- Stop on a mismatch between this ticket and GitHub issue #182, including title, milestone, labels, or issue kind; report it rather than substituting a placeholder or other surrogate binding.
- Stop on a declaration that admits a `.` or `..` segment, an undeclared or reference-only directory admission, an absent directory admission, a malformed-ticket admission, an outside-repository symlink admission, an admission from a non-catalog path, or a non-glob declaration admitted as a directory.
- Stop on ownership overlap with D0-002 or D0-004 before this ticket is accepted, missing D0-002 verification, wrong target, stale authority digest, missing RED receipt, a pinned RED message mismatch, nondeterministic census, timeout without reconciliation, or partial state.
- Escalate any required validator/schema change outside this ticket's declared ownership to its owning ticket. Do not broaden this ticket, weaken the gate, or edit D0-004 to work around that blocker.

## Completion evidence

- Exact base and candidate-head SHA, runtime/toolchain identity, permission profile, and ownership audit.
- The complete eighteen-case RED receipt: command, exit code, every named failure, and every pinned message before GREEN.
- Focused, full, build/package, and documentation-gate receipts tied to the exact candidate head; `LIVE_NA` rationale.
- The fixture-directory census before and after GREEN, showing the sixteen derived declaration occurrences in their live forms (five distinct backtick-quoted paths and eleven unquoted occurrences), their captured directories, deterministic admitted files, preserved `*.json` predicates, absolute and outside-`fixtures/` rejection, final and repeated unquoted parsing, D0-004-removal and D0-011-reference results from the live corpus, absent-directory exclusion, non-glob exclusion, traversal rejection, malformed-ticket continuation, outside-repository symlink exclusion, planning-catalog-only corpus selection, and no operational-state hardcode.
- Exact-head cumulative review and CI, with an explicit statement that D0-004's narrow grant was superseded only after this ticket's acceptance.

## Invalidation

Any change to this ticket, D0-002, D0-004's narrow carve-out, the owning PRD/ADRs, the planning catalog ticket paths, any declared fixture syntax in the current corpus, the admission behavior, `allowedSkeletonFiles`, fixture directory topology, runtime identity, or candidate head invalidates affected evidence. A contract, corpus, or test-oracle change returns the implementation candidate to RED; a candidate-head-only change renews exact-head review and CI.
