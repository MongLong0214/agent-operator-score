# ADR-0008: Isolate workspaces, workers, oracles, secrets, processes, and run state

- Status: **PROPOSED — MAINTAINER GATE REQUIRED**
- Date: 2026-08-05
- Authority: `docs/north-star/agent-operator-score-ssot-v1.0.md`

## Context

A local assessment can still leak hidden oracles, persist side effects, or misattribute retries.

## Decision

- Every verified run uses a fresh explicit-root workspace with base and environment digests.
- The v0 oracle is materialized only after worker termination and is available to the grader process only; path obscurity is not an isolation control.
- Worker, oracle, secrets, process group, descriptors, paths, and IPC are separated and tested against oracle-file, environment, descriptor, temporary-path, symlink, proc-fd, and post-run access fixtures.
- Budgets, faults, approvals, retries, and terminal states are versioned and append-only.
- Raw project data stays local; bounded excerpts and digests are preferred; export is explicit and allowlisted.

## Rejected alternatives

- Best-effort cleanup as the isolation boundary.
- Cloud containment or centralized trace storage.

## Consequences

- Oracle access, tampering, identity mismatch, or containment failure invalidates the run.
- Each terminal path must reconcile processes and persist one final state.

## Implementation gate

No product code may rely on ADR-0008 until a Maintainer Gate records an explicit accepted verdict for the exact file digest. A material edit returns the ADR to PROPOSED.
