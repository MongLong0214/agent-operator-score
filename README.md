# Agent Operator Score (AOS)

> **Current status: foundation contracts implemented in `@aos/schema`; no public CLI and no end-to-end assessment.**

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

- a stable personal ability independent of environment;
- a model or harness benchmark;
- a percentile, certification, hiring signal, global rank, or industry standard;
- a SaaS, account, payment, telemetry, or central-data product.

Verified scores require a controlled AOS wrapper from start to finish. Imported sessions are **DIAGNOSTIC ONLY**. Snapshot is **ESTIMATE** and cannot display AOS-Coding P0 or safety-clear language.

## What exists now

Planning:

- final single source of truth;
- 13 proposed ADRs;
- 20 proposed PRDs;
- 73 atomic implementation tickets;
- milestone, dependency, acceptance, and evidence contracts.

Implemented, private and internal:

- the npm workspace skeleton and the canonical identifier registry;
- `@aos/schema` foundation and scoring/adapter contracts — `metric-registry.ts` (the frozen M01–M20 registry), `scoring-contract.ts`, `issuance-contract.ts`, `capability.ts`, and `session-class.ts` — each with its own test lane;
- the control-plane validators and the operational-state resolver, with CI on Node 22 and 24.

The trace schema and its canonical event registry now exist (`specs/aos-trace.schema.json`, `packages/schema/src/trace.ts`), as do the result and Opportunity Profile schemas (`specs/aos-result.schema.json`, `specs/opportunity-profile.schema.json`, `packages/schema/src/result.ts`) and one FAM-2 grader (`packages/scorer/src/graders/context.ts`). A single grader is not a scorer. The six-family Form A pack is frozen (`suites/coding-core-v0/form-a/manifest.json`) and can be composed by `packages/runner/src/assessment.ts`. A frozen pack is not an end-to-end assessment. The explicit-root workspace lifecycle exists (`packages/runner/src/workspace.ts`). A workspace lifecycle is not an isolated runner. The deterministic one-lever selector exists as a contract (`packages/scorer/src/diagnosis/select-lever.ts`): it returns one primary constraint and one treatment, or `MANUAL_REVIEW_REQUIRED`, and never more than one ordinary lever. A lever selector is not a prescription report. The ordered integrity, safety and issuance gate exists (`packages/scorer/src/issuance.ts`, `packages/scorer/src/safety.ts`). An issuance gate is not a complete scorer. Claude Code identity, capability discovery, the controlled wrapper, and bounded event normalization exist (`adapters/claude-code/src/identity.ts`, `adapters/claude-code/src/capabilities.ts`, `adapters/claude-code/src/wrapper.ts`, `adapters/claude-code/src/normalize.ts`, `adapters/claude-code/src/redact.ts`). Identity discovery is not a complete adapter. Event normalization is not a complete adapter. The `agent-operator-score` package, the `aos` CLI, the rest of the scorer, the runner, the Codex adapter, the task forms, reports, Snapshot, and any public release do **not** exist yet, and nothing here can run an assessment end to end. Every implemented contract is `private: true` and unpublished.

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
→ E12 20-person feasibility alpha and decision
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

## Public verification demo — available now

This is not the planned `aos` CLI and does not run an assessment. The same commands are documented in [examples/README.md](examples/README.md).

```bash
node scripts/schema-conformance.mjs
```

Scorer and published fixture-pack verification:

```bash
node --test packages/scorer/test/score.test.ts
```

The published formula vector pack is `fixtures/scoring/vectors.json`.

## Planning map

- [Final SSOT](docs/north-star/agent-operator-score-ssot-v1.0.md)
- [ADRs](docs/adr/INDEX.md)
- [PRDs](docs/prd/INDEX.md)
- [Atomic ticket board](docs/tickets/BOARD.md)
- [GitHub issue map](docs/GITHUB-ISSUE-MAP.md)
- [Milestones](docs/MILESTONES.md)
- [Traceability](docs/TRACEABILITY.md)
- [Intended use](docs/INTENDED_USE.md)
- [Limitations](docs/LIMITATIONS.md)
- [Validation](docs/VALIDATION.md)
- [Contributing](CONTRIBUTING.md)

Every ADR and PRD is **PROPOSED**; every ticket not yet verified is **BLOCKED**. Issue creation does not authorize product code.

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

This is a public, source-visible planning repository. D0 minimum name clearance is a separate canonical-identity decision. MIT is the outbound license in [LICENSE](LICENSE). No public package has been approved. Contribution acceptance, npm publication, a visibility change, and formal publication review remain E14/G4 decisions; contributor terms and formal publication review are still unresolved. MIT grants redistribution of the software. That grant is not contributor terms and is not a publication clearance.

G4 does not pass, and no work is planned to make it pass. `node scripts/verify-release.mjs` reports
the reasons against the current tree:

```
G4_FAIL 6
- NO_INDEPENDENT_REPRODUCTION no independent environment has reproduced exact public fixture bytes.
- UNRESOLVED_GATE G1
- UNRESOLVED_GATE G2
- UNRESOLVED_GATE G3
- UNRESOLVED_GATE contributor_terms
- UNRESOLVED_GATE formal_publication_review
```

The first is the one that cannot be closed from inside this repository. G4 requires a signed
environment and toolchain manifest from an independent run, attested by a host whose
`(id, public_key)` pair is listed in the trusted principals block of
[docs/decisions/G4-VERDICT.md](docs/decisions/G4-VERDICT.md). No such run exists. A self-attested
reproduction is refused by construction, and there is no second party. Until someone unaffiliated
reproduces the public fixture bytes and attests to them, G4 stays open and no publication claim
rests on it.
