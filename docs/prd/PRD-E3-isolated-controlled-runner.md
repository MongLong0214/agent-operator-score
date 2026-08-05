# PRD E3 — Run controlled tasks locally with fresh workspaces, oracle/secret separation, versioned faults, budgets, and exact terminal state.

- Status: **PROPOSED — MAINTAINER GATE REQUIRED**
- Milestone: S2 · Runner & Differentiated Wedge
- Dependencies: E2; ADR-0008
- Authority: `docs/north-star/agent-operator-score-ssot-v1.0.md`

## Goal

Run controlled tasks locally with fresh workspaces, oracle/secret separation, versioned faults, budgets, and exact terminal state.

## Non-goals

- No cloud runner, container service, central trace upload, adapter-specific scoring, or real external side effects.

## Functional and contract requirements

1. Create and verify explicit-root workspaces with base/environment digests and symlink/wrong-target containment.
2. Materialize the v0 oracle only after worker termination for grader-only access; separate worker, oracle, secrets, descriptors, process group, paths, and IPC, and test oracle-file/env/fd/temp/symlink/proc-fd/post-run access.
3. Enforce time/tool/token-when-observable/permission/process budgets and versioned seeded faults.
4. Persist append-only lifecycle/state/budget/approval/evidence events and exactly one terminal state.
5. Classify changes deterministically: agent-correlated→agent; declared AOS manual edit→human/takeover; uncorrelated mutation→external_mutation; unknown→confidence drop and score withheld/DIAGNOSTIC ONLY. Reconcile child processes and artifacts on every terminal path without destructive cleanup outside the run root.

## Acceptance criteria

- AC-E3-1: cross-run, oracle-file/env/fd/temp/symlink/proc-fd/post-run, secret, descriptor, IPC, and process leakage tests fail closed.
- AC-E3-2: duplicate retry produces one registered effect.
- AC-E3-3: every exit persists one terminal state and final checkpoint.
- AC-E3-4: interruption and timeout leave a diagnosable local bundle.
- AC-E3-5: all four actor-attribution states emit exact events; unknown attribution withholds score.

## Failure and stop semantics

- Missing prerequisite, ambiguous ownership, unsupported observability, unsafe permission, wrong target, silent fallback, stale evidence, timeout without a terminal state, or partial-state ambiguity is a hard stop.
- A failed acceptance criterion blocks this epic and every dependent epic; scope cannot be broadened to manufacture PASS.
- Any material edit after approval returns this PRD to PROPOSED and invalidates dependent ticket approval.

## Required completion evidence

- Exact base and exact candidate-head SHA.
- RED command, failing test name, and expected failure reason captured before GREEN.
- Focused, full, build/package, and required manual/live lane outputs tied to candidate head.
- Acceptance-to-test matrix with no orphan requirement or orphan test.
- Diff ownership audit, security/privacy/fail-closed review, and stale-evidence invalidation statement.
