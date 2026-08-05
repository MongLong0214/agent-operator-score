# PRD D0 — Migrate every active surface to Agent Operator Score and establish a planning-valid repository skeleton without product behavior.

- Status: **PROPOSED — MAINTAINER GATE REQUIRED**
- Milestone: S0 · Name & Contracts
- Dependencies: Final SSOT; ADR-0001, 0003, 0012
- Authority: `docs/north-star/agent-operator-score-ssot-v1.0.md`

## Goal

Migrate every active surface to Agent Operator Score and establish a planning-valid repository skeleton without product behavior.

## Non-goals

- No scorer, runner, adapter, scenario, report, npm publish, or public release.
- No live legacy archive in the active tree; historical material is recoverable only through Git history.

## Functional and contract requirements

1. Rename repository/package/display identifiers to `agent-operator-score`, `Agent Operator Score`, `AOS-Coding P0`, `aos`, and `.aos/`.
2. Create the zero-code npm workspace skeleton matching SSOT §9.4: root `agent-operator-score` is the sole future publish candidate and every internal `@aos/*` workspace is `private: true`.
3. Preserve the PR #53 migration result: no active archive/path exception exists and Git history is the sole recovery boundary; D0-003 is superseded and performs no implementation.
4. Update active operator/developer surfaces, issue metadata mirrors, Maintainer Gate terminology, and planning validation without claiming semantic checks that are not implemented.
5. Complete minimum name clearance in D0: record GitHub, npm, domain, and basic trademark evidence with search limits; unresolved evidence blocks canonical name adoption and D0 exit. This check does not decide LICENSE, contribution, redistribution, or publication; those are separate E14/G4 decisions.

## Step-gate administration

Before any D0 ticket can execute, its required ADR/PRD/ticket transitions must be recorded through the proposed pre-implementation Gate Administration Control Plane in `docs/decisions/PRE-IMPLEMENTATION-GATE-ADMINISTRATION.md`, after its separate CEO exact-head acceptance. That control plane records evidence only: it does not accept this PRD, any D0 ticket, RED, implementation, or product behavior. Every D0 gate remains blocked until its own exact-digest batch and execution packet are independently verified.

## Acceptance criteria

- AC-D0-1: active-tree legacy lint reports zero forbidden hits.
- AC-D0-2: package metadata, README, repository slug, issue labels, milestones, and docs use the canonical identifiers.
- AC-D0-3: planning build proves zero product code and every future package path has one owner.
- AC-D0-4: no active legacy archive remains; superseded material is recoverable only through Git history.
- AC-D0-5: root is the sole future publish candidate, all internal workspaces are private, and CI declares Node 20/22/24 within the truthful engine range.
- AC-D0-6: minimum name-clearance evidence is present or explicitly blocks canonical name adoption; no D0 document decides LICENSE, contribution, redistribution, or publication.

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
