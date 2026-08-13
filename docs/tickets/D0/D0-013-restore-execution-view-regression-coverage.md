# D0-013 · Restore execution-view regression coverage

- Status: **BLOCKED — ADR + PRD + TICKET MAINTAINER GATES REQUIRED**
- Epic: D0
- Milestone: S0 · Name & Contracts
- Owning PRD: [D0](../../prd/PRD-D0-name-migration-and-repository-skeleton.md)
- Size: S
- Dependencies: D0-002

## Goal

Restore the missing regression coverage at the path recorded by the D0-004 completion receipt without weakening completion-effect validation, changing historical receipt metadata, or classifying the test as control-plane code. The future test must exercise the current execution-view renderer boundary, not the deleted export API from the reverted implementation.

This Phase A transaction registers the ticket, its static catalog edges, and the resulting planning-census literals only. It does not authorize RED, create the test file, accept an artifact, or establish readiness. A later Gate Administration transaction must bind this final ticket digest before an implementation packet can authorize the future RED lane.

## Exact ownership

- `tests/execution-views.test.mjs`: the complete future test module.
- `scripts/validate-planning.mjs`: only its `ticketFiles` expected-count literal and exact README atomic-ticket-census assertion.
- `tests/planning-contract.test.mjs`: only the `acceptedValidatorOutput` and `pendingValidatorOutput` ticket-count fields during registration; later, only their ticket-owned count fields and one sorted `tests/execution-views.test.mjs` path entry when that file is materialized; the README census assertion, manifest-count literal, unique-ID-count literal, and D0 numeric-binding expectation in all-issue-bindings-are-numeric-and-unique.
- `README.md`: only its atomic-ticket census line.
- `docs/issues.json`: only the D0-013 static catalog record for issue 202.
- `docs/GITHUB-ISSUE-MAP.md`: only the D0-013 issue-202 mapping row.
- `docs/TRACEABILITY.md`: only the D0-013 catalog membership, PRD-acceptance edge, planned-test entry, and ticket-acceptance binding.
- `docs/tickets/BOARD.md`: only the generated D0-013 row.
- `docs/planning/AOS-EXECUTION-ROADMAP.md`: only its static ticket-record census sentence.
- For only the registration fragments above, this exact ticket prospectively replaces otherwise overlapping D0-004 and E14-002 grants; every remaining grant of those tickets is preserved and neither ticket is edited.
- No other file or symbol may be edited without a replacement ticket and renewed gate.

## Preconditions

1. The final SSOT, ADR-0001, ADR-0003, ADR-0012, the owning D0 PRD, and this exact ticket are accepted at their exact digests before RED.
2. D0-002 is verified on `dev` with current post-merge evidence before RED. This dependency is acyclic because D0-002 depends only on D0-001; D0-004 is deliberately not a dependency because this ticket restores the missing completion effect upstream of D0-004 verification.
3. The positive numeric issue binding is 202. It identifies the remediation issue only; issue state, labels, milestone, body, and comments do not authorize this ticket.
4. A later Gate Administration transaction accepts a batch whose reviewed head contains this final ticket file and whose artifact digest equals its final bytes. Phase A does not create that record.
5. Before RED, a maintainer-approved exact-base execution packet records a freshly fetched `origin/dev` base, branch, isolated worktree state, runtime/toolchain identity, permission profile, and the exact owned paths and symbols above.
6. No active candidate owns the future test path or an overlapping owned symbol. Ambiguous active ownership stops the lane.

## Forbidden scope

- Creating `tests/execution-views.test.mjs` in Phase A, changing the execution-view renderer, workflow, package scripts, resolver, schema, completion selection, or historical pull-request metadata.
- The control-plane allowlist and the D0-006-reserved `control_plane_code_files=10` and `control_plane_allowlist=10` transitions; those values remain unchanged by both registration and future test restoration.
- The gate registry, Gate Administration census document, and Gate Administration contract test. They belong solely to the later Gate Administration transaction, not to this ticket's ownership.
- Any change to D0-002, D0-004, D0-006, D0-011, E14-002, the SSOT, an ADR, the D0 PRD, or a GitHub issue, label, body, branch, approval, acceptance, or receipt.
- A placeholder that satisfies only path existence; a silent fallback, unregistered terminal state, unbounded raw trace capture, secret exposure, hidden-reasoning capture, wrong target, timeout without reconciliation, partial state, or stale evidence.

## RED contract

- Test file: `tests/execution-views.test.mjs`.
- Focused command: `node --test tests/execution-views.test.mjs`.
- Before adding the test module or changing any owned future count field, capture the missing-file failure from the focused command. The failure must identify `tests/execution-views.test.mjs`; a different failure is not this ticket's RED evidence.
- Stage the four named cases below against the current renderer CLI in an isolated temporary repository copy. Do not restore deleted renderer exports or mutate the live repository as a fixture.

Expected pre-GREEN failure: the focused command reports that tests/execution-views.test.mjs could not be found.

## Minimum GREEN

- Add the owned test module only after the accepted gate and exact-base packet authorize RED.
- The module invokes the current execution-view renderer CLI and proves that authored prose outside generated markers is not an input, the generated views are deterministic, and renderer checks are repeatable in the isolated copy.
- The implementation does not alter the renderer, resolver, workflow, package scripts, completion receipt, control-plane allowlist, or D0-006-reserved literals. If the current renderer already satisfies the named cases, the only source GREEN is the restored test module and its future census projection.
- When the test file becomes materialized, update only the two owned ticket-owned count fields and their one sorted test-path entries in the planning-contract expectations. The Phase A registration leaves the ticket-owned code count at 12.

## Acceptance ↔ tests

- AC-D0-013-1 ↔ `tests/execution-views.test.mjs` cases `roadmap-is-not-an-input`, `board-is-not-an-input`, `historical-ledger-is-ignored` and `generated-views-are-deterministic`: the current renderer CLI derives generated views from the static catalog and preserves deterministic output while authored non-input prose changes in isolated copies do not alter that derivation.

## Verification

1. Registration: verify the ticket, catalog edges, Board projection, and every owned planning-census literal while the test file remains absent and `ticket_owned_code_files=12`.
2. RED: run the focused command before the future test module is added and retain the exact missing-file result.
3. Focused GREEN: run the focused command after the named cases are materialized; every named case passes with no unregistered skip.
4. Full and planning: run `npm test`, `npm run build`, `npm run docs:check`, and `npm run ops:check` at the exact implementation head. The post-materialization census must be 13 only in the owned ticket-owned expectation fields.
5. Mutation: in isolated copies, alter authored Roadmap prose, authored Board prose, and historical-ledger prose separately; each named non-input case must still demonstrate that generated output is catalog-derived. Independently perturb deterministic renderer input/output conditions so the deterministic case fails, then restore bytes exactly.
6. Manual/live: `LIVE_NA`; the ticket owns repository-local deterministic regression coverage only.
7. Ownership: inspect the exact candidate diff. Phase A is limited to registration/census/catalog projections; the later implementation candidate is limited to the owned test module and the stated future expectation fragments.

## Stop and escalation

- Stop on a missing accepted artifact gate, missing exact-base packet, wrong target, active ownership overlap, missing-file RED result of a different shape, stale deleted-export assumptions, nondeterministic generated output, unexpected renderer behavior outside this ticket, unowned source change, unavailable required observability, unsafe permission, secret exposure, hidden-reasoning capture, timeout without reconciliation, partial state, or stale evidence.
- Escalate a renderer, resolver, workflow, package, schema, control-plane, D0-006, Gate Administration, or historical-receipt concern to its owner. Do not broaden this ticket or weaken a guard to make the path exist.

## Completion evidence

- Exact base and candidate-head SHAs, runtime/toolchain identity, permission profile, clean-worktree evidence, and ownership audit.
- The registration evidence for ticket/catalog/census/Board agreement, including the retained 12 ticket-owned-code-file census before the test exists.
- The future focused RED receipt, named-case GREEN receipt, mutation receipts, full/build/docs/ops receipts, and `LIVE_NA` rationale.
- Exact-head cumulative review and CI evidence before merge eligibility, plus a post-merge check that the expected path is present without changing completion-selection semantics.

## Invalidation

Any change to this ticket, required ADR/PRD authority, D0-002 evidence, the future test path or cases, the static catalog binding, renderer boundary, control-plane classification, runtime identity, target branch, or candidate head invalidates affected evidence and returns the lane to the earliest changed gate.
