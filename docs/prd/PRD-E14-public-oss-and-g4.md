# PRD E14 — Publish the OSS surface only after legal, documentation, reproducibility, and external-reproduction gates pass.

- Status: **PROPOSED — MAINTAINER GATE REQUIRED**
- Milestone: S5 · Public OSS
- Dependencies: E13, G0–G3 verdicts; ADR-0001–0012
- Authority: `docs/north-star/agent-operator-score-ssot-v1.0.md`

## Goal

Publish the OSS surface only after formal legal, documentation, reproducibility, and external-reproduction gates pass. D0 minimum name clearance is a separate canonical-identity decision and is not an E14 substitute; LICENSE, contribution acceptance, redistribution, and publication are E14/G4 decisions.

## Non-goals

- No SaaS/account/payment/leaderboard, third runtime, credential claim, or publication with unresolved license/name risk.

## Functional and contract requirements

1. Resolve formal license, contributor terms, third-party notices, security policy, intended use, limitations, and provenance; unresolved items block source publication. A claim about what the metric measures additionally requires an independent reproduction, the E12 feasibility verdict, the deferred calibration studies, and a qualified review; those are reported on every run and never satisfied by a recorded status.
2. Provide one-command demo, public schema/fixtures/scorer, contributor adapter/scenario paths, and no-generated-attribution hygiene.
3. Obtain at least one independent external fixture reproduction and record exact artifact/scorer digests.
4. Run G4 fail-closed checklist before changing visibility or publishing npm.

## Acceptance criteria

- AC-E14-1: an unresolved license, contributor terms, notice, or security item blocks E14/G4 source publication; an unresolved formal-publication, reproduction-independence, feasibility, or calibration item blocks any published claim and is named in the verdict beside the source clearance.
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
