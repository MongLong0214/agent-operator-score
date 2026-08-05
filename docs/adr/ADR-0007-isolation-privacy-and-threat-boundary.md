# ADR-0007: Use local isolation, minimum collection, and honest anti-cheat limits

- Status: Accepted (2026-08-05, north-star §§5.4, 9.6)
- Owner: CEO

## Context

The runner executes agent tools against repositories while holding hidden oracles. Local machine owners can still inspect distributed code.

## Decision

- Fresh immutable workspaces, separated worker/oracle processes, bounded permissions, and secret canaries are mandatory.
- Store digests and bounded redacted excerpts instead of raw prompts, code, or terminal streams whenever possible.
- Telemetry is off. Only explicit `export --anonymous` creates a contribution bundle.
- Security claims cover accidental leakage, ordinary worker access, and tamper detection—not determined machine owners or credential-grade proctoring.

## Rejected

- Central mandatory upload: violates local-first and creates a sensitive trace database.
- “Uncheatable local exam”: technically false and invites high-stakes misuse.
- Full transcript retention by default: unnecessary privacy and secret exposure.

## Consequences

Threat-model tests include wrong target, path traversal, symlink, timeout, duplicate side effect, prompt injection, and partial-state failures.

