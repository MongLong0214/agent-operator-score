# ADR-0012: Require gated ADR, PRD, atomic ticket, TDD, cumulative review, and exact-head evidence

- Status: **PROPOSED — MAINTAINER GATE REQUIRED**
- Date: 2026-08-07
- Authority: `docs/north-star/agent-operator-score-ssot-v1.0.md`

## Context

Low-context implementers need bounded ownership and evidence that remains valid only for the reviewed revision. Heads 1a4941e, dbdf715, and ab789df all carried tree 4dcd902 — identical content — yet each transition destroyed all evidence and forced a fresh review round.

## Decision

- The SSOT is the sole product-level authority. Accepted ADRs, PRDs, and exact tickets constrain implementation but cannot override SSOT direction, metric set, architecture, or order.
- No product code is written until the owning ADR set, PRD, and exact ticket each pass an explicit Maintainer Gate.
- Every ticket names files/symbols, dependencies, forbidden scope, RED and expected failure, minimum GREEN, AC-to-test mapping, focused/full/build/manual lanes, invalidation, stop conditions, and evidence.
- RED precedes GREEN; implementation is minimal; cumulative review covers all prior obligations.
- Evidence binds in two layers. (a) Reusable, keyed on (candidate tree OID, base tree OID, toolchain/runtime identity, external input digests): RED/GREEN results, focused/full/build lane results, source review, artifact results. (b) Commit-SHA-bound, redone on every head change: GitHub formal review commit_id, CI and check-run evidence, PR head/base and ancestry, workflow provenance, CEO authorization, merge and post-merge evidence.
- A tree-identical empty commit does not invalidate layer (a); only layer (b) re-executes. Blanket tree-only evidence binding is forbidden — the split is mandatory.
- One execution packet per ticket binds the accepted ADR-set batch identity, the accepted PRD digest, the accepted exact ticket digest, the exact base, ownership, RED command, and verification lanes. The global step-gate is retained: separate CEO confirmations of ADR, PRD, and ticket may not be merged or skipped. The packet collapses only duplicated machine lifecycle and maintainer transition bookkeeping.
- `docs/decisions/maintainer-gate.schema.json` and its registry are the machine-readable record for ADR-batch acceptance, epic-PRD acceptance, exact-ticket readiness for RED, SHA-256 bindings, and digest invalidation; a pending registry cannot self-approve.

## Rejected alternatives

- Epic-sized implementation tickets.
- CI green as a substitute for exact-head review.
- Binding all evidence to tree OID alone — loses CI, review, provenance, and merge integrity.
- Merging the three CEO confirmations into one — removes independent step-gate review.

## Consequences

- The ticket registry is executable governance, not a roadmap summary.
- Ambiguity, ownership overlap, missing observability, wrong target, unsafe permissions, silent fallback, timeout, or partial state stops work.
- D0-005-tree-evidence-and-dispatch-ci enforces the two-tier evidence binding.
- D0-006-single-packet-gate-and-rationale enforces the single execution packet.

## Implementation gate

No product code may rely on ADR-0012 until a Maintainer Gate records an explicit accepted verdict for the exact file digest. A material edit returns the ADR to PROPOSED.
