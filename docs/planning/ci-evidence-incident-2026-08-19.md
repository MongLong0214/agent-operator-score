# CI-evidence incident — 2026-08-19

**HISTORICAL RECORD — NEVER USE FOR CURRENT READINESS.** This dated record describes one
external infrastructure failure and the repair taken for it. Current readiness follows
`AGENTS.md` and `npm run ops:status -- --strict`.

## What happened

E8-004's completion merge is [PR #259](https://github.com/MongLong0214/agent-operator-score/pull/259),
merge commit `9f515bfa3a5b284e323baed08de166d88a8d7c88`. Two `event=push` workflow runs were
created on that commit:

| Workflow | Event | Status | Conclusion |
|---|---|---|---|
| Operational State | `push` | `completed` | `success` |
| CI | `push` | `queued` | — |

CI [run 32213166652](https://github.com/MongLong0214/agent-operator-score/actions/runs/32213166652)
was created at `2026-08-19T03:43:35Z` with an `updated_at` identical to its `created_at`. It never
started, and it cannot be recovered: `gh run rerun` reports `This workflow is already running`, and
both `POST /actions/runs/{id}/cancel` and `POST /actions/runs/{id}/force-cancel` return HTTP 500.

CI itself was healthy throughout. Every later `push` run on `dev` completed successfully. A second
run in the same wedged state, `dbdf7153`, has been `queued` since 2026-08-06, so waiting does not
clear this condition.

## Why it blocked a ticket

`postMergeStatus` (`scripts/resolve-execution-state.mjs:546-557`) requires a `completed` run
concluding `success` whose `head_sha` is the completion merge commit. A permanently `queued` run
reads as missing, so E8-004 held at `merged_pending_post_ci` with `POST_MERGE_CI_MISSING`. The
resolver was correct: the `CI` workflow is what runs `npm test` and `npm run build`, and on
`9f515bf` it never executed. **E8-004's merge genuinely had no post-merge test evidence.**

Because E9-001 and E10-001 depend on E8-004, and the E10 → E11 → E12 chain depends on them, one
wedged run held twelve downstream tickets blocked.

## Repair

The receipt was moved to a merge whose CI actually runs, rather than suppressing the record of the
missing evidence:

1. PR #259's merged body dropped its `Ticket-Completion: E8-004` line and kept `Ticket: E8-004`, so
   it remains a plain contributing merge.
2. This packet carries `Ticket: E8-004` and `Ticket-Completion: E8-004`. Its merge commit contains
   E8-004's work in its tree, and the green `CI` run on that commit is the post-merge evidence that
   `9f515bf` never received.

Deleting the wedged run was considered and rejected. `DELETE /actions/runs/32213166652` would have
left only the successful `Operational State` run on that SHA, and E8-004 would have verified — by
erasing the evidence that the test suite never ran on it. That inverts the check the ticket exists
to satisfy.

## Cost of this repair

This completion merge introduces no paths, so its `added_paths` set is empty and the
`COMPLETION_EFFECT_REVERTED` detector (`scripts/resolve-execution-state.mjs:1638-1668`) no longer
guards E8-004's real files. A later revert of E8-004's work would not be caught for this ticket.
No other ticket is affected, because no other ticket's receipt was moved.

## Alternative not taken

A maintainer-approved "CI permanently unavailable" override in the gate registry would keep the
revert detector intact for the original merge. It was rejected as too much bypass surface on a
fail-closed authority for a condition seen twice in this repository's history. If wedged runs
recur, revisit that trade.

Tracked as [#273](https://github.com/MongLong0214/agent-operator-score/issues/273).
