# AGENTS.md

## Authority

Read `docs/adr/`, the owning `docs/prd/` file, and the exact atomic ticket before editing. The ticket owns the listed files and symbols only.

## Workflow

1. Pin exact base SHA.
2. Capture the ticket's RED and expected reason.
3. Make the minimum GREEN change.
4. Run focused, full, build/package, and manual/live lanes required by the ticket.
5. Record exact-head evidence; a head change invalidates affected lanes.

## Commands

```bash
npm ci
npm test
npm run build
```

## Stop conditions

Stop on ownership overlap, ambiguous acceptance, wrong target, missing required observability, unsafe permission, silent fallback, timeout without terminal state, partial state, or stale evidence. Do not broaden scope to work around a failed dependency.

## Repository rules

- Default branch `dev`; production branch `main`.
- Issue branches: `feat-issue-<id>` and `bug-issue-<id>`.
- No direct push to protected branches, generated attribution, hidden reasoning capture, secrets in traces, or destructive cleanup outside an explicit test temp root.

