# Gate renewal mechanics — what a correction to a pinned artifact actually costs

Written after #319 regressed fifteen verified tickets and had to be reverted. Everything here is
measured, and the measurements are the point: the cost of a documentation correction in this
repository is not the edit, it is the renewal.

## The rule that decides everything

`D0-004:161` accepts a gate only when, among other things, **a merged PR body links exactly one**
`Gate-Batch: <batch_id>`. `resolve-execution-state.mjs:484` enforces it literally:

```js
const matches = [...body.matchAll(/^Gate-Batch:\s*(\S+)\s*$/gm)];
if (matches.length !== 1) return { ok: false, reason: "exactly one structured Gate-Batch field is required" };
```

The gate PR's **head** must also contain a registry that binds the identical ACCEPTED batch record
and artifact digests — batch-id string presence is not enough, and the resolver re-reads the
registry at that head to check. So a receipt cannot be added retroactively to an older merged PR:
its head predates the record.

## Why the twenty-nine existing batches did not need this

They were accepted during bootstrap. `resolve-execution-state.mjs:1099`:

```js
if (facts.d0_004c_merged !== true) { /* per-batch Gate-Batch PR facts are not readiness conditions */ }
```

Before D0-004C merged, gate-batch PR acceptance was waived and only live digest consistency
mattered. After it, every batch needs its own merged receipt. **A correction made today therefore
costs strictly more than the acceptance it supersedes did**, and that asymmetry is easy to miss when
reading the registry, because the existing rows look renewable at the same price they were minted.

## What #319 got wrong

It corrected twenty artifacts and renewed all fifteen affected batches in one candidate, with **no**
`Gate-Batch:` receipt at all. Every validator passed — `GATE_ADMINISTRATION_STRUCTURAL_PASS`,
`PLANNING_CONTRACT_PASS`, 650/650 tests — and the resolver still could not confirm a single batch:

```
before   verified 42
after    verified 27      D0-001..D0-013 all  PRD_GATE_MISSING, ADR_GATE_MISSING, TICKET_GATE_MISSING
```

The registry said ACCEPTED; the resolver had no merged receipt to confirm it and failed closed,
which is correct behaviour. It was reverted in #320 and the count returned to 42.

## The decomposition, and its one exception

Measured across the four corrections that followed:

```
artifacts corrected                     20
pinned by exactly one ACCEPTED batch    19    -> one PR each, one receipt each
pinned by more than one                  1    -> ADR-0003, six batches
```

Nineteen decomposed cleanly and landed as #321, #322, #323, #324, #325, #326, #327, #328, #329,
#331 and #334 — **each with `verified` unchanged across the merge**. The generator refuses to run
when a correction stales more than one batch, so the #319 shape cannot be produced again by
accident.

### The exception is structural, not a mistake

`ADR-0003` is pinned by six batches. Two shapes were measured and both fail:

```
correct only, renew nothing        validator FAILS: stale digests on six ACCEPTED batches
invalidate six, renew one          validator passes, but 3 registry tests fail — they require an
                                   ACCEPTED record for D0-002 and D0-004, so the intermediate state
                                   cannot merge
invalidate six, renew all six      validator passes, 669/669 — but only one receipt fits in the PR
```

So the only workable shape renews all six and carries one receipt, and the other five ride on later
real PRs. **Between the first merge and the last receipt the resolver reports `*_GATE_MISSING` for
the tickets those batches gate.** Measured: `verified 44 -> 37`, six tickets affected, and
`readySet` unchanged — the regression touches completed work, not the ready lane.

That window is unavoidable under one-receipt-per-PR. What is avoidable is #319's version, where no
receipt existed and no batch could ever be confirmed.

## Checklist for a correction to a pinned artifact

1. Count the ACCEPTED batches pinning it. If more than one, expect a regression window and say so
   in the PR before merging, not after.
2. One PR per batch. Correct the artifact, renew that batch, carry its receipt.
3. `reviewed_head` is the correction commit on the same branch: an ancestor of the head, which
   `validate-gate-administration:337` requires, and where the corrected bytes exist, which the
   digest check compares against.
4. Mark the superseded row `INVALIDATED` with `invalidated_at`, `invalidated_by` and a reason naming
   the successor. The schema has no `superseded_by` field; the reason is where that link lives.
5. Regenerate, never hand-edit: the census table in `PRE-IMPLEMENTATION-GATE-ADMINISTRATION.md` from
   the registry, the registry-wide counts from the validator's own report, and any snapshotted batch
   literal from the registry.
6. Re-derive `verified` before and after. An unchanged count is the evidence that the renewal held.

## One receipt kind per PR

A merged PR that carries **both** a `Gate-Batch:` and a `Ticket-Completion:` receipt has **neither**
honoured. Both report `POST_MERGE_CI_MISSING`, while the merge commit's post-merge CI is
`completed/success`.

Measured across four PRs that landed within minutes of each other, all four merge commits green:

```
#335  Gate-Batch only                  ->  D0-001  verified
#337  Gate-Batch only                  ->  D0-012  verified
#338  Gate-Batch only                  ->  D0-013  verified
#336  Gate-Batch + Ticket-Completion   ->  D0-011  POST_MERGE_CI_MISSING
                                           E3-004  POST_MERGE_CI_MISSING
```

Removing the single `Gate-Batch:` line from #336's body, changing nothing else and re-deriving:

```
E3-004  phase=verified readiness=terminal blockers=none
```

**Nothing warns.** Every validator passes, the CI is green, and the blocker points at the one thing
that is demonstrably fine. Finding it took comparing the PR against three siblings, not reading any
error.

So: a completion merge carries `Ticket:` and `Ticket-Completion:` and no `Gate-Batch:`; a gate
renewal carries `Gate-Batch:` and nothing else. That costs an extra PR whenever a renewal and a
completion would otherwise ride together — which is exactly what the ADR-0003 window creates, and
why the remaining receipts there go on their own PRs rather than riding on ticket work.

Filed as #339, including the honest limit: I did not isolate which collection pass drops the run.
`collectLiveExecutionFacts` builds gate PRs and completion merges in two passes, each fetching
`actions/runs?head_sha=<merge_commit_sha>&event=push` for its own corpus
(`resolve-execution-state.mjs:3810` and `:4520`), and a PR selected into the gate corpus is added to
`seenGatePr` while also appearing in `linkedMerged`. The reproduction is what is recorded; the cause
is not yet.

