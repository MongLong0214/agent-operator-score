# PRD D0G — Unify tree-and-commit evidence binding, execution-packet gating, and dependency-DAG readiness into one governance model without weakening any Maintainer Gate step.

- Status: **PROPOSED — MAINTAINER GATE REQUIRED**
- Milestone: S0 · Name & Contracts
- Dependencies: Binding CEO Decision — Governance Simplification; ADR-0009, 0012
- Authority: `docs/north-star/agent-operator-score-ssot-v1.0.md`

## Goal

Unify tree-and-commit evidence binding, execution-packet gating, and dependency-DAG readiness into one governance model without weakening any Maintainer Gate step.

## Non-goals

- No merging or skipping the separate CEO confirmation of ADR, PRD, and ticket; only duplicated machine lifecycle and maintainer transition bookkeeping collapses.
- No CommitLore service or file; the required Gate Administration fields are carried on existing event and invalidation records.
- No scorer, runner, adapter, scenario, report, or other product code; this PRD is governance machinery only.
- No relaxation of RED-before-GREEN, exact-head evidence, or fail-closed defaults established by ADR-0012.

## Context

Over roughly 31.5 hours the repository produced 100 commits and 60 pull requests totaling 10,051 LOC of planning documents and 2,736 LOC of governance machinery, against 0 LOC of product code. The D0 epic alone consumed 24 PRs across three tickets, and 8 of the 10 gate-registry batches recorded to date are `INVALIDATED`. This ratio is evidence of duplicated, re-derived governance state — not of insufficient rigor — and it motivates one evidence model, one execution-packet shape, and one dependency source of truth instead of three independently maintained ones.

## Functional and contract requirements

1. **D0-005 — Tree evidence and dispatch CI.** Implement two-tier evidence binding: a reusable layer bound to (candidate tree OID, base tree OID, toolchain/runtime identity, external input digests) covering RED/GREEN, focused/full/build lanes, and source-review and artifact results; and a commit-SHA-bound layer covering GitHub formal review `commit_id`, CI and check-run evidence, PR head/base and ancestry, workflow provenance, CEO authorization, and merge/post-merge evidence. A tree-identical empty commit must not invalidate the reusable layer. Implement a head-preserving CI retrigger as part of the same ticket: a `workflow_dispatch` trigger in `.github/workflows/ci.yml` plus resolver acceptance of a dispatched run; these ship together and neither may land without the other. This ticket takes exact ownership of `.github/workflows/ci.yml`, `scripts/resolve-execution-state.mjs`, the execution-state schema, and their regression tests. Accepting a dispatched run is fail-closed on all of: dispatched run `head_sha` equals the live PR head; the executing workflow blob is identical to the `ci.yml` blob on live `dev`; the dispatching actor is an eligible maintainer or admin; only GitHub Actions app checks count; and planning-contract 20, 22, and 24 each appear exactly once on the latest attempt and are completed/success. Duplicate mapping, wrong ref, wrong blob, wrong actor, wrong head, or outage yields failure or unavailable, never a pass.
2. **D0-006 — Single-packet gate and rationale.** Define one execution packet per ticket binding the accepted ADR-set batch identity, accepted PRD digest, accepted exact ticket digest, exact base, ownership, RED command, and verification lanes; the global step-gate is retained exactly as ADR-0012 requires. Define one canonical ADR-set batch that approves the exact ADR path and digest set, with each ticket packet referencing the batch identity plus only the ADR subset it actually uses, so that a change to one ADR's digest invalidates only tickets referencing that ADR while a change to a shared policy ADR such as ADR-0012 correctly invalidates every referencing ticket. Retire `docs/decisions/maintainer-gate-registry.v1.json` and `.v2.json` to read-only history and unify the active registry to one. Every Gate Administration event and invalidation record — for both `REJECTED` and `INVALIDATED` outcomes — carries `reason_code`, `reason`, `affected_evidence`, `supersedes_batch`, and `next_transition` as mandatory, schema-validated, append-only fields. This is explicitly not a separate CommitLore service or file.
3. **D0-007 — Dependency-DAG readiness.** Enforce a readiness predicate before any lane may enter implementation: all declared dependencies are verified; owned path and symbol sets are disjoint across active lanes; no shared manifest, lockfile, or control-plane surface conflicts; and the isolated worktree is pinned to an exact base. Implementation proceeds in parallel across ready lanes; integration and merge are serialized in deterministic topological order. The normalized ticket catalog's `dependencies` field is the sole canonical dependency source; the roadmap document is a projection of that source with no independent ordering authority.

## Sequencing

PR #150 at head `1a4941e8` stays frozen: no governance change from this PRD reaches `dev` before PR #150 resolves its own CI and ticket gates and completes merge and post-merge verification. After PR #150 resolves, implementation order is fixed: D0-005, then D0-006, then D0-007. Remaining tickets in the wider roadmap DAG may open in parallel only after D0-007 is verified.

## Acceptance criteria

- AC-D0G-1: the reusable tree-bound evidence layer and the commit-SHA-bound layer are structurally distinct, and a fixture proves a tree-identical empty commit does not invalidate reusable-layer evidence.
- AC-D0G-2: the `workflow_dispatch` trigger and resolver acceptance land in one ticket and one candidate head; no fixture accepts one without the other.
- AC-D0G-3: dispatched-run acceptance fails closed on wrong head, wrong blob, ineligible actor, non-Actions check source, missing or duplicate planning-contract 20/22/24, and outage, with no fixture producing a pass under any of these conditions.
- AC-D0G-4: one execution packet per ticket binds ADR-set batch identity, PRD digest, ticket digest, exact base, ownership, RED command, and verification lanes, and no fixture merges or skips the separate ADR/PRD/ticket CEO confirmation steps.
- AC-D0G-5: an ADR digest change invalidates only the tickets referencing that ADR; a shared-ADR digest change (ADR-0012 fixture) invalidates every referencing ticket; `maintainer-gate-registry.v1.json` and `.v2.json` are read-only and the unified active registry is the sole write target.
- AC-D0G-6: every `REJECTED` and `INVALIDATED` record carries `reason_code`, `reason`, `affected_evidence`, `supersedes_batch`, and `next_transition`, validated and append-only; no CommitLore service or file is introduced.
- AC-D0G-7: the readiness predicate rejects a lane with an unverified dependency, an overlapping owned path or symbol, a shared manifest/lockfile/control-plane conflict, or a worktree not pinned to an exact base; ready lanes run in parallel and merge in deterministic topological order.
- AC-D0G-8: the ticket catalog's `dependencies` field is the only source consulted for ordering; a fixture that mutates roadmap order without mutating `dependencies` produces no ordering change.

## Failure and stop semantics

- Missing prerequisite, ambiguous ownership, unsupported observability, unsafe permission, wrong target, silent fallback, stale evidence, timeout without a terminal state, or partial-state ambiguity is a hard stop.
- A failed acceptance criterion blocks this epic and every dependent epic; scope cannot be broadened to manufacture PASS.
- Any governance change that would reach `dev` before PR #150 resolves its CI and ticket gates and completes merge and post-merge verification is a hard stop, regardless of local readiness of D0-005 through D0-007.
- Any material edit after approval returns this PRD to PROPOSED and invalidates dependent ticket approval.

## Required completion evidence

- Exact base and exact candidate-head SHA for each of D0-005, D0-006, and D0-007.
- RED command, failing test name, and expected failure reason captured before GREEN, per ticket.
- Focused, full, build/package, and required manual/live lane outputs tied to candidate head, per ticket.
- Acceptance-to-test matrix with no orphan requirement or orphan test.
- Diff ownership audit, security/privacy/fail-closed review, and stale-evidence invalidation statement, per ticket.
