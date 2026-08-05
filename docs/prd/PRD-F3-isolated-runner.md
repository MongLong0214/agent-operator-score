# PRD F3 — Isolated runner, budgets, and fault semantics

- Milestone: M2 · Runner, Adapters, Form A (2026-09-23) · ADR: 0004, 0007

## Goal

Run tasks in fresh workspaces with worker/oracle separation, bounded budgets, deterministic fault injection, durable state, and exact terminal reasons.

## Non-goals

No container-cloud service, remote user database, unsupported Windows guarantee, or silent provider fallback.

## User stories

- As an operator, a failed run cannot contaminate another run or expose hidden oracles.
- As an evaluator, retries create one intended effect and terminal states are honest.

## Requirements

1. Verify base and workspace digests before start.
2. Deny worker access to oracle paths and secrets.
3. Enforce time, tool-call, token-when-observable, permission, and process budgets.
4. Replay versioned faults by seed and record `PASSED|FAILED|BLOCKED|TIMED_OUT|STALLED|CANCELLED|UNSAFE|INVALID|INSUFFICIENT_EVIDENCE`.

## Acceptance

- AC-F3-1: cross-run file/process/secret leakage tests fail closed.
- AC-F3-2: duplicate retry cannot duplicate registered side effects.
- AC-F3-3: every stop has one typed terminal reason and final checkpoint.

