# PRD E10 — Render canonical Markdown/JSON reports with evidence drill-down and one deterministic improvement lever.

- Status: **PROPOSED — CEO GATE REQUIRED**
- Milestone: S3 · Full Form A & Second Runtime
- Dependencies: E8, E9, E0-D; ADR-0002, 0004–0006, 0010
- Authority: `docs/north-star/agent-operator-score-ssot-v1.0.md`

## Goal

Render canonical Markdown/JSON reports with evidence drill-down and one deterministic improvement lever.

## Non-goals

- No web dashboard, recomputation in presentation, percentile, certification, ranking, or generated advice.

## Functional and contract requirements

1. Render status, rounded score, raw experimental score, duration, coverage, safety, Opportunity Profile, comparison restriction, six factors, constraint evidence, one lever, next Form, versions/digests, takeover, and limitations.
2. Resolve score→metric→event→artifact using contained exact-digest references.
3. Render registered lever decision trace, application protocol, cost/permission impact, and retest condition.
4. Fail report issuance on stale/broken/traversing/mismatched evidence.

## Acceptance criteria

- AC-E10-1: JSON/Markdown golden outputs derive only from canonical result and are byte-stable.
- AC-E10-2: prohibited claim scanner passes all outputs.
- AC-E10-3: broken evidence links fail closed.
- AC-E10-4: unsafe/invalid/insufficient results never flex an ordinary score.

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
