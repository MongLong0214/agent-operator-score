<div align="center">

<img src="docs/assets/aos-mark.svg" alt="" width="88">

# Agent Operator Score (AOS)

**The model is not the variable you control. You are.**

[![status](https://img.shields.io/badge/status-pre--release-blue)](docs/tickets/BOARD.md)
[![gate G0](https://img.shields.io/badge/G0-resolved-brightgreen)](docs/decisions/G4-VERDICT.md)
[![gate G4 source](https://img.shields.io/badge/G4%20source-closed-brightgreen)](docs/decisions/PUBLICATION-CLEARANCE.md)
[![claims](https://img.shields.io/badge/claims-5%20open-orange)](docs/decisions/G4-VERDICT.md)
[![node](https://img.shields.io/badge/node-22%20%7C%2024-informational)](package.json)
[![license](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)

</div>

---

> **Current status: a local `aos` instrument runs a controlled six-family assessment end to end from a
> clone; it is not the `packages/*` contract stack, and no public package has been approved.**

Two operators run the same model, on the same repository, with the same task. One ships. One burns
the budget and merges something that does not work. Every benchmark you can name measures the half
that was identical.

Agent Operator Score measures the other half.

## What it is

A local-first, open assessment of how effectively a **human operator** runs AI coding agents inside a
declared environment. Model, runtime, harness, tools, permissions, network, context, time, budgets
and intervention policy are recorded in an **Opportunity Profile** — not assumed, not inferred, and
not averaged away.

AOS-Coding P0 does not statistically remove those environment effects. It reports conditional
performance and refuses comparisons the conditions do not support.

<img src="docs/assets/aos-pipeline.svg" alt="Opportunity Profile and controlled wrapper produce an aos-trace; the deterministic scorer produces a result; an ordered integrity, safety and issuance gate decides what may be issued." width="100%">

## What it refuses to be

Most of this repository is refusals, and they are the design.

| It is not | Because |
|---|---|
| a stable personal ability | the score is conditional on a declared profile, and says so on every surface |
| a model or harness benchmark | the model is held fixed; the operator is the unit |
| a percentile or global rank | AOS does not report a percentile. |
| a certification or hiring signal | AOS is not a certification. AOS is not a hiring signal, a global rank, or an industry standard. |
| a hiring or surveillance instrument | AOS is not a hiring, promotion, or surveillance instrument. |
| a SaaS or telemetry product | verified runs stay on your disk. Default telemetry is OFF. |

AOS-Coding P0 is EXPERIMENTAL / PROVISIONAL. A score is produced by the deterministic scorer from an
aos-trace under a declared Opportunity Profile. Imported sessions are **DIAGNOSTIC ONLY**; Snapshot
is **ESTIMATE** and may not display AOS-Coding P0 or safety-clear language.

## What an operator is scored on

<img src="docs/assets/aos-families.svg" alt="Six coding task families: intent, context, graph, loop and state, false completion, and recovery, safety and efficiency." width="100%">

Twenty metrics, `M01`–`M20`, frozen in a registry the scorer cannot extend at runtime. One run
yields one primary constraint and one treatment — or `MANUAL_REVIEW_REQUIRED`. Never a list of
twelve things to fix.

## Honest status

This repository holds two things, and confusing them would be the easiest way to overclaim.

The first is the contract stack under `packages/` and `specs/`: the frozen registry, the schemas, the
graders, the issuance and safety gates. It is the part that has to be right before any number means
anything. It still has no runner and no scenario content, so on its own it assesses nothing.

The second is a local instrument, `bin/aos.mjs` with `lib/`, that does run a controlled six-family
assessment end to end against real agent CLIs on your machine. It is self-contained and does **not**
call `packages/`. It implements the same SSOT 6.2 formula independently, and
`tests/product/scorer-vectors.test.mjs` pins it against the G0-published pack in
`fixtures/scoring/vectors.json`: eighteen of the nineteen vectors agree on issuance and display
score. The nineteenth weights metrics by unequal opportunity counts, which this instrument cannot
express, because every metric it records carries exactly one opportunity per run. Agreement on a
formula is not a validated measurement, and none of the open claims below move because of it.

**Built, and bounded on purpose.** Each line names what landed and, immediately after, what that
does not amount to. The second half is the part most projects leave out.

| Landed | What it is not |
|---|---|
| the frozen `M01`–`M20` registry in `metric-registry.ts`, plus the scoring, issuance, capability and session-class contracts | a scorer |
| `specs/aos-trace.schema.json`, `specs/aos-result.schema.json` and `specs/opportunity-profile.schema.json` with a canonical event registry | a runner |
| thirteen graders in `packages/scorer/src/graders/`, covering all six families | **Graders are not a runner.** They read structured observations, and nothing in `packages/` produces those from a real session. |
| the frozen six-family Form A pack at `suites/coding-core-v0/form-a/manifest.json` | **A frozen pack is not an end-to-end assessment.** |
| the explicit-root workspace lifecycle in `packages/runner/src/workspace.ts` | an isolated runner |
| the deterministic one-lever selector in `packages/scorer/src/diagnosis/select-lever.ts` | **A lever selector is not a prescription report.** |
| the ordered gate in `packages/scorer/src/issuance.ts` and `packages/scorer/src/safety.ts` | **An issuance gate is not a complete scorer.** |
| Claude Code identity, capability discovery, the controlled wrapper and bounded event normalization | a complete adapter |
| the control-plane validators and the operational-state resolver, on Node 22 and 24 | any of the above |

**Not built.** Inside the contract stack: the runner, the scenario content the frozen pack refers to,
the Codex adapter, reports, Snapshot, and the layer that would turn a real session into the
observations the graders read. `suites/coding-core-v0/` carries opportunity ids and placeholder
digests, not prompts, workspaces or oracles. Nothing in `packages/` spawns a process.

Outside it: the published `agent-operator-score` package. The local instrument runs from a clone and
nothing else; the root manifest declares no `bin`, and every workspace is `private: true` and
unpublished. Per ADR-0003 that stays true until E14/G4, and
[PUBLICATION-CLEARANCE.md](docs/decisions/PUBLICATION-CLEARANCE.md) records
`permits_npm_publication: false`. No public package has been approved.

## Try it

Clone the repository and run the instrument from the checkout. There is no install step, no
dependency to fetch, and no `bin` on the manifest, so `node bin/aos.mjs` is the command.

```bash
node bin/aos.mjs doctor                    # platform and suite check
node bin/aos.mjs init                      # create .aos/ in the current directory
node bin/aos.mjs agent add codex --command codex --arg exec --arg -s --arg workspace-write \
                                 --arg --skip-git-repo-check --arg -
node bin/aos.mjs assess --template aos-plan.json   # write the operator plan template
node bin/aos.mjs assess --plan aos-plan.json       # run the controlled assessment
```

The template is deliberately invalid until you complete it: the plan is the operator's own contract,
and an unfilled one cannot earn a score. Registered agent commands are whatever your local CLIs
actually accept — check them with `node bin/aos.mjs agent doctor` before a run.

Verify the contract stack separately. These do not run an assessment. Same commands as in
[examples/README.md](examples/README.md).

```bash
node scripts/schema-conformance.mjs        # schema and fixture conformance
node --test packages/scorer/test/score.test.ts   # scorer against the published vector pack
```

The published formula vector pack is `fixtures/scoring/vectors.json`. Reproduce the fixture truth
itself:

```bash
node scripts/verify-g0.mjs
# G0_FIXTURE_TRUTH families=9 mutations_killed=9 vectors=19 scored=19 manifest_sha256=eb75a654… node=22.23.2
```

Clone this repository into a scratch directory and run it again. The digest is the same, or the gate
below stops being closed.

## The gate is the product

An assessment that cannot say what it has not established is worth nothing. So the release gate says
it, on every run, out loud.

<img src="docs/assets/aos-gates.svg" alt="G0 resolved; G1, G2 and G3 open; G4 split into a closed source half and an open claim half." width="100%">

```bash
node scripts/verify-release.mjs
```

```
G4_SOURCE_PASS permits_source_publication=true
CLAIMS_BLOCKED 5
- G1
- G2
- G3
- formal_publication_review
- independent_reproduction
```

The source half is closed: MIT outbound, DCO inbound, notices, security policy, and a clean-checkout
reproduction of the pinned fixture bytes. That clearance covers shipping source and nothing else.

The claim half is open and will stay open until real events close it — an **independent** party
reproduces the bytes, the feasibility verdict is reached, two calibration studies are run, and a
qualified reviewer looks at this. None of them can be closed by editing a file: each is read from its
own evidence, and the test suite pins that injecting a fully-`RESOLVED` requirement array changes the
blocked list not at all.

So: nothing here claims the metric measures what its name says. That claim has a price, and it has
not been paid.

## Local-first and privacy

Verified runs and reports stay local. Default telemetry is OFF. Secret values are never stored.
Hidden chain-of-thought is never stored. Hidden task answers and gold solutions are not published on
the public surface. Optional anonymous export is explicit, allowlisted, and implemented only by its
future ticket.

## How this repository is built

Every change moves through a fixed chain, and a failed gate blocks everything after it:

```text
final SSOT → accepted ADR set → accepted owning PRD → accepted exact atomic ticket
→ exact-base execution packet → RED with expected reason → minimum GREEN
→ focused + full + build/package verification → cumulative exact-head review
→ exact-head CI → explicit merge authorization
```

13 ADRs, 21 PRDs, 74 atomic implementation tickets across 6 milestones. Each ticket owns exact files and symbols and
declares forbidden scope, dependencies, RED, minimum GREEN, acceptance-to-test mapping, stop
conditions, evidence and invalidation. Read the exact ticket in full before editing anything.

Implementation order is fixed: `D0` name migration → `E0-A…D` contracts → `E1` schemas → `E2` scorer
→ `E3` runner → `E4` Codex adapter → `E5…E7` families → `G0` → `E8` complete Form A → `E9` Claude
Code parity → `E10` report → `E11` Form B → `E12` feasibility alpha → `E13` Snapshot → `E14` public
OSS and G4. Nothing jumps the order.

## Published CLI — not available yet

The local instrument above is not this. These are the published-package commands the SSOT specifies,
and they run against the contract stack, the frozen suite and the Opportunity Profile rather than
against the local instrument's own suite.

```bash
npx agent-operator-score doctor --capabilities --runtime codex
npx agent-operator-score assess --runtime codex --suite coding-core-v0 --form A
npx agent-operator-score score  --run ./runs/<id>
npx agent-operator-score report --run ./runs/<id>
npx agent-operator-score retest --runtime codex --form B --baseline ./runs/<id>
npx agent-operator-score export --run ./runs/<id> --anonymous
```

Nothing publishes this package, so none of these resolve. Do not treat a local run as one of them.

## Documentation

| | |
|---|---|
| [Intended use](docs/INTENDED_USE.md) | what a score may and may not be used for |
| [Limitations](docs/LIMITATIONS.md) | what the instrument cannot tell you |
| [Validation](docs/VALIDATION.md) | what has been established, and how |
| [Final SSOT](docs/north-star/agent-operator-score-ssot-v1.0.md) | the source of truth every artifact answers to |
| [ADRs](docs/adr/INDEX.md) · [PRDs](docs/prd/INDEX.md) | decisions and product requirements |
| [Ticket board](docs/tickets/BOARD.md) · [Traceability](docs/TRACEABILITY.md) | the atomic work and its evidence |
| [Contributing](CONTRIBUTING.md) | DCO sign-off, adapter and scenario routes |

Every ADR and PRD is **PROPOSED**; every ticket not yet verified is **BLOCKED**. Issue creation does
not authorize product code. Do not add generated attribution or internal agent, model, session, or
routing metadata to public GitHub surfaces.

## Canonical identity

| Surface | Value |
|---|---|
| Product | Agent Operator Score |
| Abbreviation | AOS |
| Initial instrument | AOS-Coding |
| Provisional score | AOS-Coding P0 |
| Repository / package candidate | `agent-operator-score` |
| CLI | `aos` |
| Local state | `.aos/` |

Legacy identifiers are forbidden in the active tree. Historical planning material was removed from the active tree and is recoverable only through Git history.

## License

MIT — see [LICENSE](LICENSE). MIT grants redistribution of the software. That grant is not
contributor terms and is not a publication clearance. Contributions arrive under the Developer
Certificate of Origin; see [Contributing](CONTRIBUTING.md). npm publication and a public-visibility
change remain separate decisions.
