# ADR-0008: Isolate workspaces, workers, oracles, secrets, processes, and run state

- Status: **PROPOSED — CEO GATE REQUIRED**
- Date: 2026-08-05
- Authority: `docs/north-star/agent-operator-score-ssot-v1.0.md`

## Context

A local assessment can still leak hidden oracles, persist side effects, or misattribute retries.

## Decision

- Every verified run uses a fresh explicit-root workspace with base and environment digests.
- Worker, oracle, secrets, process group, descriptors, paths, and IPC are separated and tested.
- Budgets, faults, approvals, retries, and terminal states are versioned and append-only.
- Raw project data stays local; bounded excerpts and digests are preferred; export is explicit and allowlisted.

## Rejected alternatives

- Best-effort cleanup as the isolation boundary.
- Cloud containment or centralized trace storage.

## Consequences

- Oracle access, tampering, identity mismatch, or containment failure invalidates the run.
- Each terminal path must reconcile processes and persist one final state.

## Implementation gate

No product code may rely on ADR-0008 until the CEO records an explicit accepted verdict for the exact file digest. A material edit returns the ADR to PROPOSED.
