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

Deleting the wedged run was considered and rejected, because it would erase the evidence that the
test suite never ran on `9f515bf`.

**Correction, 2026-08-19.** The first version of this record justified that refusal with a claim
that is false: that deleting the run would leave the successful `Operational State` run on the SHA
and E8-004 would verify. It would not. The collector keeps only the CI workflow:

```js
const ciRuns = runs.workflow_runs.filter((run) => run.name === "CI" || run.path === ".github/workflows/ci.yml");
```

`Operational State` is never a post-merge input. Deleting the wedged run leaves `ciRuns` empty and
`postMergeStatus` returns `{ missing: true }` — the same `POST_MERGE_CI_MISSING` the ticket already
had. The refusal stands on evidence preservation alone; the mechanical reason given for it was
wrong, and the same error appears in the notes appended to PR #208 and PR #209, which name `CI` and
`Operational State` together as the post-merge check. Only `CI` counts.

## Cost of this repair

**Correction, 2026-08-19.** The first version of this record said the completion merge "introduces
no paths, so its `added_paths` set is empty". That is false, and the truth is worse. The collector
records every file whose status is `added`, with no ownership filter, so the effect set for E8-004
is now exactly this document:

```
#275 (this completion merge)  added -> ["docs/planning/ci-evidence-incident-2026-08-19.md"]
#259 (the merge that did the work) added -> ["conformance/form-a/form-a.test.ts",
                                             "packages/runner/src/assessment.ts",
                                             "suites/coding-core-v0/form-a/manifest.json"]
```

The `COMPLETION_EFFECT_REVERTED` detector is not disabled. It is aimed at a decoy, and it is wrong
in both directions:

- delete this document and leave Form A intact → E8-004 reports `COMPLETION_EFFECT_REVERTED` — a **false red**
- revert the three Form A files and leave this document → E8-004 stays verified — a **false green**

The false green is the `#155` failure this check was added to close: ancestry, green CI, and a
completion marker, with the deliverable absent. E9-001, E10-001, and the E11/E12 chain would then
treat a missing Form A as a satisfied dependency. The twelve-ticket blast radius used to justify
moving the receipt applies to the cost as well, and the first version of this record omitted it.

D0-012 carries the same vacancy for a different reason: PR #208 only modified an existing file, so
its `added_paths` is `[]` and the effect check there is not aimed at anything at all. Issue #274's
claim that the resolver "independently re-verifies the introduced-path effect" is therefore
overstated for D0-012. D0-013's receipt on PR #209 does aim at a real added path,
`tests/execution-views.test.mjs`, and is sound.

## Alternative not taken

A maintainer-approved "CI permanently unavailable" override in the gate registry would keep the
revert detector intact for the original merge. It was rejected as too much bypass surface on a
fail-closed authority for a condition seen twice in this repository's history. If wedged runs
recur, revisit that trade.

Tracked as [#273](https://github.com/MongLong0214/agent-operator-score/issues/273).
