# AGENTS.md

## Authority order

1. `docs/north-star/agent-operator-score-ssot-v1.0.md`
2. accepted ADRs required by the owning PRD
3. accepted owning PRD
4. accepted exact atomic ticket
5. exact-base execution packet

If any item is missing, proposed, stale, ambiguous, or conflicts with a higher authority, stop. GitHub issue state alone is not authorization.

**"Accepted" is decided by `docs/decisions/maintainer-gate-registry.v2.json`, never by a document's own status line.** Every ADR and every PRD in this repository carries `Status: PROPOSED — MAINTAINER GATE REQUIRED`, and every atomic ticket carries `BLOCKED — ADR + PRD + TICKET MAINTAINER GATES REQUIRED`, regardless of gate state — those lines are static and were never rewritten on acceptance. Reading them as the authority makes the rule above refuse all work, which is what happened to four implementation lanes before this was written down. Find the batch whose `required_artifacts` pin the document and read its `status`, `target.reviewed_head`, and digests; the resolver's blocker list is the second check. This mismatch is tracked as issue #316.

## Current operational state

Committed Markdown, issue bodies, issue state, labels, and PR comments do not determine the current ready set. Until D0-004 delivers the Execution State Resolver, only a maintainer-approved exact-base execution packet backed by freshly re-read gate-registry, Git ancestry, GitHub merge/check, dependency, and ownership facts may authorize RED. Missing or unavailable external facts yield an empty ready set.

After D0-004 is verified on `dev`, run `npm run ops:status -- --strict --ticket <ID>`. Only a resolver result with `readiness=ready` may authorize creation of an exact-base execution packet.

Two failure modes of that command are **not** verdicts about the ticket. `EXTERNAL_STATE_UNAVAILABLE` or `readySet=unavailable` means the resolver could not reach GitHub — it fetches many live facts and fails closed, including under a secondary rate limit that leaves `gh api rate_limit` reporting the buckets nearly full. And `--ticket <ID>` can print `unknown ticket <ID>` for a ticket the full run lists; use the full `npm run ops:status -- --strict` output in that case. Neither says anything about authorization. The roadmap and board remain static dependency and sequencing views; `docs/decisions/MAINTAINER-GATE-STATUS.md`, dated ledgers, and all other status surfaces are projections or historical audit records.

## Per-ticket workflow

1. Read the final SSOT, required ADRs, owning PRD, and exact ticket in full.
2. Pin base SHA, branch, runtime/toolchain identity, permission profile, and owned paths/symbols.
3. Verify every dependency is completed and its evidence is current.
4. Add the ticket's named RED test and capture the exact expected failure before production edits.
5. Implement only the minimum GREEN within owned files/symbols.
6. Run focused, full, build/package, and required manual/live lanes.
7. Audit diff ownership, security, privacy, fail-closed behavior, wrong target, ambiguity, timeout, partial state, and stale evidence.
8. Record evidence tied to exact candidate head.
9. Obtain cumulative exact-head review and exact-head CI.
10. Merge only with explicit authorization and reverify post-merge state.

## Hard stops

Stop immediately on ownership overlap, unknown dependency state, wrong target, missing required observability, unsafe permission, secret exposure, hidden-reasoning capture, silent fallback, nondeterminism, unregistered terminal state, timeout without reconciliation, partial state, stale evidence, or a RED failure different from the ticket contract.

Do not broaden scope or weaken a gate to work around a blocker.

## Repository rules

- Default branch: `dev`; production branch: `main`.
- Issue branches: `feat-issue-<number>` or `bug-issue-<number>`.
- No direct push to protected branches.
- No product code before the applicable step gates.
- No generated attribution or internal agent/model/session/routing metadata in public GitHub surfaces.
- No secret value, hidden chain-of-thought, unbounded raw terminal output, or raw project upload in traces.
- No destructive cleanup outside an explicit verified run temp root.
- Legacy identifiers are forbidden in the active tree. Historical planning material was removed from the active tree and is recoverable only through Git history.

## Baseline commands

```bash
npm ci
npm test
npm run build
```

Ticket-specific commands and expected results override generic examples but never replace the full/build lanes.
