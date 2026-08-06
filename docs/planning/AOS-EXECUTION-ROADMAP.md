# AOS Execution Roadmap SSOT

Status: **ACTIVE**

Scope: execution order, ready-set calculation, parallel lanes, joins, and agent handoff

Last verified checkpoint: `dev` at `879ae90f42b42a8f83243ccb76e69b60800c3b82`

This is the stable entrypoint for deciding what work may start next. It is subordinate to the product authority chain in `AGENTS.md`:

1. [`docs/north-star/agent-operator-score-ssot-v1.0.md`](../north-star/agent-operator-score-ssot-v1.0.md)
2. accepted required ADRs
3. accepted owning PRD
4. accepted exact atomic ticket
5. an exact-base execution packet

If this roadmap conflicts with a higher authority, the higher authority wins and this file must be corrected before another transition starts.

## Current state

- Executable ticket records: **64**
- Superseded non-executable record: **D0-003 / issue #56**
- Current milestone: **S0 · Name & Contracts**
- Current ready set: **D0-001 / issue #54 only**
- Current ticket state: **fresh bounded RED/GREEN authorized; completion unverified**
- Next blocked ticket: **D0-002 / issue #55**, blocked by verified completion of #54
- Latest prerequisite correction: PR #127 merged; exact merge and post-merge CI passed at the checkpoint above

The checkpoint SHA is evidence, not a permanent target. Before every new execution packet, fetch `origin/dev`, resolve its exact SHA, rehydrate GitHub issue/PR state, and update this section if the ready set changed.

## Ready-set algorithm

A ticket is implementation-ready only when every condition is true:

1. Every declared dependency is verified merged and has a post-merge completion receipt.
2. The prior milestone exit gate has passed.
3. Required ADRs, owning PRD, and the exact ticket have current explicit acceptance at their exact digests.
4. The execution packet pins the current exact `dev` SHA and a clean isolated worktree.
5. Its declared files and symbols do not overlap another active implementation lane.
6. Its named RED contract can be executed before minimum GREEN changes.

Open issues, drafted code, green CI on a prior head, or an unmerged PR do not make a ticket ready.

## Canonical milestone order

### S0 — Name and contracts

Serial foundation:

`#54 D0-001 → #55 D0-002 → #57 D0-004 → #58 E0A-001 → #59 E0A-002`

Parallel window S0-P1:

- Lane A: `#60 E0A-003`
  - `specs/scoring.v0.json`
  - `packages/schema/src/scoring-contract.ts`
- Lane B: `#61 E0B-001 → #62 E0B-002 → #63 E0B-003`
  - #61 starts concurrently with #60; #62 and #63 continue only after their own predecessors.
- Join: #60 and #63 verified complete unlock `#64 E0C-001`.

Serial completion:

`#64 → #65 → #66 → #67 → #68 → #69 → S0 exit`

### S1 — G0 scorer truth

`#70 → #71 → #72 → #73 → #74 → #75 → #76 → #77 → S1 exit`

No S1 product code may start before the S0 exit gate, even when a raw ticket dependency appears satisfied earlier.

### S2 — Runner and differentiated wedge

Serial foundation:

`#78 → #79 → #80 → #81 → #82 → #83 → #84 → #85 → #86`

Parallel window S2-P1:

- Lane A: `#87 E5-002`
  - `suites/coding-core-v0/form-a/fam4-continuity/**`
  - `packages/scorer/src/graders/state-continuity.ts`
- Lane B: `#88 E5-003`
  - `suites/coding-core-v0/form-a/fam4-idempotency/**`
  - `packages/scorer/src/graders/idempotency.ts`
- Join: `#89 E5-004`

Serial bridge: `#89 → #90`

Parallel window S2-P2:

- Lane A: `#91 E6-002`
  - `suites/coding-core-v0/form-a/fam5-stale-evidence/**`
  - `packages/scorer/src/graders/evidence-freshness.ts`
- Lane B: `#92 E6-003`
  - `suites/coding-core-v0/form-a/fam5-scope-regression/**`
  - `packages/scorer/src/graders/scope-regression.ts`
- Join: `#93 E6-004`

Serial completion: `#93 → #94 → #95 → #96 → #97 → S2 exit`

### S3 — Full Form A and second runtime

Parallel window S3-P1:

- Lane A: `#98 E8-001`
  - `suites/coding-core-v0/form-a/fam1-intent/**`
  - `packages/scorer/src/graders/intent.ts`
- Lane B: `#99 E8-002`
  - `suites/coding-core-v0/form-a/fam2-context/**`
  - `packages/scorer/src/graders/context.ts`
- Lane C: `#100 E8-003`
  - `suites/coding-core-v0/form-a/fam3-graph/**`
  - `packages/scorer/src/graders/graph.ts`
- Join: `#101 E8-004`

Serial completion: `#101 → #102 → #103 → #104 → #105 → #106 → #107 → S3 exit`

### S4 — Human alpha and retest

`#108 → #109 → #110 → #111 → #112 → #113 → S4 exit`

### S5 — Public OSS

`#114 → #115 → #116 → #117 → #118 → publication gate`

## Parallel execution contract

- Start at most one implementation worker per ready lane.
- Every lane uses its own branch, isolated worktree, exact base SHA, RED receipt, GREEN evidence, and PR.
- Concurrent lanes may share one verified starting base only when exact ownership is disjoint.
- Exact-head review and merge are serialized.
- After one sibling merges, rebase every remaining sibling onto the new `dev` head. The changed head invalidates affected focused/full/build/review/CI evidence, which must be rerun.
- A failed sibling does not erase another sibling's valid owned work, but the join ticket remains blocked.
- Product code never crosses an unpassed milestone exit gate.

## New-agent start protocol

Before starting work, an agent must:

1. Read `AGENTS.md`, this roadmap, the north-star SSOT, required ADRs, owning PRD, and exact ticket in full.
2. Fetch `origin/dev`; record exact base SHA, toolchain identity, issue/PR state, and a clean isolated worktree.
3. Recompute the ready set from verified dependency receipts and milestone gates.
4. Check active branches/worktrees/PRs for duplicate work and ownership collision.
5. Refuse the task if it is not in the current ready set.
6. Execute the ticket's named RED before any minimum GREEN edit.
7. Change only the ticket's declared files and symbols.
8. Return exact head, diff manifest, RED/GREEN evidence, focused/full/build/manual status, security/fail-closed review, CI, blocker, and next transition.

Implementation agents may implement and test an approved ticket. They may not approve planning, self-approve an exact head, merge, close issues manually, weaken a gate, or start a dependent ticket.

## Handoff packet schema

Every implementation handoff must include:

- issue and ticket ID;
- exact base SHA and target branch;
- required authority paths and exact digests;
- dependency completion receipts;
- owned files and symbols;
- forbidden scope;
- RED command and expected failure;
- minimum GREEN boundary;
- acceptance-to-test mapping;
- focused, full, build/package, and manual/live commands;
- security, privacy, wrong-target, timeout, and partial-state checks;
- head-change invalidation scope;
- stop and escalation conditions;
- completion evidence and no-merge boundary.

## State transitions

Allowed states:

`planned → ready → red → implementing → review → ci → merge → post_merge → verified`

Exceptional state: `blocked`, with exact blocker, owning authority, resolution condition, and earliest valid resume state.

Only `verified` advances dependencies or milestone progress. Active, partial, merged-without-post-CI, stale-head, and blocked tickets receive zero completion credit.
