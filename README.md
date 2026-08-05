# Agent Operator Score (AOS)

> **Current status: planning baseline. Product not implemented.**

Agent Operator Score is a planned local-first open assessment of how effectively a human operator runs AI coding agents in a declared environment.

**Measure the operator, not just the model.**

The assessment unit is the human operator. Model, runtime, harness, tools, permissions, network, context, time, token/tool-call budgets, and intervention policy are recorded in an Opportunity Profile. P0 does not statistically remove those environment effects; it reports conditional performance and blocks invalid comparison.

## Canonical identity

| Surface | Value |
|---|---|
| Product | Agent Operator Score |
| Abbreviation | AOS |
| Initial instrument | AOS-Coding |
| Provisional score | AOS-Coding P0 |
| Repository/package candidate | `agent-operator-score` |
| CLI | `aos` |
| Local state | `.aos/` |

Legacy identifiers are forbidden in the active tree. Historical planning material was removed from the active tree and is recoverable only through Git history.

## Product truth

AOS-Coding P0 is an **EXPERIMENTAL / PROVISIONAL** score for observed operator performance in a declared Opportunity Profile and controlled six-family coding task pack.

It is not:

- a stable environment-independent personal ability;
- a model or harness benchmark;
- a percentile, certification, hiring signal, global rank, or industry standard;
- a SaaS, account, payment, telemetry, or central-data product.

Verified scores require a controlled AOS wrapper from start to finish. Imported sessions are **DIAGNOSTIC ONLY**. Snapshot is **ESTIMATE** and cannot display AOS-Coding P0 or safety-clear language.

## What exists now

- final single source of truth;
- 12 proposed ADRs;
- 19 proposed PRDs;
- 65 atomic implementation tickets;
- milestone, dependency, acceptance, and evidence contracts;
- planning-only CI.

The `agent-operator-score` package, `aos` CLI, schemas, scorer, runner, adapters, task forms, reports, Snapshot, and public release do **not** exist yet.

## Fixed implementation order

```text
D0 name migration and repository skeleton
→ E0-A metric and issuance contract
→ E0-B adapter observability contract
→ E0-C pack time and eligibility simulation
→ E0-D prescription input formulas
→ E1 aos-trace / aos-result schemas
→ E2 deterministic scorer and conformance fixtures
→ E3 isolated controlled runner
→ E4 Codex adapter
→ E5 FAM-4 Loop & State
→ E6 FAM-5 False Completion
→ E7 FAM-6 Recovery, Safety & Efficiency
→ G0
→ E8 FAM-1/2/3 and complete Form A
→ E9 Claude Code adapter and parity
→ E10 report and one lever
→ E11 Form B and retest modes
→ E12 20-person alpha and G1–G3
→ E13 Snapshot ESTIMATE
→ E14 public OSS and G4
```

A failed gate blocks every later stage. No UI, third runtime, SaaS, new metric, or broader domain may jump this order.

## Planned CLI — not available yet

```bash
npx agent-operator-score doctor
npx agent-operator-score fixtures verify
npx agent-operator-score doctor --capabilities --runtime codex
npx agent-operator-score assess --runtime codex --suite coding-core-v0 --form A
npx agent-operator-score score --run ./runs/<id>
npx agent-operator-score report --run ./runs/<id>
npx agent-operator-score retest --runtime codex --form B --baseline ./runs/<id>
npx agent-operator-score export --run ./runs/<id> --anonymous
```

Do not run these commands until the owning tickets are implemented and verified.

## Planning map

- [Final SSOT](docs/north-star/agent-operator-score-ssot-v1.0.md)
- [ADRs](docs/adr/INDEX.md)
- [PRDs](docs/prd/INDEX.md)
- [Atomic ticket board](docs/tickets/BOARD.md)
- [GitHub issue map](docs/GITHUB-ISSUE-MAP.md)
- [Milestones](docs/MILESTONES.md)
- [Traceability](docs/TRACEABILITY.md)

All ADRs, PRDs, and tickets are currently **PROPOSED/BLOCKED**. Issue creation does not authorize product code.

## Required development protocol

```text
final SSOT
→ accepted ADR set
→ accepted owning PRD
→ accepted exact atomic ticket
→ exact-base execution packet
→ RED with expected reason
→ minimum GREEN
→ focused + full + build/package + required manual/live verification
→ cumulative exact-head review
→ exact-head CI
→ explicit merge authorization
```

Each ticket owns exact files and symbols and defines forbidden scope, dependencies, RED, minimum GREEN, acceptance-to-test mapping, stop conditions, evidence, and invalidation. Read the exact ticket in full before editing.

## Local-first and privacy

Verified runs and reports stay local. Default telemetry is OFF. Secret values and hidden chain-of-thought are never stored. Optional anonymous export is explicit, allowlisted, and implemented only by its future ticket.

## License and publication

No OSS license or public package has been approved. Repository visibility, npm publication, name clearance, license, third-party notices, security policy, and independent external reproduction are E14/G4 blockers.
