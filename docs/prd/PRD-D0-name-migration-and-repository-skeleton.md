# PRD D0 — Migrate every active surface to Agent Operator Score and establish a planning-valid repository skeleton without product behavior.

- Status: **PROPOSED — CEO GATE REQUIRED**
- Milestone: S0 · Name & Contracts
- Dependencies: Final SSOT; ADR-0001, 0003, 0012
- Authority: `docs/north-star/agent-operator-score-ssot-v1.0.md`

## Goal

Migrate every active surface to Agent Operator Score and establish a planning-valid repository skeleton without product behavior.

## Non-goals

- No scorer, runner, adapter, scenario, report, npm publish, or public release.
- No deletion of legacy records; archive and lint them.

## Functional and contract requirements

1. Rename repository/package/display identifiers to `agent-operator-score`, `Agent Operator Score`, `AOS-Coding P0`, `aos`, and `.aos/`.
2. Create npm-workspace directories matching SSOT §9.4 with placeholder ownership manifests only.
3. Archive pre-AOS planning under `docs/north-star/legacy/` and forbid legacy tokens elsewhere.
4. Update README, AGENTS, contribution guidance, copilot context, issue templates, labels, milestones, and planning validation.
5. Record name-clearance as an unresolved E14/G4 gate.

## Acceptance criteria

- AC-D0-1: active-tree legacy lint reports zero forbidden hits.
- AC-D0-2: package metadata, README, repository slug, issue labels, milestones, and docs use the canonical identifiers.
- AC-D0-3: planning build proves zero product code and every future package path has one owner.
- AC-D0-4: all pre-migration planning remains reachable under legacy paths.

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
