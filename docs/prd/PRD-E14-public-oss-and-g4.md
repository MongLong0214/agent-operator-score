# PRD E14 — Open the OSS surface only after identity, legal, documentation, reproducibility, and external-reproduction gates pass.

- Status: **PROPOSED — CEO GATE REQUIRED**
- Milestone: S5 · Public OSS
- Dependencies: E13, G0–G3 verdicts; ADR-0001–0012
- Authority: `docs/north-star/agent-operator-score-ssot-v1.0.md`

## Goal

Open the OSS surface only after identity, legal, documentation, reproducibility, and external-reproduction gates pass.

## Non-goals

- No SaaS/account/payment/leaderboard, third runtime, credential claim, or publication with unresolved license/name risk.

## Functional and contract requirements

1. Complete GitHub/npm/domain/trademark name clearance and document outcome.
2. Select OSS license, contributor terms, third-party notices, security policy, intended use, limitations, and provenance.
3. Provide one-command demo, public schema/fixtures/scorer, contributor adapter/scenario paths, and no-generated-attribution hygiene.
4. Obtain at least one independent external fixture reproduction and record exact artifact/scorer digests.
5. Run G4 fail-closed checklist before changing visibility or publishing npm.

## Acceptance criteria

- AC-E14-1: unresolved name/license/notice/security item blocks publication.
- AC-E14-2: external environment reproduces canonical fixture bytes.
- AC-E14-3: public docs make provisional/no-percentile/no-certification limits unavoidable.
- AC-E14-4: repo/package publication is separately authorized and post-verified.

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
