# Contributing to Agent Operator Score

AOS is not yet a public product. This public, source-visible repository currently contains a gated development specification, not an implemented assessment. MIT is the outbound license, and inbound contributions are accepted under the Developer Certificate of Origin. What remains unresolved is every claim about what the metric measures: no independent reproduction, no feasibility verdict, no calibration study, and no formal review exists, so nothing here is a validated assessment.

## Read first

1. [Final SSOT](docs/north-star/agent-operator-score-ssot-v1.0.md)
2. [ADR index](docs/adr/INDEX.md)
3. [Owning PRD](docs/prd/INDEX.md)
4. [Exact atomic ticket](docs/tickets/BOARD.md)
5. [AGENTS.md](AGENTS.md)

## Do not start from an issue title

The exact ticket file is the implementation contract. It states owned files/symbols, dependencies, forbidden scope, RED and expected failure, minimum GREEN, acceptance-to-test mapping, verification lanes, stop conditions, evidence, and invalidation.

All tickets are currently blocked pending separate ADR, PRD, and exact-ticket Maintainer Gates. The pending registry cannot approve itself.

## Change protocol

- Use `feat-issue-<number>` or `bug-issue-<number>`.
- Pin exact base SHA and keep ownership disjoint.
- Capture RED before GREEN.
- Implement minimum scope.
- Run focused, full, build/package, and required controlled manual/live verification.
- Re-run affected evidence after every head, fixture, oracle, lockfile, runtime, or permission change.
- Never direct-push protected branches.

## Measurement changes

M01–M20, factor mapping, issuance, formula, safety, Opportunity Profile, task opportunity, treatment, and comparison changes require the owning ADR/PRD to be reopened before code. Do not submit a casual metric change.

## Safety and privacy

Never include secret values, hidden reasoning, raw private project content, uncontrolled external actions, or destructive commands. Local-only and telemetry-OFF are defaults. Secret values are never stored. Hidden task answers and gold solutions are not published on the public surface. Do not add generated attribution or internal agent, model, session, or routing metadata to public GitHub surfaces.

## Public claim boundary

Do not describe AOS as calibrated, certified, hiring-suitable, ranked, an industry standard, or environment-independent. Snapshot is ESTIMATE; controlled full results are EXPERIMENTAL / PROVISIONAL; imported sessions are DIAGNOSTIC ONLY.

## Adapter and scenario routes

These routes document where an adapter or scenario lands. Contributions arrive under the DCO sign-off above.

- [adapter contribution](adapters/) — existing runtimes live under [adapters/codex/](adapters/codex/) and [adapters/claude-code/](adapters/claude-code/). Record a future landing path with the [adapter issue template](.github/ISSUE_TEMPLATE/adapter.yml).
- [scenario contribution](suites/coding-core-v0/) — the frozen Form A pack lives at [suites/coding-core-v0/form-a/](suites/coding-core-v0/form-a/). Record a future landing path with the [scenario issue template](.github/ISSUE_TEMPLATE/scenario.yml).

## License

MIT is the outbound license. [LICENSE](LICENSE) carries the standard MIT grant: anyone may use, copy, modify, merge, publish, distribute, sublicense, and sell copies of the Software, provided the copyright notice and permission notice are included in all copies or substantial portions. That grant is a redistribution permission. It is not contributor terms, and it is not a publication clearance.

Inbound contributions are accepted under the [Developer Certificate of Origin 1.1](https://developercertificate.org/), on the same MIT terms this repository ships outbound. There is no contributor license agreement to sign, no copyright assignment, and no separate paperwork.

Certify each commit with a sign-off line naming you:

```
Signed-off-by: Your Name <you@example.com>
```

`git commit -s` adds it. The line means what the DCO says it means: you wrote the contribution or otherwise have the right to submit it under the MIT license, and you understand the contribution and the sign-off are public and permanent.

npm publication remains unauthorized and is a separate decision, recorded on its own row in [PUBLICATION-CLEARANCE.md](docs/decisions/PUBLICATION-CLEARANCE.md).

D0 minimum name clearance is a separate canonical-identity decision. The E14/G4 source-release gate has cleared: MIT outbound, DCO inbound, and a clean-checkout reproduction of the pinned fixture bytes. That clearance covers shipping source and nothing else — it is not a legal review, and it is not a claim that the metric measures what it is named for.
