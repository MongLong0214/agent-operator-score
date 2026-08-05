# Contributing to AgentOps Score

## Start here

1. Read the relevant ADR and PRD.
2. Select the earliest unblocked GitHub issue.
3. Pin the exact base SHA and use `feat-issue-<id>` or `bug-issue-<id>` from `dev`.
4. Follow the atomic ticket's ownership, RED, minimum GREEN, and verification commands.

## Review rejection conditions

A change is rejected when it lacks a recorded RED, modifies unowned files, weakens an assertion to make CI green, uses stale evidence, hides a fallback, guesses unavailable observability, expands frozen scope, or leaves security/privacy/wrong-target/timeout/partial-state behavior unverified.

When dogfooding fails, exactly one of two things is wrong: the artifact or the rule. Fix and record one of those. Weakening the assertion to obtain green is neither.

## Commit and merge rules

- Use focused conventional commits and stage explicit paths; do not use blanket staging.
- Merge issue branches to `dev` with review and `--no-ff`.
- `main` accepts release and hotfix merges only.
- Never force-push or delete protected branches.
- Do not add generated-by footers, generator labels, or internal execution metadata to public artifacts.

## Evidence receipt

Every completed issue reports exact head, changed paths, RED and GREEN logs, full/build results, artifact hash when applicable, manual/live or approved `LIVE_NA`, security/privacy result, review verdict, and exact-head CI URL.

## Frozen boundaries

Until alpha completes, do not add a 21st metric, third runtime, SaaS/account/payment surface, percentile, certification, hiring interpretation, or central telemetry.

