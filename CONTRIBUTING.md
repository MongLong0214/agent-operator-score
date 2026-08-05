# Contributing to Agent Operator Score

AOS is not yet a public product. The repository currently contains a gated development specification, not an implemented assessment.

## Read first

1. [Final SSOT](docs/north-star/agent-operator-score-ssot-v1.0.md)
2. [ADR index](docs/adr/INDEX.md)
3. [Owning PRD](docs/prd/INDEX.md)
4. [Exact atomic ticket](docs/tickets/BOARD.md)
5. [AGENTS.md](AGENTS.md)

## Do not start from an issue title

The exact ticket file is the implementation contract. It states owned files/symbols, dependencies, forbidden scope, RED and expected failure, minimum GREEN, acceptance-to-test mapping, verification lanes, stop conditions, evidence, and invalidation.

All tickets are currently blocked pending separate ADR, PRD, and exact-ticket gates.

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

Never include secret values, hidden reasoning, raw private project content, uncontrolled external actions, or destructive commands. Local-only and telemetry-OFF are defaults.

## Public claim boundary

Do not describe AOS as calibrated, certified, hiring-suitable, ranked, an industry standard, or environment-independent. Snapshot is ESTIMATE; controlled full results are EXPERIMENTAL / PROVISIONAL; imported sessions are DIAGNOSTIC ONLY.

## License

No OSS license has been selected. Contribution acceptance and redistribution remain blocked until E14/G4 clearance.
