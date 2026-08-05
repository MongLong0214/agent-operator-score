# ADR-0009: Use protected main, integration dev, and evidence-bound CI

- Status: Accepted (2026-08-05, repository governance decision)
- Owner: CEO

## Context

The project needs parallel issue work without treating green CI or a worker report as final evidence.

## Decision

- `main` is release-only; `dev` is the default integration branch.
- Feature branches are `feat-issue-<id>`; fixes are `bug-issue-<id>`; releases and hotfixes follow the factory convention.
- Merge commits use `--no-ff`. Force pushes and branch deletions are blocked on `main` and `dev`.
- TDD is mandatory: recorded RED, minimum GREEN, focused suite, full suite, and current-head evidence.
- Product implementation starts only after ADR, PRD, and the exact atomic ticket each pass CEO review.

## Rejected

- Trunk-only direct pushes: violate the standing default-branch safety rule and erase issue-level review boundaries.
- CI green as completion: cannot establish artifact, manual, privacy, or measurement validity.

## Consequences

Any candidate-head change invalidates SHA-bound evidence. Public records contain technical facts only, never internal routing metadata or generated-by attribution.
