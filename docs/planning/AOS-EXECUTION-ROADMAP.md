# AOS Execution Roadmap SSOT

Status: **ACTIVE**

Scope: execution order, ready-set calculation, parallel lanes, joins, and agent handoff

Last verified checkpoint: `dev` at `467df0af49f6fc6ca5eb8d9dfa4044835ff1a060`

This is the stable entrypoint for deciding what work may start next. It is subordinate to the product authority chain in `AGENTS.md`:

1. [`docs/north-star/agent-operator-score-ssot-v1.0.md`](../north-star/agent-operator-score-ssot-v1.0.md)
2. accepted required ADRs
3. accepted owning PRD
4. accepted exact atomic ticket
5. an exact-base execution packet

If this roadmap conflicts with a higher authority, the higher authority wins and this file must be corrected before another transition starts.

## Current state

- Executable ticket records: **71**
- Superseded non-executable record: **D0-003 / issue #56**
- Ticket record without an owning contract: **D0-010 / issue #167** (see *Records that cannot enter a ready set*)
- Current milestone: **S0 · Name & Contracts**
- Current ready set: **D0-004 / #57**, **E0B-003 / #63**, **D0-005 / #173**, **E0C-001 / #64**, **E0D-001 / #67**
- Verified complete: D0-001 / #54, D0-002 / #55, E0A-001 / #58, E0A-002 / #59, E0A-003 / #60, E0B-001 / #61, E0B-002 / #62

The checkpoint SHA is evidence, not a permanent target. Before every new execution packet, fetch `origin/dev`, resolve its exact SHA, rehydrate GitHub issue/PR state, and update this section if the ready set changed.

## Ready-set algorithm

A ticket is implementation-ready only when every condition is true:

1. An accepted owning ticket contract exists at its catalog path.
2. Every declared dependency is verified merged and has a post-merge completion receipt.
3. The prior milestone exit gate has passed.
4. Required ADRs, owning PRD, and the exact ticket have current explicit acceptance at their exact digests.
5. The execution packet pins the current exact `dev` SHA and a clean isolated worktree.
6. Its declared files and symbols do not overlap another active implementation lane.
7. Its named RED contract can be executed before minimum GREEN changes.

Open issues, drafted code, green CI on a prior head, or an unmerged PR do not make a ticket ready.

Dependency edges come from `docs/tickets/BOARD.md`, which is authored from the exact ticket contracts. An edge removed for lacking a declared PRD basis is removed from readiness computation as well; it is not reinstated here.

## Records that cannot enter a ready set

**D0-010 / issue #167** has a GitHub issue and a milestone but no ticket contract at `docs/tickets/D0/`. Authority order places the accepted exact atomic ticket above issue state, so this record is not executable at any dependency state. Authoring and accepting its contract is a prerequisite to its own readiness. Its absence does not block D0-011 or any other record: no ticket declares a dependency on D0-010, and the catalog invariants check identifier sets and mutual bindings rather than contiguous numbering.

**Backlog — outside agent execution.** Four records require a party this pipeline cannot supply. They stay open, keep their dependency edges, and are not counted against S0–S5 progress:

| Ticket | Issue | Why it cannot be executed here |
|---|---:|---|
| E12-002 | [#112](https://github.com/MongLong0214/agent-operator-score/issues/112) | Requires a reference run plus twenty human participants |
| E12-003 | [#113](https://github.com/MongLong0214/agent-operator-score/issues/113) | Analyses data that only #112 can produce |
| E14-001 | [#116](https://github.com/MongLong0214/agent-operator-score/issues/116) | Requires a licence and security clearance decision |
| E14-003 | [#118](https://github.com/MongLong0214/agent-operator-score/issues/118) | Requires an independent third party to reproduce |

Reaching them is a stop, not a gate to weaken. S4 and S5 complete only as far as their non-backlog records allow.

## Fixture admission is a shared blocker

Any ticket that ships a fixture directory needs that directory admitted to the workspace skeleton file list. Today only D0-004's narrow `fixtures/operational-state/**` carve-out grants admission, and the general ticket-derived rule that would grant it to everyone else is owned by D0-011, which depends on D0-004.

E0B-003 / #63 is the first record to hit this. Its candidate answered the need by introducing the general rule itself, which is D0-011's scope and was wrong in both directions: a `fixtures/<name>/*.json` declaration admitted the whole directory rather than the matching files, and a two-segment declaration such as the merged `fixtures/governance/effective-state/**` was not recognised at all. D0-011 criterion 14 states the correct behaviour that this implementation contradicts.

Any record in this position has exactly two lawful moves: wait for D0-004 and then D0-011, or add a narrow carve-out owned by its own ticket on the D0-004 precedent, declared as such and superseded by D0-011 on that ticket's acceptance. Re-implementing the general rule under another ticket is not one of them.

## Recorded integrity exception

E0A-001 through E0B-002 (#58, #59, #60, #61, #62) are merged and closed while D0-004 (#57), which `docs/tickets/BOARD.md` declares as E0A-001's dependency, is still open. Completion therefore ran ahead of the declared order for that edge.

This is recorded rather than silently normalised, and it is not authority to repeat the pattern. The affected records are treated as complete on their merge evidence; D0-004 remains in the ready set on its own dependency, which is satisfied. No new ticket may start on the precedent that a dependency was skipped before.

## Canonical milestone order

### S0 — Name and contracts

Serial foundation, complete: `#54 D0-001 → #55 D0-002`.

Independent S0 lanes. Each has all declared dependencies satisfied and disjoint ownership, so at most one worker per lane may run concurrently:

- Lane A — governance validator: `#57 D0-004`
- Lane B — capability doctor: `#63 E0B-003` — dependency-ready, but see *Fixture admission is a shared blocker* below
- Lane C — governance mode chain: `#173 D0-005 → #174 D0-006 → #175 D0-007 → #176 D0-008 → #177 D0-009`
- Lane D — pack simulation chain: `#64 E0C-001 → #65 E0C-002 → #66 E0C-003`
- Lane E — prescription chain: `#67 E0D-001 → #68 E0D-002 → #69 E0D-003`

Joins:

- `#182 D0-011` unblocks on verified `#55 D0-002` and `#57 D0-004`.
- S0 exit requires every S0 record verified except D0-010, whose contract must exist and be accepted first.

### S1 — G0 scorer truth

`#70 → #71 → #72 → #73 → #74 → #75 → #76 → #77 → S1 exit`

No S1 product code may start before the S0 exit gate, even when a raw ticket dependency appears satisfied earlier.

### S2 — Runner and differentiated wedge

Serial foundation: `#78 → #79 → #80 → #81 → #82 → #83 → #84 → #85 → #86`

Parallel window S2-P1:

- Lane A: `#87 E5-002` — `suites/coding-core-v0/form-a/fam4-continuity/**`, `packages/scorer/src/graders/state-continuity.ts`
- Lane B: `#88 E5-003` — `suites/coding-core-v0/form-a/fam4-idempotency/**`, `packages/scorer/src/graders/idempotency.ts`
- Join: `#89 E5-004`

Serial bridge: `#89 → #90`

Parallel window S2-P2:

- Lane A: `#91 E6-002` — `suites/coding-core-v0/form-a/fam5-stale-evidence/**`, `packages/scorer/src/graders/evidence-freshness.ts`
- Lane B: `#92 E6-003` — `suites/coding-core-v0/form-a/fam5-scope-regression/**`, `packages/scorer/src/graders/scope-regression.ts`
- Join: `#93 E6-004`

Serial completion: `#93 → #94 → #95 → #96 → #97 → S2 exit`

### S3 — Full Form A and second runtime

Parallel window S3-P1:

- Lane A: `#98 E8-001` — `suites/coding-core-v0/form-a/fam1-intent/**`, `packages/scorer/src/graders/intent.ts`
- Lane B: `#99 E8-002` — `suites/coding-core-v0/form-a/fam2-context/**`, `packages/scorer/src/graders/context.ts`
- Lane C: `#100 E8-003` — `suites/coding-core-v0/form-a/fam3-graph/**`, `packages/scorer/src/graders/graph.ts`
- Join: `#101 E8-004`

Serial completion: `#101 → #102 → #103 → #104 → #105 → #106 → #107 → S3 exit`

### S4 — Human alpha and retest

`#108 → #109 → #110 → #111 → [#112 backlog] → [#113 backlog] → S4 exit blocked at #112`

### S5 — Public OSS

`#114 → #115 → [#116 backlog] → #117 → [#118 backlog] → publication gate blocked at #116`

## Parallel execution contract

- Start at most one implementation worker per ready lane.
- Every lane uses its own branch, isolated worktree, exact base SHA, RED receipt, GREEN evidence, and PR.
- Concurrent lanes may share one verified starting base only when exact ownership is disjoint.
- Exact-head review and merge are serialized.
- After one sibling merges, rebase every remaining sibling onto the new `dev` head. The changed head invalidates affected focused/full/build/review/CI evidence, which must be rerun.
- A failed sibling does not erase another sibling's valid owned work, but the join ticket remains blocked.
- Product code never crosses an unpassed milestone exit gate.

## Post-merge rebase requirement

Every merge to `dev` invalidates the gate-administration batch recorded in `docs/decisions/maintainer-gate-registry.v2.json`, because that batch pins a candidate head that must be based on the current `origin/dev`. The observable symptom on any branch that has not caught up is:

```
PLANNING_CONTRACT_FAIL 1
- Gate Administration batch <id> exact candidate HEAD is not based on target ref origin/dev
```

together with six failing cases covering the registry, the structural census, the identity control-plane paths, and the skeleton ownership check. `dev` itself stays green; only branches behind it fail.

This is a stale-evidence signal working as designed, not a defect to route around. After any merge, every open candidate must be rebased onto the new `dev` head and re-verified before its evidence is quoted again. Evidence measured on a superseded base does not describe the candidate and must not be carried into a review.

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
