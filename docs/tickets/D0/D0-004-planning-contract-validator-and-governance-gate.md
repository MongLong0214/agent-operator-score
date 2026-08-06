# D0-004 · Semantic planning validator v2 and governance gate

- Status: **BLOCKED — ADR + PRD + TICKET MAINTAINER GATES REQUIRED**
- Epic: D0
- Milestone: S0 · Name & Contracts
- Owning PRD: [D0](../../prd/PRD-D0-name-migration-and-repository-skeleton.md)
- Size: L
- Dependencies: D0-002

## Goal

Replace the structural planning validator with semantic planning validator v2 and replace manually duplicated current-state prose with one deterministic Execution State Resolver. Static contracts and verifiable Git/GitHub facts are inputs; current phase, readiness, blockers, active candidates, and ready set are calculated outputs. Markdown and GitHub status surfaces are projections or audit records, never readiness inputs.

## Exact ownership

- D0-004A semantic catalog: `scripts/validate-planning.mjs`; every portion of `tests/planning-contract.test.mjs` except the numeric `control_plane_code_files` literal in `acceptedValidatorOutput` and `pendingValidatorOutput`, which D0-001 owns solely for its completed `4` to `6` adjustment, the temporary D0-002 allowlist insertion and four `6` to `7` planning-census literals, the isolated D0 identity fixture plumbing, the `gates=<status>` portion, which Gate Administration owns, and the compatibility migration's exact delegation test case/plumbing; `docs/TRACEABILITY.md`; only the static-catalog fields in `docs/issues.json`: top-level `operational_authority` plus each record's `issue`, `ticket_path`, `milestone`, `dependencies`, `size`, `epic`, `kind`, and `initial_labels`, including the one-time mechanical migration of legacy `body` to non-authoritative `body_template` and legacy `labels` to `initial_labels`; historical v1 boundary only: `docs/decisions/maintainer-gate-registry.v1.json` is not an active control-plane ownership grant and must not be restored.
- D0-004B resolver core: `scripts/resolve-execution-state.mjs`; `specs/execution-state.schema.v1.json`; `tests/execution-state.test.mjs`; `fixtures/operational-state/**`; and only `package.json` scripts `ops:status` and `ops:check`.
- D0-004C projections and CI: `scripts/render-execution-views.mjs`; only `package.json` script `ops:render`; `.github/workflows/operational-state.yml`; `AGENTS.md` **Current operational state** section; the dynamic-state header of `docs/planning/AOS-EXECUTION-ROADMAP.md`; generated/static-authority markers and generated rows in `docs/tickets/BOARD.md`; and the historical-authority banner in `docs/planning/issue-resolution-ledger-2026-08-06.md`. D0-004 must neither edit nor consume the existing Maintainer Gate status snapshot or the gate-administration schema.
- No other file or symbol may be edited without a replacement ticket and renewed gate.

## Preconditions

1. Required ADRs and owning PRD are explicitly accepted at their exact digests.
2. This exact ticket is explicitly accepted and an execution packet pins the base SHA.
3. D0-002 is complete and D0-003 is verified superseded by PR #53.
4. The one-time authority-surface correction is merged: Roadmap and Board are static, the dated ledger is historical, and committed current SHA/readiness prose is absent.
5. Worktree is clean, GitHub availability mode is explicit, and unrelated owner changes are identified and protected.

## Trusted actor policy

The exact D0-004 ticket digest accepted by the Maintainer Gate binds this policy. D0-004A copies it without semantic expansion into `docs/issues.json.operational_authority`; the resolver rejects a missing, malformed, or non-identical copy as `TICKET_CONTRACT_CONFLICT`.

```json
{
  "repository": "MongLong0214/agent-operator-score",
  "target_branch": "dev",
  "repository_owner": {
    "login": "MongLong0214",
    "type": "User"
  },
  "review": {
    "eligible_permissions": ["maintain", "admin"],
    "must_differ_from_pr_author": true,
    "protected_check": "exact-head-review",
    "workflow_path": ".github/workflows/operational-state.yml",
    "trusted_ref": "refs/heads/dev",
    "required_event": "workflow_dispatch",
    "workflow_commit_relation": "reachable_from_live_target",
    "bind_workflow_blob_oid": true,
    "check_creator_app": "github-actions",
    "external_id_prefix": "aos-exact-head-review:"
  },
  "authorization": {
    "eligible_permissions": ["maintain", "admin"],
    "must_differ_from_pr_author": true,
    "protected_check": "exact-head-authorization",
    "workflow_path": ".github/workflows/operational-state.yml",
    "trusted_ref": "refs/heads/dev",
    "required_event": "workflow_dispatch",
    "workflow_commit_relation": "reachable_from_live_target",
    "bind_workflow_blob_oid": true,
    "check_creator_app": "github-actions",
    "external_id_prefix": "aos-exact-head-authorization:"
  }
}
```

- Repository: `MongLong0214/agent-operator-score`; target branch: `dev`; repository-owner login: `MongLong0214`. `GET /repos/MongLong0214/agent-operator-score` must return that exact owner login/type and default branch, and `GET /repos/MongLong0214/agent-operator-score/collaborators/{actor}/permission` must return one of the policy's exact eligible permissions; an unavailable or ambiguous response fails closed.
- An accepted gate PR must be authored against `dev`, link exactly one batch, and be merged by the repository-owner login. The GitHub repository API must independently confirm that login is the current repository owner; a committed identity string alone is insufficient.
- A formal-review fact is eligible only when its reviewer has current `maintain` or `admin` repository permission, its `commit_id` equals the live PR head, and the reviewer is not the PR author. A review that fails any condition is ignored.
- A same-author candidate cannot use a formal self-review. It may satisfy cumulative review only through the protected `exact-head-review` check emitted by `.github/workflows/operational-state.yml`. The dispatch actor must differ from the PR author and have current `maintain` or `admin` permission; the supplied SHA must equal the live PR head.
- Merge authorization is never implied by approval or candidate CI. It requires the separate protected `exact-head-authorization` check from the same trusted workflow and exact head, dispatched by an actor who differs from the PR author and has current `maintain` or `admin` permission, only after cumulative review and candidate CI are both current and passing.
- For either protected check, the GitHub Actions run must report event `workflow_dispatch`, exact workflow ref `MongLong0214/agent-operator-score/.github/workflows/operational-state.yml@refs/heads/dev`, and a `workflow_sha` reachable from the live trusted `dev` ref. The resolver reads the workflow blob OID at that exact commit/path and binds it to the run; merely finding some workflow commit in the candidate ancestry is insufficient. The check run must be created for the live PR head by the `github-actions` app. Its external ID is the lane's exact prefix followed by decimal `run_id`, one colon, and decimal `run_attempt`; those values must resolve to that exact workflow run and lane.
- The workflow/check names, trusted workflow ref/commit/blob, workflow-run provenance, repository-owner identity, actor permissions, PR author, live head, dispatch actor, check creator, external ID, and conclusions are structured GitHub facts. Comments, mutable registry identity fields, issue metadata, and labels are not actor or authorization evidence.

## Forbidden scope

- Marking any gate accepted; product source; GitHub label/body/issue mutation; parsing free-form PR comments as machine state; committed current SHA or resolver snapshot; formal self-approval; wall-clock-dependent canonical JSON; permissive fallback on unavailable GitHub, malformed traceability, registry, digest, actor policy, ancestry, check, or source census.

## RED contract

- D0-004A test: `tests/planning-contract.test.mjs`; command `npm test -- tests/planning-contract.test.mjs`; current structural validation unexpectedly accepts at least one named semantic traceability, ownership, catalog, or stale-digest mutant.
- D0-004B test: stage `tests/execution-state.test.mjs` and its fixtures before resolver code; command `node --test tests/execution-state.test.mjs`; expected failure is `ERR_MODULE_NOT_FOUND` for `scripts/resolve-execution-state.mjs`, followed by named behavioral failures as the module is introduced.
- D0-004C test: the named `roadmap-is-not-an-input`, `board-is-not-an-input`, `historical-ledger-is-ignored`, and `generated-views-are-deterministic` cases fail before renderer/projection integration.
- Capture each named failure before its owning GREEN edit. An unrelated failure, network-derived nondeterminism in fixture mode, or a mutant already failing for the wrong reason stops the subtask.

Expected pre-GREEN failure: at least one named semantic mutant is unexpectedly accepted, and the staged resolver test cannot load the missing resolver module before GREEN.

## Minimum GREEN

- validate the graph `SSOT → owning ADR/PRD → PRD requirement → PRD AC → ticket → ticket AC → test file → named test case`, with orphan count zero and exact owning ADR/PRD links.
- validate issue-map and `docs/issues.json` agreement, dependency DAG, current gate-registry schema/data, exact digest bindings, and digest invalidation after a material edit.
- compute the actual product-code census from an explicit control-plane allowlist; emit the paths and count, never a fixed `product_code=0` literal.
- validate canonical identity consistency across the registry, root manifest, README, and active planning surfaces; reject legacy/path exceptions and unresolved/malformed inputs fail closed.
- use `fileURLToPath()` for repository paths and preserve encoded/space-containing paths with a focused regression.
- normalize legacy `docs/issues.json` as a static catalog. Every record has exact `issue`, `ticket_path`, `milestone`, `dependencies`, `size`, `epic`, `kind`, and `initial_labels`; legacy prose becomes `body_template` and is never an operational input; dynamic `status:*` labels are removed from `initial_labels`; D0-003 is `kind=superseded` rather than executable; and the catalog, exact ticket, and rendered Board agree byte-for-byte on size and dependency values.
- implement `npm run ops:status -- --strict [--json] [--ticket <ID>]` and `npm run ops:check`. Derive repository and branch identity at runtime; verify ticket/ADR/PRD digests, accepted gate records, Git ancestry, linked PR/merge/check facts, post-merge CI, dependency completion, and active path/symbol ownership collisions.
- accept an ADR/PRD/ticket gate only when the canonical registry batch binds the exact artifact digests and accepted-record commit, a PR body links exactly one `Gate-Batch: <batch_id>`, that PR head contains the identical registry record, the PR was merged into `dev` by the repository-owner login defined and independently verified under **Trusted actor policy**, and post-merge CI succeeded on the merge commit. Registry lifecycle strings, mutable `prepared_by`/`approved_by` values, comments, issue state, and labels cannot authenticate acceptance. Missing or malformed actor policy, missing PR linkage, unavailable external state, a wrong or no-longer-owner merge actor, stale head or digest, wrong base, absent ancestry, or missing/failed post-merge CI fails closed.
- emit separate `phase` and `readiness` fields. Phases are `planned`, `gate_preparation`, `ready_for_red`, `red`, `implementing`, `review`, `ci`, `merged_pending_post_ci`, `verified`, `superseded`, or `invalidated`; readiness is `ready`, `blocked`, `active`, `terminal`, or `unknown`.
- emit only these blocker codes unless a replacement ticket changes the schema: `DEPENDENCY_UNVERIFIED`, `MILESTONE_GATE_BLOCKED`, `ADR_GATE_MISSING`, `PRD_GATE_MISSING`, `TICKET_GATE_MISSING`, `TICKET_CONTRACT_CONFLICT`, `TICKET_CONTRACT_INCOMPLETE`, `EXECUTION_PACKET_MISSING`, `OWNERSHIP_OVERLAP`, `RED_CONTRACT_INVALID`, `EXACT_HEAD_CI_FAILED`, `CUMULATIVE_REVIEW_MISSING`, `MERGE_AUTHORIZATION_MISSING`, `POST_MERGE_CI_MISSING`, `POST_MERGE_CI_FAILED`, `EXTERNAL_STATE_UNAVAILABLE`, `STALE_DIGEST`, and `WRONG_TARGET`. Every blocked or unknown record also has a bounded human-readable reason.
- support `online-strict` and fixture-backed `offline` modes. When required external facts are unavailable, affected readiness is `unknown`, the ready set is empty, and no Roadmap/Board/label fallback exists.
- treat issue body, issue open/closed state, issue labels, PR comment prose, Roadmap, Board, Maintainer Gate status prose, and historical ledger as non-authoritative. A closed issue alone is never verification.
- link a PR to one ticket only through the exact `Ticket: <ID>` structured PR-body field; a ticket label may be checked for agreement but cannot establish or override linkage. Resolve active candidates from base branch, head SHA, merge commit, formal review `commit_id`, review decision, actor permission, trusted workflow ref/commit/blob, workflow-run event/provenance, dispatch actor, check creator/external ID, and check conclusions, and report superseded heads without reusing their review or CI evidence. Free-form review comments remain audit narrative. Cumulative review requires an eligible current-head formal approval or the protected `exact-head-review` check under **Trusted actor policy**; merge authorization is a separate required protected `exact-head-authorization` check on the same head. Candidate CI, the review fact, and authorization are three distinct inputs. A missing, stale-head, wrong-actor, self-authored-only, candidate-controlled-workflow, non-ancestor trusted-workflow commit, wrong workflow blob, forged run provenance, or mismatched fact fails closed.
- require post-merge CI for `verified`; a merge or candidate-head CI alone cannot satisfy a dependency. A material ADR/PRD/ticket digest change removes affected readiness; a candidate-head-only change invalidates exact-head review/CI without automatically invalidating semantically unchanged RED evidence.
- produce byte-identical canonical JSON for identical static files, Git refs, and GitHub fixture facts. Runtime timestamps and current head are output-only and excluded from committed snapshots and canonical comparisons.
- the frozen current-baseline fixture resolves D0-001 as `verified`, D0-002 as `phase=gate_preparation` and `readiness=blocked`, and `readySet=[]`; the fixture contains facts, not a committed current-branch snapshot.
- render the Board from the canonical static catalog with an explicit non-authority marker; fail projection drift without letting a projection overwrite resolver state. The existing Maintainer Gate status snapshot is never edited, regenerated, or consumed. On pull requests the workflow runs offline strict checks only; on `dev` pushes it runs online strict resolution. Separately approved dispatch jobs run only from the trusted `dev` workflow ref and emit the distinct `exact-head-review` and `exact-head-authorization` check runs only after verifying live PR head, exact trusted workflow commit/blob and run provenance, and **Trusted actor policy**. Offline/online resolution jobs have exactly `contents: read`, `actions: read`, `checks: read`, `pull-requests: read`, and `issues: read`; dispatch jobs replace `checks: read` with `checks: write` solely to create the one named check run on the verified candidate SHA. Each job has a bounded timeout. The workflow uploads JSON and summary artifacts and performs no repository status commit, label/body/issue mutation, or other write-token action.

## Acceptance ↔ tests

- AC-D0-004-1 ↔ `tests/planning-contract.test.mjs` case `semantic-traceability-graph`.
- AC-D0-004-2 ↔ `tests/planning-contract.test.mjs` case `orphan-requirement-ac-ticket-test-mutants`.
- AC-D0-004-3 ↔ `tests/planning-contract.test.mjs` cases `issue-map-and-manifest-agreement` and `operational-authority-schema-and-ticket-agreement`.
- AC-D0-004-4 ↔ `tests/planning-contract.test.mjs` case `maintainer-gate-digest-invalidation`.
- AC-D0-004-5 ↔ `tests/planning-contract.test.mjs` case `computed-product-code-census`.
- AC-D0-004-6 ↔ `tests/planning-contract.test.mjs` case `identity-consistency-and-no-exception`.
- AC-D0-004-7 ↔ `tests/planning-contract.test.mjs` case `encoded-path-root-resolution`.
- AC-D0-004-8 ↔ `tests/execution-state.test.mjs` cases `current-baseline-state`, `current-head-is-runtime-derived`, and `closed-issue-is-not-verification`.
- AC-D0-004-9 ↔ cases `post-merge-ci-required`, `stale-digest-removes-readiness`, and `ownership-overlap-fails-closed`.
- AC-D0-004-10 ↔ cases `external-unavailable-yields-unknown` and `wrong-repository-or-branch-fails-closed`.
- AC-D0-004-11 ↔ cases `roadmap-is-not-an-input`, `board-is-not-an-input`, `issue-label-is-not-an-input`, and `historical-ledger-is-ignored`.
- AC-D0-004-12 ↔ cases `generated-views-are-deterministic`, `projection-drift-does-not-change-state`, and `canonical-json-is-byte-identical`.
- AC-D0-004-13 ↔ case `exact-base-packet-requires-ready`, which emits base, authority digests, owned paths/symbols, and RED command only for `readiness=ready`.
- AC-D0-004-14 ↔ cases `registry-string-is-not-gate-acceptance`, `actor-policy-missing-or-malformed`, `gate-pr-wrong-or-no-longer-owner-actor`, `gate-pr-stale-head-or-digest`, and `gate-pr-post-merge-ci-required`.
- AC-D0-004-15 ↔ cases `review-and-authorization-are-distinct`, `current-review-without-authorization-is-blocked`, `stale-or-self-authored-review-is-blocked`, `candidate-controlled-or-non-ancestor-review-workflow-is-blocked`, `wrong-workflow-blob-or-run-provenance-is-blocked`, `wrong-check-creator-or-external-id-is-blocked`, `author-dispatched-check-is-blocked`, `wrong-dispatch-permission-is-blocked`, and `authorization-without-current-review-is-blocked`.
- AC-D0-004-16 ↔ case `ready-authorizes-packet-not-red`, which requires a separately maintainer-approved exact-base packet before the first RED command even after a resolver-ready result.

## Verification

1. Focused A: `npm test -- tests/planning-contract.test.mjs`; each semantic mutant fails for its expected reason and canonical corpus passes.
2. Focused B/C: `node --test tests/execution-state.test.mjs`; all named resolver, outage, collision, non-input, determinism, and projection cases pass.
3. Offline strict: `npm run ops:check -- --offline`; static graph, digests, ownership, fixtures, generated-view drift, wrong-target, and historical exclusion pass without claiming online readiness.
4. Full: `npm test`; zero failure and no unregistered skip.
5. Build/package: `npm run build`; emitted census/digests match disk, then `npm run ops:render` is clean on a second run.
6. Online strict: `npm run ops:status -- --strict --json`; current repository facts resolve without fallback and the CI artifact is bound to the exact candidate head.
7. Manual/live: `LIVE_NA`; this ticket owns control-plane code only.
8. Ownership: `git diff --check <base>...<head>` passes and the diff contains only the atomic ownership above.

## Stop and escalation

- Stop on ambiguous authority, missing ownership, malformed gate registry, stale digest, wrong target, unallowlisted product code, unsafe path handling, GitHub outage reported as ready, comment/label/projection used as input, nondeterministic JSON, current SHA committed as state, timeout without a terminal state, or partial state.

## Completion evidence

- Exact base/head SHA; per-subtask RED receipts; canonical focused/full/build/offline/online receipts; computed census; gate-registry/digest/ancestry report; deterministic JSON and projection hashes; current-state explanation with blocker codes; exact-head review/CI; and `LIVE_NA` rationale.

## Invalidation

An SSOT, ADR/PRD/ticket graph, gate registry, static catalog, resolver schema, provider fixture, identity source, control-plane allowlist, runtime identity, or candidate-head change invalidates only the affected lane. Contract, AC, RED oracle, or fixture-semantic changes return that subtask to RED; an otherwise unrelated candidate-head change renews exact-head review/CI and online resolution without discarding semantically unchanged RED evidence.
