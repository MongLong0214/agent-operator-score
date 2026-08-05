# ADR-0004: Bind all results to versioned source and evidence digests

- Status: Accepted (2026-08-05, north-star §§3.3, 9.5)
- Owner: CEO

## Context

Scores become misleading when scenarios, adapters, schemas, or evidence change without invalidating prior claims.

## Decision

- The north-star is product intent; JSON Schemas and registries are executable truth; reports are derived artifacts.
- Every run records assessment, suite, family, form, schema, scorer, adapter, runtime, model, harness, repository, and evidence digests.
- A changed candidate head invalidates every affected test, artifact, review, and manual evidence lane.
- Hidden chain-of-thought and secret values are never stored.

## Rejected

- Report-as-SSOT: rendered output cannot safely reconstruct eligibility and provenance.
- Mutable “latest” identifiers: make independent reproduction and stale-evidence detection impossible.

## Consequences

Exports without score version and digest are invalid. Migrations preserve original run bytes and create a new derived result.
