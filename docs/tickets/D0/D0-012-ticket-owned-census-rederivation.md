# D0-012 · Ticket-owned census re-derivation

- Status: **BLOCKED — ADR + PRD + TICKET MAINTAINER GATES REQUIRED**
- Epic: D0
- Milestone: S0 · Name & Contracts
- Owning PRD: [D0](../../prd/PRD-D0-name-migration-and-repository-skeleton.md)
- Size: M
- Dependencies: D0-002

## Goal

Reconcile the independent workspace-skeleton re-derivation with the planning validator's whole materialized, non-control-plane ticket-owned census. The defect is observable when a catalog-declared `.mjs` path outside the skeleton roots is materialized: the validator reports the path, while the current skeleton-only re-derivation drops it before the equality assertion.

This Phase A transaction registers the blocked contract, its minimum static catalog edges, and the 72-to-73 ticket-census fragments. It neither stages RED nor changes the future implementation file. A separate Phase B Gate Administration transaction must bind the final ticket bytes before an exact-base execution packet can authorize the future RED lane.

## Exact ownership

- `docs/tickets/D0/D0-012-ticket-owned-census-rederivation.md`: this complete exact contract.
- `tests/planning/workspace-skeleton.test.mjs`: exactly `ticketOwnedPaths`, `ticketOwnedSkeletonPaths`, and the whole-census equality assertion inside skeleton-source-requires-an-owning-ticket. This future implementation path is deliberately unchanged in Phase A.
- `scripts/validate-planning.mjs`: only the `ticketFiles` expected-count literal and its atomic-ticket README-census check.
- `tests/planning-contract.test.mjs`: only `acceptedValidatorOutput`, `pendingValidatorOutput`, the atomic-ticket README assertion, the manifest-length and unique-ID assertions, and the curated D0 numeric-binding assertion.
- `README.md`: only the atomic implementation-ticket census line.
- `docs/issues.json`: only the D0-012 static catalog record for issue 206.
- `docs/GITHUB-ISSUE-MAP.md`: only the D0-012 issue-206 mapping row.
- `docs/TRACEABILITY.md`: only the D0 ticket membership, the AC-D0-3 membership, the existing workspace-skeleton planned-case entry, and the D0-012 acceptance binding.
- `docs/tickets/BOARD.md`: only the generated D0-012 row.
- `docs/planning/AOS-EXECUTION-ROADMAP.md`: only the static catalog-census sentence.
- No other file or symbol may be edited without a replacement ticket and renewed gate.

## Ownership reconciliation

On acceptance of this exact ticket, D0-012 prospectively supersedes D0-002's file-scope grant only for the three future workspace-skeleton units named above. D0-002 remains operative until then and is not edited here.

E0A-001's prior claim over ticketOwnedPaths and the E0A-002, E0A-003, and E0B-002 claims over ticketOwnedSkeletonPaths are not silently absorbed. Before RED, each required exact-digest owner replacement must limit any transfer to the relevant D0-012 unit and leave active ownership facts disjoint.

D0-004's control-plane and operational-fixture carve-out is not transferred. D0-011 remains the semantic owner of ticket-derived fixture admission and prospectively supersedes D0-004's `fixtures/operational-state/**` grant over the `allowedSkeletonFiles` comparison; D0-012 neither supersedes nor edits that comparison. E0B-003's narrow doctor-fixture carve-out is likewise retained. PR #197 is CLOSED and its preserved `feat-issue-182-d0-011` head is not an open candidate, but future execution still requires freshly checked active ownership facts.

D0-013's exact ticket bytes, accepted prerequisite digest, future test path, and current registration record are preserved. For only the shared registration fragments enumerated in Exact ownership, this maintainer-directed Phase A transaction prospectively replaces otherwise overlapping historical D0-004, D0-013, and E14-002 registration claims while advancing the catalog from 72 to 73. It transfers no D0-013 implementation behavior, test ownership, gate evidence, or receipt.

## Preconditions

1. The final SSOT, ADR-0001, ADR-0003, ADR-0012, the owning D0 PRD, and this exact ticket are accepted at their exact digests before RED.
2. D0-002 is verified on `dev` with current post-merge evidence. A closed issue, partial merge, or stale evidence does not satisfy the dependency.
3. The positive numeric issue binding is 206. It identifies the remediation issue only; issue state, labels, milestone, body, and comments do not authorize this ticket.
4. Phase A has created every catalog edge and count fragment named in Exact ownership, rendered the Board, and retained `ticket_owned_code_files=12` because no source file is materialized here.
5. A later Gate Administration transaction accepts a batch whose reviewed head contains this final ticket file and whose artifact digest equals its final bytes. Phase A does not create that record.
6. Before RED, exact-digest owner replacements for the three future units and a resolver result with no active path or symbol collision are required. Unavailable replacement evidence or a collision stops execution.
7. The D0-012 and D0-013 static dependency declarations both remain D0-002. The validator does not infer upstream edges from prose, and changing D0-013 would invalidate its accepted digest. A later D0-013 execution packet must therefore record verified D0-012 implementation as an additional sequencing fact before its implementation begins.
8. The execution packet pins a freshly fetched `origin/dev` base SHA, isolated worktree state, Node/npm identity, permission profile, and the exact ownership collection.

## Forbidden scope

- In Phase A, changing `tests/planning/workspace-skeleton.test.mjs`, creating any source or test module, or changing the validator's control-plane allowlist.
- The gate registry, Gate Administration documentation, Gate Administration contract test, renderer, workflow, package scripts, resolver logic, schema, and historical receipt data.
- The D0-006-reserved `control_plane_code_files=10` and `control_plane_allowlist=10` transitions; both values remain unchanged.
- Any edit to the D0-013 ticket document, its accepted digest, its future test path, its catalog binding, or its receipt.
- Editing D0-002, D0-004, D0-011, E0A-001, E0A-002, E0A-003, E0B-002, E0B-003, the SSOT, an ADR, the D0 PRD, a GitHub issue, label, body, pull request, branch, approval, acceptance, or receipt.
- Silent fallback on wrong target, ownership overlap, missing observability, timeout without reconciliation, partial state, nondeterminism, unsafe permission, secret exposure, hidden-reasoning capture, or stale evidence.

## RED contract

- Test file: `tests/planning/workspace-skeleton.test.mjs`.
- Focused command: `node --test --test-name-pattern '^skeleton-source-requires-an-owning-ticket$' tests/planning/workspace-skeleton.test.mjs`.
- Before changing ticketOwnedPaths, ticketOwnedSkeletonPaths, or their equality assertion, stage only a bounded probe inside skeleton-source-requires-an-owning-ticket. Its outer branch creates a uniquely named temporary parent, copies the candidate repository while excluding node_modules and transient planning fixtures, and removes only that verified temporary parent in finally. It is never a Git worktree and never the live repository root.
- In the copied repository only, amend E0A-001's existing ownership declaration to include `tests/planning/catalog-declared-outside-skeleton.mjs`, then materialize exactly that file with `export {};` and one trailing newline. The copied validator must report that path and `ticket_owned_code_files=13`; the unmodified candidate remains 12.
- Run the copied repository's same named test under a private one-level marker that suppresses only recursive fixture creation. The child validator must exit zero before the parent accepts any test failure. A target-verification failure is unrelated to this RED claim and stops execution.
- Capture the focused command, exit code, the one named failing case, the child validator's 12-to-13 evidence, and its bounded comparator diagnostic before GREEN. No permanent outside-skeleton source, in-place repository mutation, unregistered skip, or unrelated child failure is permitted.

Expected pre-GREEN failure: `skeleton-source-requires-an-owning-ticket` reports `catalog-declared outside-skeleton source leaves the validator census unequal to the skeleton-only re-derivation.`

## Minimum GREEN

- Derive the whole materialized ticket-owned set in ticketOwnedPaths, using a locally held validator-equivalent control-plane exclusion and the validator-equivalent optional trailing period on Test file declarations.
- Keep skeleton-root narrowing solely in ticketOwnedSkeletonPaths and compare the validator's reported ticket-owned code paths directly with the whole re-derivation, never with a skeleton-filtered counterpart.
- Preserve the materialized-path reachability limit: the comparison proves equality for paths present on disk, not every unmaterialized declaration branch.
- Keep the parser independent: it may not import validator parsing, the validator allowlist, or its ticket source set.
- Retain the isolated probe after GREEN. Its whole fixture census includes the outside-skeleton source while the skeleton projection omits it, and the named parent case passes.

## Acceptance ↔ tests

- AC-D0-012-1 ↔ `tests/planning/workspace-skeleton.test.mjs` case `skeleton-source-requires-an-owning-ticket`: the isolated E0A-001 overlay declares and materializes an outside-skeleton source; the independent whole re-derivation equals the fixture validator census while the separate skeleton projection omits that source.

## Verification

1. Phase A: run `npm test`, `npm run build`, `npm run docs:check`, `node scripts/validate-gate-administration.mjs`, and `npm run ops:check`. The planning outputs must report `tickets=73` and `ticket_owned_code_files=12`; Gate Administration remains `batches=13 accepted=4`.
2. Phase A mutations: individually restore each enforced 73 census pin to 72 and run its owning lane; for the Roadmap's static catalog-shape prose, run the direct exact-text census cross-check. Also omit one D0-012 catalog edge, alter the required Status wording, and omit one collector-visible ownership symbol. Each mutation must be detected by its applicable lane or direct ownership-set check and each restoration must be byte-identical.
3. RED: run the focused command before GREEN. Retain only the expected named mismatch, an exit-zero child-validator receipt, the 12-to-13 fixture census, and the verified child comparator diagnostic.
4. Focused GREEN: run the same focused command; the named case passes with no unregistered skip.
5. Full and planning: run `npm test`, `npm run build`, `npm run docs:check`, and `npm run ops:check` at the exact implementation head.
6. Manual/live: `LIVE_NA`; this ticket owns repository-local deterministic validation only.
7. Ownership: inspect the exact candidate diff and re-run the resolver ownership check. Phase A is limited to the registration fragments above; the later implementation candidate is limited to the three workspace-skeleton units.

## Stop and escalation

- Stop on a wrong target, active ownership overlap, missing D0-002 evidence, missing exact-digest replacement, missing issue-206 binding, incomplete catalog authoring, fixture-copy failure, child-validator failure, a child failure of a different shape, missing required observability, unsafe permission, secret exposure, timeout without reconciliation, partial state, nondeterminism, or stale evidence.
- Escalate a D0-002, D0-004, D0-011, E0A, E0B, D0-013, catalog, validator, issue-binding, or Gate Administration defect to its owner. Do not broaden this ticket or weaken a guard.

## Completion evidence

- Exact base and candidate-head SHA, runtime identity, permission profile, clean-worktree evidence, issue-206 identity check, PR-197 closure check, and a diff manifest.
- The Phase A registration evidence for the ticket, catalog, count fragments, and rendered Board, including the retained 12 ticket-owned-code-file census.
- The parser collection and bidirectional ownership audit: every Phase A changed path appears in Exact ownership; the only declared-but-unchanged path is the explicitly deferred future implementation path.
- The future RED, mutation, focused, full, build, docs, and ops receipts; the `LIVE_NA` rationale; exact-head cumulative review; and CI evidence before merge eligibility.

## Invalidation

Any change to this ticket, required ADR/PRD authority, D0-002 evidence, owner-replacement evidence, the static issue binding, catalog edges, count pins, future workspace-skeleton units, runtime identity, target branch, or candidate head invalidates affected evidence and returns the lane to the earliest changed gate.
